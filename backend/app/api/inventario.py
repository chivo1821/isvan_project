"""Inventario del sistema administrativo: existencias por lote, entradas
(compras, conteo inicial), traslados y ajustes con aprobacion. Exige el
modulo de inventario encendido para la empresa. Ver app/services/inventario.py."""

from __future__ import annotations

import io
import uuid
from datetime import date, datetime
from decimal import Decimal, InvalidOperation

import openpyxl
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field

from app.core.db import get_connection
from app.core.fechas import ahora_utc
from app.core.permisos import requiere_permiso
from app.services import bitacora, empresas
from app.services import inventario as inv
from app.services.ventas import exigir_modulo

router = APIRouter(prefix="/inventario", tags=["inventario"])


class RenglonEntrada(BaseModel):
    productoId: str
    lote: str | None = Field(default=None, max_length=40)
    vencimiento: date | None = None
    cajas: Decimal = Field(gt=0, le=Decimal("1000000"))


class Entrada(BaseModel):
    empresaId: str
    almacenId: str
    referencia: str | None = Field(default=None, max_length=120)
    items: list[RenglonEntrada] = Field(min_length=1, max_length=2000)


class Traslado(BaseModel):
    empresaId: str
    desdeAlmacenId: str
    haciaAlmacenId: str
    productoId: str
    loteId: str
    cajas: Decimal = Field(gt=0)


class RenglonAjuste(BaseModel):
    productoId: str
    loteId: str
    # Con signo: positivo suma, negativo resta.
    cajas: Decimal


class AjusteDatos(BaseModel):
    empresaId: str
    almacenId: str
    motivo: str = Field(min_length=3, max_length=300)
    items: list[RenglonAjuste] = Field(min_length=1, max_length=500)


def _abrir(cur, usuario: dict, empresa_id: str) -> dict:
    empresa = empresas.exigir(cur, usuario, empresa_id)
    exigir_modulo(cur, empresa_id, "inventario")
    return empresa


def _almacen(cur, almacen_id: str) -> None:
    cur.execute('SELECT 1 FROM "Almacen" WHERE "id" = %s', (almacen_id,))
    if not cur.fetchone():
        raise HTTPException(400, "Almacen desconocido")


def _productos_de(cur, empresa_id: str, ids: list[str]) -> None:
    cur.execute('SELECT "id" FROM "Producto" WHERE "empresaId" = %s AND "id" = ANY(%s)', (empresa_id, ids))
    if len({f["id"] for f in cur.fetchall()}) != len(set(ids)):
        raise HTTPException(400, "Algun producto no es de esta empresa")


@router.get("/existencias")
def existencias(empresaId: str, almacenId: str | None = None, usuario: dict = Depends(requiere_permiso("inventario.ver"))):
    with get_connection() as conn, conn.cursor() as cur:
        _abrir(cur, usuario, empresaId)
        return inv.existencias(cur, empresaId, almacenId)


@router.get("/movimientos")
def movimientos(
    empresaId: str, productoId: str | None = None, usuario: dict = Depends(requiere_permiso("inventario.ver"))
):
    with get_connection() as conn, conn.cursor() as cur:
        _abrir(cur, usuario, empresaId)
        cur.execute(
            'SELECT m."id", m."fecha" AT TIME ZONE \'UTC\' AS "fecha", m."tipo", m."cajas", m."referencia", '
            'p."codigo", p."nombre", l."numero" AS "lote", a."nombre" AS "almacen", d."numero" AS "documento", '
            'u."nombre" AS "usuario" FROM "MovimientoInventario" m JOIN "Producto" p ON p."id" = m."productoId" '
            'JOIN "Lote" l ON l."id" = m."loteId" JOIN "Almacen" a ON a."id" = m."almacenId" '
            'LEFT JOIN "DocumentoVenta" d ON d."id" = m."documentoVentaId" LEFT JOIN "Usuario" u ON u."id" = m."usuarioId" '
            'WHERE m."empresaId" = %s AND (%s::text IS NULL OR m."productoId" = %s) ORDER BY m."id" DESC LIMIT 500',
            (empresaId, productoId, productoId),
        )
        return [{**f, "id": int(f["id"]), "cajas": float(f["cajas"]), "codigo": int(f["codigo"])} for f in cur.fetchall()]


def _registrar_entrada(cur, empresa_id: str, almacen_id: str, items: list[RenglonEntrada], referencia: str | None,
                       usuario_id: str) -> int:
    for it in items:
        lote_id = inv.lote(cur, it.productoId, it.lote, it.vencimiento)
        inv.mover(cur, empresa_id=empresa_id, almacen_id=almacen_id, producto_id=it.productoId, lote_id=lote_id,
                  tipo="ENTRADA", cajas=it.cajas, referencia=referencia, usuario_id=usuario_id)
    bitacora.registrar(cur, usuario_id, "Inventario", almacen_id, "entrada", None,
                       {"referencia": referencia, "renglones": len(items)})
    return len(items)


@router.post("/entradas", status_code=201)
def registrar_entrada(data: Entrada, usuario: dict = Depends(requiere_permiso("inventario.entradas"))):
    with get_connection() as conn, conn.cursor() as cur:
        _abrir(cur, usuario, data.empresaId)
        _almacen(cur, data.almacenId)
        _productos_de(cur, data.empresaId, [i.productoId for i in data.items])
        n = _registrar_entrada(cur, data.empresaId, data.almacenId, data.items, data.referencia, usuario["id"])
        conn.commit()
    return {"renglones": n}


def _leer_fecha(valor) -> date | None:
    if valor in (None, ""):
        return None
    if isinstance(valor, datetime):
        return valor.date()
    if isinstance(valor, date):
        return valor
    texto = str(valor).strip()
    for formato in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y"):
        try:
            return datetime.strptime(texto, formato).date()
        except ValueError:
            continue
    raise ValueError(texto)


@router.post("/entradas/excel")
async def entrada_desde_excel(
    empresaId: str, almacenId: str, referencia: str = "Conteo inicial", confirmar: bool = False,
    archivo: UploadFile = File(...), usuario: dict = Depends(requiere_permiso("inventario.entradas")),
):
    """Excel con: codigo de producto, cajas, lote (opcional), vencimiento
    (opcional). Sin confirmar=true solo devuelve la vista previa."""
    contenido = await archivo.read()
    if len(contenido) > 5 * 1024 * 1024:
        raise HTTPException(400, "El archivo pesa mas de 5 MB")
    try:
        filas = list(openpyxl.load_workbook(io.BytesIO(contenido), read_only=True, data_only=True).active.iter_rows(values_only=True))
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, "No se pudo leer el Excel") from e
    with get_connection() as conn, conn.cursor() as cur:
        _abrir(cur, usuario, empresaId)
        _almacen(cur, almacenId)
        cur.execute('SELECT "id", "codigo", "nombre" FROM "Producto" WHERE "empresaId" = %s', (empresaId,))
        por_codigo = {int(f["codigo"]): f for f in cur.fetchall()}
        items, vista, problemas = [], [], []
        for n, fila in enumerate(filas, start=1):
            if not fila or fila[0] in (None, ""):
                continue
            try:
                codigo = int(str(fila[0]).strip().split(".")[0])
                cajas = Decimal(str(fila[1]).replace(",", "."))
                vence = _leer_fecha(fila[3]) if len(fila) > 3 else None
            except (ValueError, InvalidOperation, IndexError, TypeError):
                if n > 1:
                    problemas.append({"fila": n, "motivo": "codigo, cajas o fecha no validos"})
                continue
            if codigo not in por_codigo:
                problemas.append({"fila": n, "motivo": f"el producto {codigo} no esta en el catalogo"})
                continue
            if cajas <= 0:
                problemas.append({"fila": n, "motivo": "cajas debe ser mayor que cero"})
                continue
            lote = str(fila[2]).strip() if len(fila) > 2 and fila[2] not in (None, "") else None
            items.append(RenglonEntrada(productoId=por_codigo[codigo]["id"], lote=lote, vencimiento=vence, cajas=cajas))
            vista.append({"fila": n, "codigo": codigo, "nombre": por_codigo[codigo]["nombre"], "cajas": float(cajas),
                          "lote": lote, "vencimiento": vence})
        if confirmar:
            if problemas:
                raise HTTPException(409, "Corrige las filas con problemas antes de confirmar")
            _registrar_entrada(cur, empresaId, almacenId, items, referencia, usuario["id"])
            conn.commit()
    return {"confirmado": confirmar, "renglones": vista, "problemas": problemas[:300]}


@router.post("/traslados", status_code=201)
def trasladar(data: Traslado, usuario: dict = Depends(requiere_permiso("inventario.entradas"))):
    if data.desdeAlmacenId == data.haciaAlmacenId:
        raise HTTPException(400, "El traslado necesita dos almacenes distintos")
    with get_connection() as conn, conn.cursor() as cur:
        _abrir(cur, usuario, data.empresaId)
        _almacen(cur, data.desdeAlmacenId)
        _almacen(cur, data.haciaAlmacenId)
        _productos_de(cur, data.empresaId, [data.productoId])
        referencia = f"Traslado {uuid.uuid4().hex[:6]}"
        try:
            inv.mover(cur, empresa_id=data.empresaId, almacen_id=data.desdeAlmacenId, producto_id=data.productoId,
                      lote_id=data.loteId, tipo="TRASLADO_SALIDA", cajas=-data.cajas, referencia=referencia,
                      usuario_id=usuario["id"])
        except inv.SinExistencia as e:
            raise HTTPException(409, f"No alcanza la existencia del lote: {e}") from e
        inv.mover(cur, empresa_id=data.empresaId, almacen_id=data.haciaAlmacenId, producto_id=data.productoId,
                  lote_id=data.loteId, tipo="TRASLADO_ENTRADA", cajas=data.cajas, referencia=referencia,
                  usuario_id=usuario["id"])
        conn.commit()
    return {"referencia": referencia}


@router.get("/ajustes")
def listar_ajustes(empresaId: str, usuario: dict = Depends(requiere_permiso("inventario.ver"))):
    with get_connection() as conn, conn.cursor() as cur:
        _abrir(cur, usuario, empresaId)
        cur.execute(
            'SELECT a."id", a."estado", a."motivo", a."items", a."creadoEn" AT TIME ZONE \'UTC\' AS "creadoEn", '
            'a."resueltoEn" AT TIME ZONE \'UTC\' AS "resueltoEn", p."nombre" AS "propuestoPor", r."nombre" AS "resueltoPor", '
            'al."nombre" AS "almacen" FROM "AjusteInventario" a JOIN "Usuario" p ON p."id" = a."propuestoPorId" '
            'LEFT JOIN "Usuario" r ON r."id" = a."resueltoPorId" JOIN "Almacen" al ON al."id" = a."almacenId" '
            'WHERE a."empresaId" = %s ORDER BY a."creadoEn" DESC LIMIT 200',
            (empresaId,),
        )
        return cur.fetchall()


@router.post("/ajustes", status_code=201)
def proponer_ajuste(data: AjusteDatos, usuario: dict = Depends(requiere_permiso("inventario.ajustar"))):
    if any(i.cajas == 0 for i in data.items):
        raise HTTPException(400, "Un renglon del ajuste no mueve nada")
    with get_connection() as conn, conn.cursor() as cur:
        _abrir(cur, usuario, data.empresaId)
        _almacen(cur, data.almacenId)
        _productos_de(cur, data.empresaId, [i.productoId for i in data.items])
        ajuste_id = f"aju-{uuid.uuid4().hex[:12]}"
        cur.execute(
            'INSERT INTO "AjusteInventario" ("id", "empresaId", "almacenId", "motivo", "items", "propuestoPorId") '
            "VALUES (%s, %s, %s, %s, %s, %s)",
            (ajuste_id, data.empresaId, data.almacenId, data.motivo.strip(),
             Jsonb([{"productoId": i.productoId, "loteId": i.loteId, "cajas": str(i.cajas)} for i in data.items]),
             usuario["id"]),
        )
        bitacora.registrar(cur, usuario["id"], "AjusteInventario", ajuste_id, "proponer", None, data.model_dump(mode="json"))
        conn.commit()
    return {"id": ajuste_id}


@router.post("/ajustes/{ajuste_id}/{decision}")
def resolver_ajuste(ajuste_id: str, decision: str, usuario: dict = Depends(requiere_permiso("inventario.aprobar_ajuste"))):
    if decision not in ("aprobar", "rechazar"):
        raise HTTPException(404, "Accion desconocida")
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute('SELECT * FROM "AjusteInventario" WHERE "id" = %s FOR UPDATE', (ajuste_id,))
        ajuste = cur.fetchone()
        if not ajuste:
            raise HTTPException(404, "Ajuste no encontrado")
        _abrir(cur, usuario, ajuste["empresaId"])
        if ajuste["estado"] != "PROPUESTO":
            raise HTTPException(409, "El ajuste ya se resolvio")
        if ajuste["propuestoPorId"] == usuario["id"] and usuario["rol"] != "ADMIN":
            raise HTTPException(403, "El ajuste lo aprueba alguien distinto de quien lo propuso")
        if decision == "aprobar":
            try:
                for it in ajuste["items"]:
                    inv.mover(cur, empresa_id=ajuste["empresaId"], almacen_id=ajuste["almacenId"],
                              producto_id=it["productoId"], lote_id=it["loteId"], tipo="AJUSTE",
                              cajas=Decimal(it["cajas"]), ajuste_id=ajuste_id, referencia=ajuste["motivo"],
                              usuario_id=usuario["id"])
            except inv.SinExistencia as e:
                raise HTTPException(409, f"El ajuste deja un lote en negativo: {e}") from e
        estado = "APROBADO" if decision == "aprobar" else "RECHAZADO"
        cur.execute(
            'UPDATE "AjusteInventario" SET "estado" = %s, "resueltoPorId" = %s, "resueltoEn" = %s WHERE "id" = %s',
            (estado, usuario["id"], ahora_utc(), ajuste_id),
        )
        bitacora.registrar(cur, usuario["id"], "AjusteInventario", ajuste_id, decision)
        conn.commit()
    return {"estado": estado}
