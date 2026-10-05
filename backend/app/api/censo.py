"""Censo de clientes: el formulario que antes se llenaba en ArcGIS Survey123.

- El VENDEDOR (y el ADMIN) lo llena desde el telefono. GET /censo/formulario
  trae la definicion. Las fotos suben directo al almacenamiento con un enlace
  firmado (POST /censo/fotos/subida), porque Vercel corta todo lo que pase
  de 4,5 MB y una foto puede pesar hasta 10 MB; despues POST /censo manda las
  respuestas con la clave de cada foto.
- El ADMIN revisa: la lista con filtros, el detalle con fotos y el Excel.

La definicion sale del XLSForm (ver app/services/xlsform.py y
scripts/importar_formulario.py). El servidor vuelve a validar cada envio con
las mismas reglas que el navegador (app/services/formulario.py).

Este router esta abierto al VENDEDOR (ver ROUTERS_DEL_VENDEDOR en
app/main.py), asi que cada endpoint de revision lleva su requiere_rol("ADMIN").
"""

from __future__ import annotations

import logging
import re
import uuid
from datetime import date, datetime, timedelta, timezone

import openpyxl
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.responses import RedirectResponse
from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field

from app.api.reportes import _como_adjunto, _escribir_hoja
from app.core.auth import requiere_rol
from app.core.db import get_connection
from app.core.fechas import a_caracas, ahora_utc
from app.schemas import en_utc
from app.services import almacen_fotos as af
from app.services import formulario as fm
from app.services import xlsform as xf

log = logging.getLogger(__name__)

router = APIRouter(prefix="/censo", tags=["censo"])

FORMULARIO = "censo"
# Tope por foto, pedido por el cliente. El telefono la achica antes (ver
# src/lib/formulario/comprimir.ts) y casi nunca se acerca; el tope es la
# garantia, y queda firmado en el enlace de subida.
FOTO_MAXIMA_BYTES = 10_000_000
TIPOS_FOTO = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}
_EXTENSION_TIPO = {v: k for k, v in TIPOS_FOTO.items()}
POR_PAGINA = 50

# Respuestas que se copian a columnas propias para listar y filtrar sin abrir
# el JSON. Si una version futura del formulario les cambia el nombre, quedan
# vacias, pero la respuesta completa sigue en "respuestas".
COLUMNAS_DE_RESPUESTA = {
    "encuestador": "encuestador",
    "nombreComercio": "nombre_comercio",
    "tipoCliente": "tipo_cliente",
    "empresa": "empresa",
    "ruta": "ruta",
}

_DESFASE_CARACAS = timedelta(hours=-4)


def _definicion() -> dict:
    return fm.definicion(FORMULARIO)


def _almacen():
    try:
        return af.almacen()
    except af.AlmacenNoConfigurado as e:
        raise HTTPException(503, str(e)) from e


def _instante(texto: object, campo: str) -> datetime:
    """Un instante del telefono (ISO con zona), en UTC sin zona."""
    try:
        valor = datetime.fromisoformat(str(texto).replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(422, f"{campo} no es una fecha y hora valida") from None
    if valor.tzinfo is None:
        raise HTTPException(422, f"{campo} tiene que traer la zona horaria")
    return valor.astimezone(timezone.utc).replace(tzinfo=None)


def _prefijo_de(usuario: dict) -> str:
    """Las fotos de cada usuario van bajo su propio prefijo: al enviar, solo
    se aceptan las suyas."""
    return "censo/" + re.sub(r"[^A-Za-z0-9_-]", "_", usuario["id"]) + "/"


@router.get("/formulario", dependencies=[Depends(requiere_rol("VENDEDOR"))])
def formulario():
    """La definicion del formulario, para mostrarlo."""
    return _definicion()


# ---------- Fotos: subida directa al almacenamiento ----------


class SolicitudSubida(BaseModel):
    pregunta: str
    tipo: str
    bytes: int = Field(gt=0)


@router.post("/fotos/subida")
def pedir_subida(datos: SolicitudSubida, usuario: dict = Depends(requiere_rol("VENDEDOR"))):
    """Un enlace firmado para subir UNA foto, con el tipo y el tamano exacto
    firmados: no sirve para subir otra cosa ni algo mas grande."""
    pregunta = next((p for p in xf.preguntas_de(_definicion()) if p["name"] == datos.pregunta), None)
    if not pregunta or pregunta["type"] != "image":
        raise HTTPException(422, f"'{datos.pregunta}' no es una pregunta de foto del formulario")
    tipo = datos.tipo.split(";")[0].strip().lower()
    if tipo not in TIPOS_FOTO:
        raise HTTPException(422, "La foto tiene que ser JPG, PNG o WEBP")
    if datos.bytes > FOTO_MAXIMA_BYTES:
        raise HTTPException(422, f"La foto pesa más de {FOTO_MAXIMA_BYTES // 1_000_000} MB")
    clave = f"{_prefijo_de(usuario)}{uuid.uuid4().hex}.{TIPOS_FOTO[tipo]}"
    subida = _almacen().subida(clave, tipo, datos.bytes)
    return {
        "clave": clave,
        "url": subida.url,
        "metodo": subida.metodo,
        "cabeceras": subida.cabeceras,
        "conSesion": subida.con_sesion,
    }


@router.put("/fotos/carga/{ficha}", status_code=204)
async def carga_local(ficha: str, request: Request, usuario: dict = Depends(requiere_rol("VENDEDOR"))):
    """Solo en desarrollo (ALMACEN_FOTOS=local): hace de R2 para el enlace
    firmado que devolvio /fotos/subida."""
    almacen = _almacen()
    if not isinstance(almacen, af.AlmacenLocal):
        raise HTTPException(404, "No disponible")
    try:
        carga = almacen.leer_ficha(ficha)
    except ValueError as e:
        raise HTTPException(403, str(e)) from e
    if not carga["c"].startswith(_prefijo_de(usuario)):
        raise HTTPException(403, "Ese enlace no es tuyo")
    if (request.headers.get("content-type") or "").split(";")[0].strip().lower() != carga["t"]:
        raise HTTPException(403, "El tipo de la foto no coincide con el enlace")
    contenido = await request.body()
    if len(contenido) != carga["b"]:
        raise HTTPException(403, "El tamaño de la foto no coincide con el enlace")
    almacen.guardar(carga["c"], contenido)


# ---------- Envio ----------


class EnvioCenso(BaseModel):
    respuestas: dict
    iniciadoEn: str
    terminadoEn: str
    # pregunta -> clave devuelta por /fotos/subida
    fotos: dict[str, str] = {}


@router.post("", status_code=201)
def enviar(datos: EnvioCenso, usuario: dict = Depends(requiere_rol("VENDEDOR"))):
    """Recibe un censo: las respuestas y la clave de cada foto ya subida."""
    respuestas = dict(datos.respuestas)
    iniciado = _instante(datos.iniciadoEn, "iniciadoEn")
    terminado = _instante(datos.terminadoEn, "terminadoEn")
    ahora = ahora_utc()
    if terminado < iniciado or terminado > ahora + timedelta(minutes=10) or terminado - iniciado > timedelta(days=1):
        raise HTTPException(422, "Las horas de inicio y fin del formulario no son coherentes")

    defin = _definicion()
    preguntas = xf.preguntas_de(defin)
    imagenes = {p["name"]: p for p in preguntas if p["type"] == "image"}

    # Las fotos: cuentan las que estan de verdad en el almacenamiento, son de
    # quien envia, no se usaron en otro censo y respetan tipo y tamano.
    ajenas = set(datos.fotos) - set(imagenes)
    if ajenas:
        raise HTTPException(422, f"Fotos de preguntas que no son de foto: {', '.join(sorted(ajenas))}")
    for nombre in imagenes:
        respuestas.pop(nombre, None)
    fotos: dict[str, tuple[str, str, int]] = {}
    errores_foto: dict[str, str] = {}
    if datos.fotos:
        almacen = _almacen()
        with get_connection() as conn, conn.cursor() as cur:
            cur.execute('SELECT "clave" FROM "CensoFoto" WHERE "clave" = ANY(%s)', (list(datos.fotos.values()),))
            usadas = {r["clave"] for r in cur.fetchall()}
        for nombre, clave in datos.fotos.items():
            etiqueta = imagenes[nombre].get("label") or nombre
            try:
                af.validar_clave(clave)
            except ValueError:
                errores_foto[nombre] = f"{etiqueta}: clave de foto inválida"
                continue
            if not clave.startswith(_prefijo_de(usuario)):
                errores_foto[nombre] = f"{etiqueta}: esa foto no la subiste tú"
                continue
            if clave in usadas:
                errores_foto[nombre] = f"{etiqueta}: esa foto ya está en otro censo"
                continue
            guardada = almacen.guardada(clave)
            if guardada is None:
                errores_foto[nombre] = f"{etiqueta}: la foto no terminó de subir; vuelve a intentar"
                continue
            tipo = guardada.tipo.split(";")[0].strip().lower() or _EXTENSION_TIPO.get(clave.rsplit(".", 1)[-1], "")
            if tipo not in TIPOS_FOTO or guardada.bytes > FOTO_MAXIMA_BYTES:
                errores_foto[nombre] = f"{etiqueta}: la foto no es válida (tipo o tamaño)"
                continue
            fotos[nombre] = (clave, tipo, guardada.bytes)
            respuestas[nombre] = clave

    # Lo que pone la app y no la persona, como en Survey123: la fecha y la
    # hora de inicio (default today() / now()), la hora de fin y la duracion.
    inicio_local, fin_local = iniciado + _DESFASE_CARACAS, terminado + _DESFASE_CARACAS
    for p in preguntas:
        if p.get("default_dinamico") == "today()":
            respuestas[p["name"]] = inicio_local.date().isoformat()
        elif p.get("default_dinamico") == "now()":
            respuestas[p["name"]] = fm.hora_texto(inicio_local)
        elif p.get("calculation"):
            respuestas.pop(p["name"], None)
    variables = {
        "end_hour": fm.hora_texto(fin_local),
        "end_hh_mm_ss": fm.duracion_hh_mm_ss((terminado - iniciado).total_seconds()),
    }

    limpias, errores = fm.validar(
        defin,
        respuestas,
        hoy=inicio_local.date().isoformat(),
        ahora=inicio_local.isoformat(timespec="seconds"),
        variables=variables,
    )
    errores = {**errores, **errores_foto}
    if errores:
        raise HTTPException(422, {"mensaje": "El formulario tiene errores", "errores": errores})

    censo_id = f"cen-{uuid.uuid4().hex[:16]}"
    punto = next((limpias[p["name"]] for p in preguntas if p["type"] == "geopoint" and p["name"] in limpias), None)
    columnas = {col: limpias.get(nombre) for col, nombre in COLUMNAS_DE_RESPUESTA.items()}
    # Una foto de una pregunta que dejo de ser relevante no se guarda.
    fotos = {n: f for n, f in fotos.items() if n in limpias}

    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            'INSERT INTO "Censo" ("id", "formulario", "version", "usuarioId", "respuestas", "lat", "lng", '
            '"encuestador", "nombreComercio", "tipoCliente", "empresa", "ruta", "iniciadoEn", "terminadoEn", '
            '"recibidoEn") VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)',
            (
                censo_id, FORMULARIO, defin["version"], usuario["id"], Jsonb(limpias),
                punto["lat"] if punto else None, punto["lng"] if punto else None,
                columnas["encuestador"], columnas["nombreComercio"], columnas["tipoCliente"],
                columnas["empresa"], columnas["ruta"], iniciado, terminado, ahora,
            ),
        )
        for pregunta, (clave, tipo, peso) in fotos.items():
            cur.execute(
                'INSERT INTO "CensoFoto" ("id", "censoId", "pregunta", "clave", "tipo", "bytes", "creadaEn") '
                "VALUES (%s, %s, %s, %s, %s, %s, %s)",
                (f"cfo-{uuid.uuid4().hex[:16]}", censo_id, pregunta, clave, tipo, peso, ahora),
            )
        conn.commit()
    return {"id": censo_id, "recibidoEn": en_utc(ahora), "fotos": len(fotos)}


# ---------- Del vendedor ----------


@router.get("/mios")
def mis_censos(usuario: dict = Depends(requiere_rol("VENDEDOR"))):
    """Los ultimos censos que envio quien pregunta, para que vea que llegaron."""
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            'SELECT c."id", c."recibidoEn", c."nombreComercio", c."tipoCliente", c."empresa", '
            '(SELECT COUNT(*) FROM "CensoFoto" f WHERE f."censoId" = c."id") AS "fotos" '
            'FROM "Censo" c WHERE c."usuarioId" = %s ORDER BY c."recibidoEn" DESC LIMIT 30',
            (usuario["id"],),
        )
        filas = cur.fetchall()
    return [{**f, "recibidoEn": en_utc(f["recibidoEn"])} for f in filas]


# ---------- Revision (ADMIN) ----------


def _filtros_sql(
    desde: date | None, hasta: date | None, encuestador: list[str], tipo_cliente: list[str],
    empresa: list[str], q: str | None,
) -> tuple[str, dict]:
    condiciones = ['c."formulario" = %(formulario)s']
    params: dict = {"formulario": FORMULARIO}
    # Las fechas del filtro son dias de Caracas; recibidoEn esta en UTC.
    if desde:
        condiciones.append('c."recibidoEn" >= %(desde)s')
        params["desde"] = datetime.combine(desde, datetime.min.time()) - _DESFASE_CARACAS
    if hasta:
        condiciones.append('c."recibidoEn" < %(hasta)s')
        params["hasta"] = datetime.combine(hasta + timedelta(days=1), datetime.min.time()) - _DESFASE_CARACAS
    if encuestador:
        condiciones.append('c."encuestador" = ANY(%(encuestador)s)')
        params["encuestador"] = encuestador
    if tipo_cliente:
        condiciones.append('c."tipoCliente" = ANY(%(tipo_cliente)s)')
        params["tipo_cliente"] = tipo_cliente
    if empresa:
        condiciones.append('c."empresa" = ANY(%(empresa)s)')
        params["empresa"] = empresa
    if q and q.strip():
        condiciones.append(
            '(c."nombreComercio" ILIKE %(q)s OR c."respuestas"->>\'rif\' ILIKE %(q)s '
            'OR c."respuestas"->>\'codigo_cliente\' ILIKE %(q)s OR c."respuestas"->>\'telefono\' ILIKE %(q)s)'
        )
        params["q"] = f"%{q.strip()}%"
    return "WHERE " + " AND ".join(condiciones), params


class _Filtros:
    def __init__(
        self,
        desde: date | None = None,
        hasta: date | None = None,
        encuestador: list[str] = Query(default=[]),
        tipo_cliente: list[str] = Query(default=[]),
        empresa: list[str] = Query(default=[]),
        q: str | None = None,
    ):
        if desde and hasta and desde > hasta:
            raise HTTPException(400, "La fecha desde no puede ser posterior a la fecha hasta")
        self.sql, self.params = _filtros_sql(desde, hasta, encuestador, tipo_cliente, empresa, q)


_COLUMNAS_LISTA = (
    'c."id", c."recibidoEn", c."iniciadoEn", c."terminadoEn", c."encuestador", c."nombreComercio", '
    'c."tipoCliente", c."empresa", c."ruta", c."lat", c."lng", c."version", u."nombre" AS "usuario", '
    'c."respuestas"->>\'rif\' AS "rif", c."respuestas"->>\'telefono\' AS "telefono", '
    '(SELECT COUNT(*) FROM "CensoFoto" f WHERE f."censoId" = c."id") AS "fotos"'
)


def _con_zona(fila: dict) -> dict:
    return {k: en_utc(v) if isinstance(v, datetime) else v for k, v in fila.items()}


@router.get("", dependencies=[Depends(requiere_rol("ADMIN"))])
def listar(f: _Filtros = Depends(), pagina: int = Query(1, ge=1)):
    """Los censos con filtros, del mas nuevo al mas viejo, mas los valores
    para los filtros."""
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(f'SELECT COUNT(*) AS "n" FROM "Censo" c {f.sql}', f.params)
        total = cur.fetchone()["n"]
        cur.execute(
            f'SELECT {_COLUMNAS_LISTA} FROM "Censo" c JOIN "Usuario" u ON u."id" = c."usuarioId" {f.sql} '
            'ORDER BY c."recibidoEn" DESC LIMIT %(limite)s OFFSET %(salto)s',
            {**f.params, "limite": POR_PAGINA, "salto": (pagina - 1) * POR_PAGINA},
        )
        censos = [_con_zona(c) for c in cur.fetchall()]
        cur.execute(
            f'SELECT c."id", c."lat", c."lng", c."nombreComercio", c."tipoCliente" FROM "Censo" c {f.sql} '
            'AND c."lat" IS NOT NULL',
            f.params,
        )
        puntos = cur.fetchall()
        valores = {}
        for columna in ("encuestador", "tipoCliente", "empresa"):
            cur.execute(
                f'SELECT DISTINCT "{columna}" AS "v" FROM "Censo" WHERE "formulario" = %s AND "{columna}" IS NOT NULL '
                "ORDER BY 1",
                (FORMULARIO,),
            )
            valores[columna] = [r["v"] for r in cur.fetchall()]
    return {
        "total": total,
        "pagina": pagina,
        "porPagina": POR_PAGINA,
        "censos": censos,
        "puntos": puntos,
        "opciones": valores,
    }


def _cargar(cur, censo_id: str) -> dict:
    cur.execute(
        f'SELECT {_COLUMNAS_LISTA}, c."usuarioId", c."respuestas" FROM "Censo" c '
        'JOIN "Usuario" u ON u."id" = c."usuarioId" WHERE c."id" = %s',
        (censo_id,),
    )
    censo = cur.fetchone()
    if not censo:
        raise HTTPException(404, "Censo no encontrado")
    return censo


def _puede_ver(usuario: dict, censo: dict) -> None:
    if usuario["rol"] != "ADMIN" and censo["usuarioId"] != usuario["id"]:
        raise HTTPException(403, "No tienes permiso para ver este censo")


@router.get("/fotos/{foto_id}")
def foto(foto_id: str, usuario: dict = Depends(requiere_rol("VENDEDOR"))):
    """Una foto: la ve el ADMIN o quien envio el censo."""
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            'SELECT f."clave", f."tipo", c."usuarioId" FROM "CensoFoto" f JOIN "Censo" c ON c."id" = f."censoId" '
            'WHERE f."id" = %s',
            (foto_id,),
        )
        fila = cur.fetchone()
    if not fila:
        raise HTTPException(404, "Foto no encontrada")
    _puede_ver(usuario, fila)
    almacen = _almacen()
    # En R2 se redirige a un enlace firmado que vence en minutos: una foto de
    # 10 MB no pasa por una respuesta de Vercel (tope de 4,5 MB).
    url = almacen.url_lectura(fila["clave"])
    if url:
        return RedirectResponse(url, status_code=302, headers={"Cache-Control": "private, no-store"})
    try:
        contenido = almacen.leer(fila["clave"])
    except FileNotFoundError:
        raise HTTPException(404, "La foto no esta en el almacenamiento") from None
    return Response(contenido, media_type=fila["tipo"], headers={"Cache-Control": "private, max-age=86400"})


# ---------- Excel ----------

_ETIQUETA_HTML = re.compile(r"<[^>]+>")


def _texto_plano(html: str | None) -> str:
    if not html:
        return ""
    texto = _ETIQUETA_HTML.sub("", html)
    return texto.replace("&lt;", "<").replace("&gt;", ">").replace("&amp;", "&").strip()


def _valor_excel(pregunta: dict, valor: object, etiquetas: dict[str, dict[str, str]]) -> object:
    if valor is None:
        return None
    tipo = pregunta["type"]
    if tipo in ("select_one", "select_multiple"):
        nombres = valor if isinstance(valor, list) else [valor]
        lista = etiquetas.get(pregunta["list"], {})
        return ", ".join(_texto_plano(lista.get(n, n)) for n in nombres)
    if tipo == "geopoint" and isinstance(valor, dict):
        return f"{valor['lat']}, {valor['lng']}"
    if tipo == "image":
        return "Sí"
    return valor


@router.get("/exportar.xlsx", dependencies=[Depends(requiere_rol("ADMIN"))])
def excel(f: _Filtros = Depends()):
    """Los censos filtrados, una columna por pregunta, con las etiquetas de
    las opciones (no sus nombres internos)."""
    defin = _definicion()
    preguntas = xf.preguntas_de(defin)
    etiquetas = {lista: {o["name"]: o["label"] for o in opciones} for lista, opciones in defin["choices"].items()}
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            f'SELECT {_COLUMNAS_LISTA}, c."respuestas" FROM "Censo" c JOIN "Usuario" u ON u."id" = c."usuarioId" '
            f'{f.sql} ORDER BY c."recibidoEn" DESC',
            f.params,
        )
        censos = cur.fetchall()

    # La encuesta repite etiquetas en sus dos ramas (cliente nuevo y existente):
    # "¿Qué marcas vende?" sale dos veces. Para no tener dos columnas con el
    # mismo titulo, a las repetidas se les agrega el nombre de la pregunta.
    titulos = [_texto_plano(p.get("label")) or p["name"] for p in preguntas]
    titulos = [f"{t} ({p['name']})" if titulos.count(t) > 1 else t for t, p in zip(titulos, preguntas)]
    encabezados = ["Recibido", "Usuario de la app", "Latitud", "Longitud"] + titulos + [
        "Versión del formulario",
        "Id del censo",
    ]
    filas = [
        [a_caracas(c["recibidoEn"]), c["usuario"], c["lat"], c["lng"]]
        + [_valor_excel(p, c["respuestas"].get(p["name"]), etiquetas) for p in preguntas]
        + [c["version"], c["id"]]
        for c in censos
    ]
    libro = openpyxl.Workbook()
    hoja = libro.active
    hoja.title = "Censos"
    _escribir_hoja(hoja, encabezados, filas)
    for fila in hoja.iter_rows(min_row=2, max_col=1):
        fila[0].number_format = "dd/mm/yyyy hh:mm"
    return _como_adjunto(libro, "censos")


# Va al final: /{censo_id} atraparia cualquier ruta de arriba (fotos, mios,
# exportar.xlsx) si se declarara antes.
@router.get("/{censo_id}")
def detalle(censo_id: str, usuario: dict = Depends(requiere_rol("VENDEDOR"))):
    """Un censo con sus respuestas y sus fotos."""
    with get_connection() as conn, conn.cursor() as cur:
        censo = _cargar(cur, censo_id)
        _puede_ver(usuario, censo)
        cur.execute(
            'SELECT "id", "pregunta", "tipo", "bytes" FROM "CensoFoto" WHERE "censoId" = %s ORDER BY "pregunta"',
            (censo_id,),
        )
        fotos = cur.fetchall()
    return {**_con_zona(censo), "fotos": fotos, "versionVigente": censo["version"] == _definicion()["version"]}
