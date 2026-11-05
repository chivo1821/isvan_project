"""Catalogo del sistema administrativo: productos, impuestos, listas de
precio y la ficha fiscal de los clientes.

Hasta el corte, el catalogo se alimenta del extracto de ventas
(VentaProducto / VentaCliente) con /catalogo/sincronizar: copia lo nuevo y
completa lo vacio, nunca pisa lo que ya se edito aca.
"""

from __future__ import annotations

import io
import re
from datetime import date
from decimal import Decimal, InvalidOperation

import openpyxl
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field

from app.core.db import get_connection
from app.core.fechas import ahora_utc, hoy_caracas
from app.core.permisos import requiere_permiso
from app.services import bitacora, empresas

router = APIRouter(prefix="/catalogo", tags=["catalogo"])

IMPUESTOS = ("IVA_GENERAL", "IVA_REDUCIDO", "IVA_ADICIONAL", "EXENTO")

_PRODUCTO = (
    'p."id", p."empresaId", p."codigo", p."nombre", p."grupo", p."codigoProveedor", p."unidadesPorCaja", '
    'p."litrosPorUnidad", p."pesoCajaKg", p."impuestoCodigo", p."requiereFrio", p."manejaLote", p."activo"'
)


class ProductoDatos(BaseModel):
    codigo: int = Field(gt=0)
    nombre: str = Field(min_length=2, max_length=200)
    grupo: str | None = Field(default=None, max_length=100)
    codigoProveedor: str | None = Field(default=None, max_length=60)
    unidadesPorCaja: int = Field(default=1, ge=1, le=10000)
    litrosPorUnidad: Decimal | None = Field(default=None, ge=0)
    pesoCajaKg: Decimal | None = Field(default=None, ge=0)
    impuestoCodigo: str = "IVA_GENERAL"
    requiereFrio: bool = True
    manejaLote: bool = True
    activo: bool = True


class PrecioItem(BaseModel):
    productoId: str
    precioCajaUsd: Decimal = Field(ge=0, le=Decimal("1000000"))


class PreciosUpdate(BaseModel):
    precios: list[PrecioItem] = Field(max_length=5000)


class ListaDatos(BaseModel):
    codigo: str = Field(min_length=1, max_length=40)
    nombre: str = Field(min_length=1, max_length=120)


class FichaFiscal(BaseModel):
    rifCedula: str | None = Field(default=None, max_length=20)
    razonSocial: str | None = Field(default=None, max_length=200)
    domicilioFiscal: str | None = Field(default=None, max_length=500)
    contribuyenteEspecial: bool = False
    porcentajeRetencionIva: int | None = None
    limiteCreditoUsd: Decimal | None = Field(default=None, ge=0)
    diasCredito: int | None = Field(default=None, ge=0, le=365)
    rutaVenta: str | None = Field(default=None, max_length=20)
    tipoVenta: str | None = Field(default=None, max_length=40)
    listaPrecioCodigo: str | None = Field(default=None, max_length=40)


def _producto_json(p: dict) -> dict:
    return {
        **p,
        "codigo": int(p["codigo"]),
        "litrosPorUnidad": float(p["litrosPorUnidad"]) if p["litrosPorUnidad"] is not None else None,
        "pesoCajaKg": float(p["pesoCajaKg"]) if p["pesoCajaKg"] is not None else None,
    }


def normalizar_rif_cedula(valor: str | None) -> str | None:
    """RIF (J-12345678-9) o cedula (V-12345678). None si viene vacio."""
    if not valor or not valor.strip():
        return None
    limpio = valor.strip().upper().replace(" ", "").replace(".", "")
    m = re.fullmatch(r"([VEJPGC])-?(\d{6,9})(?:-?(\d))?", limpio)
    if not m:
        raise HTTPException(400, "El RIF o cedula debe tener la forma J-12345678-9 o V-12345678")
    return f"{m[1]}-{m[2]}" + (f"-{m[3]}" if m[3] else "")


# ---------- Impuestos ----------


def alicuota_vigente(cur, codigo: str, organizacion_id: str = "org-principal", fecha: date | None = None) -> Decimal:
    cur.execute(
        'SELECT "porcentaje" FROM "Impuesto" WHERE "organizacionId" = %s AND "codigo" = %s AND "vigenteDesde" <= %s '
        'AND ("vigenteHasta" IS NULL OR "vigenteHasta" >= %s) ORDER BY "vigenteDesde" DESC LIMIT 1',
        (organizacion_id, codigo, fecha or hoy_caracas(), fecha or hoy_caracas()),
    )
    fila = cur.fetchone()
    if not fila:
        raise HTTPException(409, f"No hay alicuota vigente para {codigo}")
    return Decimal(fila["porcentaje"])


@router.get("/impuestos")
def listar_impuestos(usuario: dict = Depends(requiere_permiso("catalogo.ver"))):
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            'SELECT "codigo", "nombre", "porcentaje", "vigenteDesde", "vigenteHasta" FROM "Impuesto" '
            'WHERE "organizacionId" = %s ORDER BY "codigo", "vigenteDesde" DESC',
            (usuario.get("organizacionId", "org-principal"),),
        )
        return [{**f, "porcentaje": float(f["porcentaje"])} for f in cur.fetchall()]


# ---------- Productos ----------


@router.get("/productos")
def listar_productos(
    empresaId: str,
    buscar: str | None = Query(default=None, max_length=80),
    soloActivos: bool = False,
    usuario: dict = Depends(requiere_permiso("catalogo.ver")),
):
    with get_connection() as conn, conn.cursor() as cur:
        empresas.exigir(cur, usuario, empresaId)
        condiciones, params = ['p."empresaId" = %s'], [empresaId]
        if soloActivos:
            condiciones.append('p."activo"')
        if buscar:
            condiciones.append('(p."nombre" ILIKE %s OR p."codigo"::text = %s OR p."grupo" ILIKE %s)')
            params += [f"%{buscar}%", buscar.strip(), f"%{buscar}%"]
        cur.execute(
            f'SELECT {_PRODUCTO} FROM "Producto" p WHERE {" AND ".join(condiciones)} ORDER BY p."grupo", p."nombre" '
            "LIMIT 2000",
            params,
        )
        return [_producto_json(p) for p in cur.fetchall()]


def _validar_impuesto(codigo: str) -> None:
    if codigo not in IMPUESTOS:
        raise HTTPException(400, f"Impuesto desconocido: usa {', '.join(IMPUESTOS)}")


@router.post("/productos", status_code=201)
def crear_producto(empresaId: str, data: ProductoDatos, usuario: dict = Depends(requiere_permiso("catalogo.editar"))):
    _validar_impuesto(data.impuestoCodigo)
    with get_connection() as conn, conn.cursor() as cur:
        empresas.exigir(cur, usuario, empresaId)
        cur.execute('SELECT 1 FROM "Producto" WHERE "empresaId" = %s AND "codigo" = %s', (empresaId, data.codigo))
        if cur.fetchone():
            raise HTTPException(409, f"Ya hay un producto con el codigo {data.codigo}")
        valores = data.model_dump()
        columnas = ", ".join(f'"{c}"' for c in valores)
        marcas = ", ".join(f"%({c})s" for c in valores)
        cur.execute(
            f'INSERT INTO "Producto" ("id", "empresaId", "organizacionId", {columnas}) '
            f"VALUES ('prod-' || substr(md5(random()::text || clock_timestamp()::text), 1, 16), %(empresa)s, %(org)s, {marcas}) "
            f'RETURNING {_PRODUCTO.replace("p.", "")}',
            {**valores, "empresa": empresaId, "org": usuario.get("organizacionId", "org-principal")},
        )
        producto = cur.fetchone()
        bitacora.registrar(cur, usuario["id"], "Producto", producto["id"], "crear", None, producto)
        conn.commit()
    return _producto_json(producto)


@router.put("/productos/{producto_id}")
def editar_producto(producto_id: str, data: ProductoDatos, usuario: dict = Depends(requiere_permiso("catalogo.editar"))):
    _validar_impuesto(data.impuestoCodigo)
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(f'SELECT {_PRODUCTO} FROM "Producto" p WHERE p."id" = %s', (producto_id,))
        antes = cur.fetchone()
        if not antes:
            raise HTTPException(404, "Producto no encontrado")
        empresas.exigir(cur, usuario, antes["empresaId"])
        if int(antes["codigo"]) != data.codigo:
            raise HTTPException(400, "El codigo de un producto no se cambia: crea otro")
        valores = data.model_dump()
        columnas = ", ".join(f'"{c}" = %({c})s' for c in valores)
        cur.execute(
            f'UPDATE "Producto" SET {columnas}, "actualizadoEn" = %(ahora)s WHERE "id" = %(id)s '
            f'RETURNING {_PRODUCTO.replace("p.", "")}',
            {**valores, "ahora": ahora_utc(), "id": producto_id},
        )
        despues = cur.fetchone()
        bitacora.registrar(cur, usuario["id"], "Producto", producto_id, "editar", antes, despues)
        conn.commit()
    return _producto_json(despues)


# ---------- Sincronizar desde el extracto de ventas ----------


def sincronizar(cur, empresa: dict) -> dict:
    """Copia al catalogo lo que trae el extracto de ventas de la empresa:
    productos nuevos, listas de precio nuevas y, en Cliente, la ruta, el tipo y
    la lista de precio que esten vacios. No pisa lo editado."""
    codigo_empresa = empresa["codigo"]
    cur.execute(
        """
        INSERT INTO "Producto" ("id", "organizacionId", "empresaId", "codigo", "nombre", "grupo", "codigoProveedor",
                                "unidadesPorCaja", "litrosPorUnidad")
        SELECT 'prod-' || substr(md5(vp."id"), 1, 16), %(org)s, %(empresa_id)s, vp."codigo", vp."nombre", vp."grupo",
               vp."codigoProveedor", COALESCE(NULLIF(vp."unidadesPorCaja", 0), 1), vp."litrosPorUnidad"
        FROM "VentaProducto" vp
        WHERE vp."empresa"::text = %(codigo)s
        ON CONFLICT ("empresaId", "codigo") DO UPDATE SET
            "grupo" = COALESCE("Producto"."grupo", EXCLUDED."grupo"),
            "litrosPorUnidad" = COALESCE("Producto"."litrosPorUnidad", EXCLUDED."litrosPorUnidad")
        WHERE "Producto"."grupo" IS NULL OR "Producto"."litrosPorUnidad" IS NULL
        """,
        {"org": empresa["organizacionId"], "empresa_id": empresa["id"], "codigo": codigo_empresa},
    )
    productos = cur.rowcount
    cur.execute(
        """
        INSERT INTO "ListaPrecio" ("id", "organizacionId", "empresaId", "codigo", "nombre")
        SELECT DISTINCT 'lista-' || substr(md5(%(empresa_id)s || vc."listaPrecio"), 1, 16), %(org)s, %(empresa_id)s,
               vc."listaPrecio", 'Lista ' || vc."listaPrecio"
        FROM "VentaCliente" vc
        WHERE vc."empresa"::text = %(codigo)s AND COALESCE(vc."listaPrecio", '') <> ''
        ON CONFLICT ("empresaId", "codigo") DO NOTHING
        """,
        {"org": empresa["organizacionId"], "empresa_id": empresa["id"], "codigo": codigo_empresa},
    )
    listas = cur.rowcount
    cur.execute(
        """
        UPDATE "Cliente" c SET
            "rutaVenta" = COALESCE(c."rutaVenta", vc."ruta"),
            "tipoVenta" = COALESCE(c."tipoVenta", vc."tipo"),
            "listaPrecioCodigo" = COALESCE(c."listaPrecioCodigo", NULLIF(vc."listaPrecio", ''))
        FROM "VentaCliente" vc
        WHERE vc."empresa" = c."empresa" AND vc."codigo" = c."codigo" AND c."empresa"::text = %(codigo)s
          AND (c."rutaVenta" IS NULL OR c."tipoVenta" IS NULL OR c."listaPrecioCodigo" IS NULL)
        """,
        {"codigo": codigo_empresa},
    )
    return {"productos": productos, "listas": listas, "clientes": cur.rowcount}


@router.post("/sincronizar")
def sincronizar_desde_ventas(empresaId: str, usuario: dict = Depends(requiere_permiso("catalogo.editar"))):
    with get_connection() as conn, conn.cursor() as cur:
        empresa = empresas.exigir(cur, usuario, empresaId)
        resultado = sincronizar(cur, empresa)
        bitacora.registrar(cur, usuario["id"], "EmpresaFiscal", empresaId, "sincronizar_catalogo", None, resultado)
        conn.commit()
    return resultado


# ---------- Listas de precio ----------


@router.get("/listas")
def listar_listas(empresaId: str, usuario: dict = Depends(requiere_permiso("catalogo.ver"))):
    with get_connection() as conn, conn.cursor() as cur:
        empresas.exigir(cur, usuario, empresaId)
        cur.execute(
            'SELECT l."id", l."codigo", l."nombre", l."activa", count(i."id") AS "productosConPrecio", '
            '(SELECT count(*) FROM "Cliente" c JOIN "EmpresaFiscal" e ON e."codigo" = c."empresa"::text '
            ' WHERE e."id" = l."empresaId" AND c."listaPrecioCodigo" = l."codigo") AS "clientes" '
            'FROM "ListaPrecio" l LEFT JOIN "ListaPrecioItem" i ON i."listaId" = l."id" '
            'WHERE l."empresaId" = %s GROUP BY l."id" ORDER BY l."codigo"',
            (empresaId,),
        )
        return cur.fetchall()


@router.post("/listas", status_code=201)
def crear_lista(empresaId: str, data: ListaDatos, usuario: dict = Depends(requiere_permiso("precios.editar"))):
    with get_connection() as conn, conn.cursor() as cur:
        empresa = empresas.exigir(cur, usuario, empresaId)
        cur.execute(
            'INSERT INTO "ListaPrecio" ("id", "organizacionId", "empresaId", "codigo", "nombre") '
            "VALUES ('lista-' || substr(md5(%s || %s), 1, 16), %s, %s, %s, %s) "
            'ON CONFLICT ("empresaId", "codigo") DO NOTHING RETURNING "id", "codigo", "nombre", "activa"',
            (empresaId, data.codigo.strip(), empresa["organizacionId"], empresaId, data.codigo.strip(), data.nombre.strip()),
        )
        lista = cur.fetchone()
        if not lista:
            raise HTTPException(409, f"Ya hay una lista con el codigo {data.codigo}")
        bitacora.registrar(cur, usuario["id"], "ListaPrecio", lista["id"], "crear", None, lista)
        conn.commit()
    return lista


def _lista(cur, usuario: dict, lista_id: str) -> dict:
    cur.execute('SELECT * FROM "ListaPrecio" WHERE "id" = %s', (lista_id,))
    lista = cur.fetchone()
    if not lista:
        raise HTTPException(404, "Lista no encontrada")
    empresas.exigir(cur, usuario, lista["empresaId"])
    return lista


@router.get("/listas/{lista_id}/precios")
def precios_de_lista(lista_id: str, usuario: dict = Depends(requiere_permiso("catalogo.ver"))):
    """Todos los productos activos de la empresa con su precio en la lista
    (null si no tiene)."""
    with get_connection() as conn, conn.cursor() as cur:
        lista = _lista(cur, usuario, lista_id)
        cur.execute(
            f'SELECT {_PRODUCTO}, i."precioCajaUsd" FROM "Producto" p '
            'LEFT JOIN "ListaPrecioItem" i ON i."productoId" = p."id" AND i."listaId" = %s '
            'WHERE p."empresaId" = %s AND p."activo" ORDER BY p."grupo", p."nombre"',
            (lista_id, lista["empresaId"]),
        )
        return [
            {**_producto_json(f), "precioCajaUsd": float(f["precioCajaUsd"]) if f["precioCajaUsd"] is not None else None}
            for f in cur.fetchall()
        ]


def _guardar_precios(cur, lista: dict, precios: list[tuple[str, Decimal]], usuario_id: str) -> int:
    cur.execute('SELECT "id" FROM "Producto" WHERE "empresaId" = %s', (lista["empresaId"],))
    validos = {f["id"] for f in cur.fetchall()}
    ajenos = [pid for pid, _ in precios if pid not in validos]
    if ajenos:
        raise HTTPException(400, f"{len(ajenos)} producto(s) no son de esta empresa")
    cur.executemany(
        'INSERT INTO "ListaPrecioItem" ("id", "listaId", "productoId", "precioCajaUsd", "actualizadoEn", "actualizadoPorId") '
        "VALUES ('lpi-' || substr(md5(%s || %s), 1, 16), %s, %s, %s, %s, %s) "
        'ON CONFLICT ("listaId", "productoId") DO UPDATE SET "precioCajaUsd" = EXCLUDED."precioCajaUsd", '
        '"actualizadoEn" = EXCLUDED."actualizadoEn", "actualizadoPorId" = EXCLUDED."actualizadoPorId"',
        [(lista["id"], pid, lista["id"], pid, precio, ahora_utc(), usuario_id) for pid, precio in precios],
    )
    bitacora.registrar(
        cur, usuario_id, "ListaPrecio", lista["id"], "precios", None,
        {"cambiados": len(precios), "precios": {pid: precio for pid, precio in precios[:500]}},
    )
    return len(precios)


@router.put("/listas/{lista_id}/precios")
def guardar_precios(lista_id: str, data: PreciosUpdate, usuario: dict = Depends(requiere_permiso("precios.editar"))):
    with get_connection() as conn, conn.cursor() as cur:
        lista = _lista(cur, usuario, lista_id)
        n = _guardar_precios(cur, lista, [(p.productoId, p.precioCajaUsd) for p in data.precios], usuario["id"])
        conn.commit()
    return {"guardados": n}


@router.post("/listas/{lista_id}/precios/excel")
async def importar_precios(
    lista_id: str, archivo: UploadFile = File(...), usuario: dict = Depends(requiere_permiso("precios.editar"))
):
    """Excel con dos columnas: codigo del producto y precio por caja en USD
    (con o sin encabezado). Devuelve lo que no se pudo leer."""
    contenido = await archivo.read()
    if len(contenido) > 5 * 1024 * 1024:
        raise HTTPException(400, "El archivo pesa mas de 5 MB")
    try:
        libro = openpyxl.load_workbook(io.BytesIO(contenido), read_only=True, data_only=True)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, "No se pudo leer el Excel") from e
    filas = list(libro.active.iter_rows(values_only=True))
    with get_connection() as conn, conn.cursor() as cur:
        lista = _lista(cur, usuario, lista_id)
        cur.execute('SELECT "id", "codigo" FROM "Producto" WHERE "empresaId" = %s', (lista["empresaId"],))
        por_codigo = {int(f["codigo"]): f["id"] for f in cur.fetchall()}
        precios, problemas = [], []
        for n, fila in enumerate(filas, start=1):
            if not fila or fila[0] in (None, ""):
                continue
            try:
                codigo = int(str(fila[0]).strip().split(".")[0])
                precio = Decimal(str(fila[1]).replace(",", ".")) if len(fila) > 1 and fila[1] not in (None, "") else None
            except (ValueError, InvalidOperation):
                if n > 1:
                    problemas.append({"fila": n, "motivo": "codigo o precio no numerico"})
                continue
            if precio is None or precio < 0:
                problemas.append({"fila": n, "motivo": "sin precio"})
            elif codigo not in por_codigo:
                problemas.append({"fila": n, "motivo": f"el producto {codigo} no esta en el catalogo"})
            else:
                precios.append((por_codigo[codigo], precio))
        guardados = _guardar_precios(cur, lista, precios, usuario["id"]) if precios else 0
        conn.commit()
    return {"guardados": guardados, "problemas": problemas[:200]}


# ---------- Ficha fiscal del cliente ----------


@router.put("/clientes/{cliente_id}/ficha")
def editar_ficha(cliente_id: str, data: FichaFiscal, usuario: dict = Depends(requiere_permiso("clientes.ficha_fiscal"))):
    if data.contribuyenteEspecial and data.porcentajeRetencionIva not in (75, 100):
        raise HTTPException(400, "Un contribuyente especial retiene el 75 o el 100 % del IVA")
    campos = list(FichaFiscal.model_fields)
    with get_connection() as conn, conn.cursor() as cur:
        columnas = ", ".join(f'"{c}"' for c in campos)
        cur.execute(f'SELECT "id", "empresa", {columnas} FROM "Cliente" WHERE "id" = %s', (cliente_id,))
        antes = cur.fetchone()
        if not antes:
            raise HTTPException(404, "Cliente no encontrado")
        valores = data.model_dump()
        valores["rifCedula"] = normalizar_rif_cedula(data.rifCedula)
        if not data.contribuyenteEspecial:
            valores["porcentajeRetencionIva"] = None
        sets = ", ".join(f'"{c}" = %({c})s' for c in valores)
        cur.execute(f'UPDATE "Cliente" SET {sets} WHERE "id" = %(id)s', {**valores, "id": cliente_id})
        bitacora.registrar(cur, usuario["id"], "Cliente", cliente_id, "ficha_fiscal", antes, valores)
        conn.commit()
    return {**valores, "id": cliente_id}
