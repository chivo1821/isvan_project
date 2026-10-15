"""Que hace cada censo con los clientes que nombra. Reglas unicas: las usan
el envio desde la pagina (POST /censo), la importacion del historico de
Survey123 y la carga de la maestra.

- Claves: (empresa, codigo) sin ceros a la izquierda. Con AMBAS, dos claves
  (codigo_isvan y codigo_tralog). Un censo historico AMBAS con un solo
  codigo no dice de que empresa es: sus dos claves quedan en REVISAR.
- Posible cliente: un nuevo que no desea comprar. No trae empresa ni
  codigo, no crea clientes; se cuenta aparte.
- Duplicado: un censo anterior con la misma clave (o, si es posible
  cliente, el mismo RIF) a RADIO_DUPLICADO_M o menos. Queda marcado y no
  cuenta en los indicadores. La misma clave mas lejos no es duplicado: es
  una alerta (posible codigo equivocado) que calcula el tablero.
- Cliente: si no existe en Clientes se crea; si existe solo se le llenan
  los campos vacios (nunca se sobrescribe). Si el codigo esta en la maestra
  o en ventas con un nombre que no se parece, no se toca nada y queda en
  REVISAR.
"""

from __future__ import annotations

import math
import re
import uuid
from dataclasses import dataclass

from app.core.ubicacion import fuera_de_venezuela, sin_ubicacion
from app.services import formulario as fm
from app.services.indicadores_venta import ruta_comparable
from app.services.maestra_import import codigo_normalizado, mismo_negocio

FORMULARIO = "censo"
EMPRESAS = ("ISVAN", "TRALOG")
RADIO_DUPLICADO_M = 50
# Codigo del sistema de ventas: letras, numeros o guiones.
CODIGO_VALIDO = re.compile(r"^[A-Za-z0-9-]{1,20}$")
PREGUNTAS_DE_CODIGO = ("codigo_cliente", "codigo_isvan", "codigo_tralog")
# Lo que Survey123 escribe cuando una pregunta no aplicaba.
SIN_DATO = {"", "N/A", "NA", "#N/A", "NULL", "NONE"}
TIPO_CLIENTE_NUEVO = "TIENDA"

# Respuestas que se copian a columnas propias de Censo para listar y filtrar
# sin abrir el JSON. Si una version futura del formulario les cambia el
# nombre, quedan vacias, pero la respuesta completa sigue en "respuestas".
COLUMNAS_DE_RESPUESTA = {
    "encuestador": "encuestador",
    "nombreComercio": "nombre_comercio",
    "tipoCliente": "tipo_cliente",
    "empresa": "empresa",
    "ruta": "ruta",
}


@dataclass
class Clave:
    empresa: str
    codigo: str
    # Si viene, la clave no se usa para tocar Clientes: queda en REVISAR.
    revisar: str | None = None


def _dato(valor: object) -> str | None:
    texto = " ".join(str(valor or "").split())
    return None if texto.upper() in SIN_DATO else texto


def validar_codigos(respuestas: dict) -> dict[str, str]:
    """Errores de formato de los codigos que vengan (la obligatoriedad segun
    el relevant ya la aplica formulario.validar)."""
    errores = {}
    for nombre in PREGUNTAS_DE_CODIGO:
        valor = _dato(respuestas.get(nombre))
        if valor and not CODIGO_VALIDO.match(valor):
            errores[nombre] = "El código solo lleva letras, números o guiones (hasta 20)"
    return errores


def es_posible_cliente(respuestas: dict) -> bool:
    """Nuevo que no desea comprar: queda como prospecto, sin codigo."""
    return _dato(respuestas.get("tipo_cliente")) == "Nuevo" and _dato(respuestas.get("desea_vender_tiorico")) != "Si"


def claves_de(respuestas: dict) -> list[Clave]:
    empresa = (_dato(respuestas.get("empresa")) or "").upper()
    if empresa in EMPRESAS:
        codigo = _dato(respuestas.get("codigo_cliente"))
        return [Clave(empresa, codigo_normalizado(codigo))] if codigo else []
    if empresa != "AMBAS":
        return []
    claves = []
    for e in EMPRESAS:
        codigo = _dato(respuestas.get(f"codigo_{e.lower()}"))
        if codigo:
            claves.append(Clave(e, codigo_normalizado(codigo)))
    if claves:
        return claves
    # Historico de Survey123: AMBAS con un solo codigo, sin decir de cual.
    codigo = _dato(respuestas.get("codigo_cliente"))
    if not codigo:
        return []
    motivo = "AMBAS con un solo código: no se sabe si es el de ISVAN o el de TRALOG"
    return [Clave(e, codigo_normalizado(codigo), motivo) for e in EMPRESAS]


def rif_normalizado(valor: object) -> str | None:
    texto = re.sub(r"[^A-Z0-9]", "", (_dato(valor) or "").upper())
    return texto or None


def metros(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    r = 6_371_000
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def _cerca(a: dict, b: dict) -> bool:
    if sin_ubicacion(a["lat"], a["lng"]) or sin_ubicacion(b["lat"], b["lng"]):
        return False
    return metros(a["lat"], a["lng"], b["lat"], b["lng"]) <= RADIO_DUPLICADO_M


def _etiqueta(lista: str, valor: str | None) -> str | None:
    if not valor:
        return None
    opciones = fm.definicion(FORMULARIO)["choices"].get(lista, [])
    return next((o["label"] for o in opciones if o["name"] == valor), valor)


def ruta_de_cliente(ruta: str | None) -> str | None:
    """La ruta como la guarda Clientes ("Ruta 5")."""
    numero = ruta_comparable(ruta)
    return f"Ruta {numero}" if numero else None


# ---------- Contexto: lo que se consulta una sola vez ----------


def _a_ubicacion(fila: dict) -> dict:
    return {"id": fila["id"], "lat": fila["lat"], "lng": fila["lng"], "orden": (fila["terminadoEn"], fila["id"])}


class Contexto:
    """Maestra vigente, clientes de ventas, Clientes y censos anteriores,
    cargados una vez por empresa: importar el historico procesa ~1.000
    censos y, con la base en otra region (Neon), una consulta por censo y
    por cliente seria demasiado lenta."""

    def __init__(self, cur):
        self.cur = cur
        self._maestra: dict[str, dict[str, dict]] = {}
        self._ventas: dict[str, dict[str, dict]] = {}
        self._clientes: dict[str, dict[str, dict]] = {}
        self._por_clave: dict[tuple[str, str], list[dict]] | None = None
        self._por_rif: dict[str, list[dict]] | None = None

    def maestra(self, empresa: str) -> dict[str, dict]:
        if empresa not in self._maestra:
            self.cur.execute(
                'SELECT mc."codigo", mc."razonSocial", mc."ruta" FROM "MaestraCliente" mc WHERE mc."cargaId" = ('
                '  SELECT "id" FROM "MaestraCarga" WHERE "empresa" = %s ORDER BY "subidaEn" DESC LIMIT 1)',
                (empresa,),
            )
            self._maestra[empresa] = {f["codigo"]: f for f in self.cur.fetchall()}
        return self._maestra[empresa]

    def ventas(self, empresa: str) -> dict[str, dict]:
        if empresa not in self._ventas:
            self.cur.execute('SELECT "codigo", "nombre", "ruta" FROM "VentaCliente" WHERE "empresa" = %s', (empresa,))
            self._ventas[empresa] = {codigo_normalizado(f["codigo"]): f for f in self.cur.fetchall()}
        return self._ventas[empresa]

    def clientes(self, empresa: str) -> dict[str, dict]:
        if empresa not in self._clientes:
            self.cur.execute(
                'SELECT "id", "codigo", "nombre", "lat", "lng", "telefono", "direccion", "rutaComercial" '
                'FROM "Cliente" WHERE "empresa" = %s ORDER BY "codigo"',
                (empresa,),
            )
            por_codigo: dict[str, dict] = {}
            for f in self.cur.fetchall():
                por_codigo.setdefault(codigo_normalizado(f["codigo"]), f)
            self._clientes[empresa] = por_codigo
        return self._clientes[empresa]

    def _cargar_censos(self) -> None:
        self._por_clave, self._por_rif = {}, {}
        self.cur.execute(
            'SELECT c."id", c."lat", c."lng", c."terminadoEn", cc."empresa"::text AS "empresa", cc."codigo" '
            'FROM "Censo" c JOIN "CensoCliente" cc ON cc."censoId" = c."id" '
            'WHERE c."duplicadoDeId" IS NULL AND c."descartadoEn" IS NULL'
        )
        for f in self.cur.fetchall():
            self._por_clave.setdefault((f["empresa"], f["codigo"]), []).append(_a_ubicacion(f))
        self.cur.execute(
            'SELECT c."id", c."lat", c."lng", c."terminadoEn", c."respuestas" FROM "Censo" c '
            'WHERE c."duplicadoDeId" IS NULL AND c."descartadoEn" IS NULL '
            'AND NOT EXISTS (SELECT 1 FROM "CensoCliente" cc WHERE cc."censoId" = c."id")'
        )
        for f in self.cur.fetchall():
            rif = rif_normalizado(f["respuestas"].get("rif"))
            if rif and es_posible_cliente(f["respuestas"]):
                self._por_rif.setdefault(rif, []).append(_a_ubicacion(f))

    def duplicado_de(self, censo: dict, claves: list[Clave], rif: str | None) -> str | None:
        """El censo anterior mas viejo con la misma clave (o el mismo RIF) a
        RADIO_DUPLICADO_M o menos."""
        if self._por_clave is None:
            self._cargar_censos()
        candidatos = (
            [c for clave in claves for c in self._por_clave.get((clave.empresa, clave.codigo), [])]
            if claves
            else self._por_rif.get(rif, []) if rif else []
        )
        orden = (censo["terminadoEn"], censo["id"])
        anteriores = sorted(
            (c for c in candidatos if c["orden"] < orden and c["id"] != censo["id"]), key=lambda c: c["orden"]
        )
        return next((c["id"] for c in anteriores if _cerca(censo, c)), None)

    def registrar(self, censo: dict, claves: list[Clave], rif: str | None) -> None:
        """Un censo no duplicado pasa a ser candidato para los siguientes."""
        if self._por_clave is None:
            self._cargar_censos()
        ubicacion = _a_ubicacion(censo)
        for clave in claves:
            self._por_clave.setdefault((clave.empresa, clave.codigo), []).append(ubicacion)
        if not claves and rif:
            self._por_rif.setdefault(rif, []).append(ubicacion)


# ---------- Clientes ----------


def _direccion(respuestas: dict) -> str:
    partes = [
        _dato(respuestas.get("sector")),
        _dato(respuestas.get("punto_referencia")),
        _etiqueta("parroquia", _dato(respuestas.get("parroq"))),
    ]
    return ", ".join(p for p in partes if p)[:300]


def _ubicacion(censo: dict) -> tuple[float | None, float | None]:
    lat, lng = censo["lat"], censo["lng"]
    if sin_ubicacion(lat, lng) or fuera_de_venezuela(lat, lng):
        return None, None
    return lat, lng


def _procesar_clave(ctx: Contexto, censo: dict, clave: Clave) -> dict:
    cur = ctx.cur
    respuestas = censo["respuestas"]
    nombre = _dato(respuestas.get("nombre_comercio")) or censo.get("nombreComercio") or ""
    maestra = ctx.maestra(clave.empresa).get(clave.codigo)
    venta = ctx.ventas(clave.empresa).get(clave.codigo)
    cliente = ctx.clientes(clave.empresa).get(clave.codigo)

    motivo = clave.revisar
    if not motivo:
        referencias = [n for n in (maestra and maestra["razonSocial"], venta and venta["nombre"]) if n]
        if referencias and not any(mismo_negocio(nombre, r) for r in referencias):
            de = "la maestra" if maestra else "ventas"
            motivo = (
                f'En {de} el código {clave.codigo} de {clave.empresa} es "{referencias[0]}" '
                f'y el censo dice "{nombre or "(sin nombre)"}": posible código equivocado'
            )

    ruta = ruta_de_cliente((maestra and maestra["ruta"]) or censo.get("ruta"))
    lat, lng = _ubicacion(censo)
    if motivo:
        accion, cliente_id = "REVISAR", cliente["id"] if cliente else None
    elif cliente:
        cliente_id = cliente["id"]
        # Solo lo que esta vacio: nunca se sobrescribe un dato del cliente.
        cambios = {}
        if sin_ubicacion(cliente["lat"], cliente["lng"]) and lat is not None:
            cambios.update(lat=lat, lng=lng)
        if not cliente["rutaComercial"] and ruta:
            cambios["rutaComercial"] = ruta
        telefono = _dato(respuestas.get("telefono"))
        if not (cliente["telefono"] or "").strip() and telefono:
            cambios["telefono"] = telefono
        direccion = _direccion(respuestas)
        if not (cliente["direccion"] or "").strip() and direccion:
            cambios["direccion"] = direccion
        if cambios:
            asignaciones = ", ".join(f'"{k}" = %s' for k in cambios)
            cur.execute(f'UPDATE "Cliente" SET {asignaciones} WHERE "id" = %s', (*cambios.values(), cliente_id))
            cliente.update(cambios)
        accion = "COMPLETADO" if cambios else "EXISTENTE"
    else:
        cliente_id = f"cli-{uuid.uuid4().hex[:10]}"
        nuevo = {
            "id": cliente_id, "codigo": clave.codigo,
            "nombre": (maestra and maestra["razonSocial"]) or nombre or f"Cliente {clave.codigo}",
            "lat": lat, "lng": lng, "telefono": _dato(respuestas.get("telefono")) or "",
            "direccion": _direccion(respuestas), "rutaComercial": ruta,
        }
        cur.execute(
            'INSERT INTO "Cliente" ("id", "empresa", "codigo", "nombre", "tipo", "direccion", "ciudad", "lat", "lng", '
            '"telefono", "rutaComercial") VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)',
            (
                cliente_id, clave.empresa, clave.codigo, nuevo["nombre"], TIPO_CLIENTE_NUEVO, nuevo["direccion"],
                _etiqueta("municipio", _dato(respuestas.get("municipio"))) or "",
                lat, lng, nuevo["telefono"], ruta,
            ),
        )
        ctx.clientes(clave.empresa)[clave.codigo] = nuevo
        accion = "CREADO"

    cur.execute(
        'INSERT INTO "CensoCliente" ("id", "censoId", "empresa", "codigo", "enMaestra", "enVentas", "clienteId", '
        '"accion", "motivo", "procesadoEn") VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, now()) '
        'ON CONFLICT ("censoId", "empresa") DO UPDATE SET "codigo" = EXCLUDED."codigo", '
        '"enMaestra" = EXCLUDED."enMaestra", "enVentas" = EXCLUDED."enVentas", "clienteId" = EXCLUDED."clienteId", '
        '"accion" = EXCLUDED."accion", "motivo" = EXCLUDED."motivo", "procesadoEn" = now()',
        (
            f"ccl-{uuid.uuid4().hex[:16]}", censo["id"], clave.empresa, clave.codigo,
            maestra is not None, venta is not None, cliente_id, accion, motivo,
        ),
    )
    return {"empresa": clave.empresa, "codigo": clave.codigo, "accion": accion, "motivo": motivo,
            "enMaestra": maestra is not None, "enVentas": venta is not None}


def procesar(cur, censo_id: str, ctx: Contexto | None = None) -> dict:
    """Procesa un censo recien guardado: duplicado y clientes. Se llama en
    la misma transaccion que lo inserta. Para procesar muchos, pasar el mismo
    Contexto y hacerlo en orden de terminadoEn."""
    ctx = ctx or Contexto(cur)
    cur.execute(
        'SELECT "id", "respuestas", "lat", "lng", "terminadoEn", "nombreComercio", "ruta" FROM "Censo" WHERE "id" = %s',
        (censo_id,),
    )
    censo = cur.fetchone()
    respuestas = censo["respuestas"]
    claves = claves_de(respuestas)
    posible = not claves and es_posible_cliente(respuestas)
    rif = rif_normalizado(respuestas.get("rif")) if posible else None
    duplicado_de = ctx.duplicado_de(censo, claves, rif) if (claves or rif) else None
    if duplicado_de:
        cur.execute('UPDATE "Censo" SET "duplicadoDeId" = %s WHERE "id" = %s', (duplicado_de, censo_id))
    else:
        ctx.registrar(censo, claves, rif)
    clientes = [_procesar_clave(ctx, censo, c) for c in claves]
    return {"duplicadoDe": duplicado_de, "posibleCliente": posible, "clientes": clientes}


# ---------- Recalculos al cambiar la maestra o las ventas ----------


def recalcular_en_maestra(cur, empresa: str) -> int:
    """Al cambiar la maestra, cada cliente censado vuelve a mirar si esta en
    la vigente. Devuelve cuantos cambiaron."""
    cur.execute(
        """
        UPDATE "CensoCliente" cc SET "enMaestra" = n."esta"
        FROM (
            SELECT cc2."id", EXISTS (
                SELECT 1 FROM "MaestraCliente" mc
                WHERE mc."cargaId" = (
                    SELECT "id" FROM "MaestraCarga" WHERE "empresa" = %(e)s ORDER BY "subidaEn" DESC LIMIT 1
                ) AND mc."codigo" = cc2."codigo"
            ) AS "esta"
            FROM "CensoCliente" cc2 WHERE cc2."empresa" = %(e)s
        ) n
        WHERE cc."id" = n."id" AND cc."enMaestra" IS DISTINCT FROM n."esta"
        """,
        {"e": empresa},
    )
    return cur.rowcount


def recalcular_en_ventas(cur, empresa: str) -> int:
    """Al confirmar una carga de ventas: los censados que ya aparecen."""
    cur.execute(
        """
        UPDATE "CensoCliente" cc SET "enVentas" = n."esta"
        FROM (
            SELECT cc2."id", EXISTS (
                SELECT 1 FROM "VentaCliente" v
                WHERE v."empresa" = %(e)s AND (v."codigo" = cc2."codigo" OR ltrim(v."codigo", '0') = cc2."codigo")
            ) AS "esta"
            FROM "CensoCliente" cc2 WHERE cc2."empresa" = %(e)s
        ) n
        WHERE cc."id" = n."id" AND cc."enVentas" IS DISTINCT FROM n."esta"
        """,
        {"e": empresa},
    )
    return cur.rowcount
