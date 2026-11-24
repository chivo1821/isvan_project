"""Inventario del sistema administrativo: existencias por lote con sus 3 costos
(ultimo, promedio ponderado movil SENIAT Art. 177 RISLR y presupuestario),
entradas valoradas (manuales y Excel), retiros/autoconsumo, Kardex valorado,
libro mensual Art. 177, traslados y ajustes con aprobacion. Exige el modulo de
inventario encendido para la empresa. Ver app/services/inventario.py y
app/services/costos_inventario.py."""

from __future__ import annotations

import io
import uuid
from datetime import date, datetime
from decimal import Decimal, InvalidOperation

import openpyxl
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse
from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field

from app.api.catalogo import _producto_json
from app.core.db import get_connection
from app.core.fechas import ahora_utc
from app.core.permisos import requiere_permiso
from app.services import bitacora, costos_inventario, empresas
from app.services import inventario as inv
from app.services.ventas import exigir_modulo

router = APIRouter(prefix="/inventario", tags=["inventario"])


class RenglonEntrada(BaseModel):
    productoId: str
    lote: str | None = Field(default=None, max_length=40)
    vencimiento: date | None = None
    cajas: Decimal = Field(gt=0, le=Decimal("1000000"))
    costoCajaUsd: Decimal | None = Field(default=None, ge=0)
    costoCajaBs: Decimal | None = Field(default=None, ge=0)
    costoUnitarioUsd: Decimal | None = Field(default=None, ge=0)
    costoUnitarioBs: Decimal | None = Field(default=None, ge=0)
    tasa: Decimal | None = Field(default=None, gt=0)
    proveedor: str | None = Field(default=None, max_length=200)
    numeroFacturaCompra: str | None = Field(default=None, max_length=80)


class Entrada(BaseModel):
    empresaId: str
    almacenId: str
    referencia: str | None = Field(default=None, max_length=120)
    tasa: Decimal | None = Field(default=None, gt=0)
    proveedor: str | None = Field(default=None, max_length=200)
    numeroFacturaCompra: str | None = Field(default=None, max_length=80)
    items: list[RenglonEntrada] = Field(min_length=1, max_length=2000)


class RenglonRetiro(BaseModel):
    productoId: str
    loteId: str | None = None
    cajas: Decimal = Field(gt=0, le=Decimal("1000000"))


class RetiroDatos(BaseModel):
    empresaId: str
    almacenId: str
    tipo: str
    motivo: str | None = Field(default=None, max_length=300)
    items: list[RenglonRetiro] | None = Field(default=None, max_length=500)
    productoId: str | None = None
    loteId: str | None = None
    cajas: Decimal | None = Field(default=None, gt=0, le=Decimal("1000000"))


class CostoPresupuestarioDatos(BaseModel):
    modo: str | None = None
    modoPresupuestario: str | None = None
    porcentaje: Decimal | None = None
    porcentajePresupuestario: Decimal | None = None
    costoPresupuestarioCajaUsd: Decimal | None = None
    costoManualUsd: Decimal | None = None
    motivo: str | None = Field(default=None, max_length=300)


class CostoPresupuestarioMasivoDatos(BaseModel):
    empresaId: str
    modo: str | None = None
    modoPresupuestario: str | None = None
    porcentaje: Decimal | None = None
    porcentajePresupuestario: Decimal | None = None
    costoPresupuestarioCajaUsd: Decimal | None = None
    costoManualUsd: Decimal | None = None
    grupo: str | None = Field(default=None, max_length=100)
    productoIds: list[str] | None = None
    soloActivos: bool = True
    motivo: str | None = Field(default=None, max_length=300)


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
def existencias(
    empresaId: str,
    almacenId: str | None = None,
    usuario: dict = Depends(requiere_permiso("inventario.ver")),
):
    with get_connection() as conn, conn.cursor() as cur:
        _abrir(cur, usuario, empresaId)
        return inv.existencias(cur, empresaId, almacenId)


@router.get("/movimientos")
def movimientos(
    empresaId: str,
    productoId: str | None = None,
    usuario: dict = Depends(requiere_permiso("inventario.ver")),
):
    with get_connection() as conn, conn.cursor() as cur:
        _abrir(cur, usuario, empresaId)
        cur.execute(
            'SELECT m."id", m."fecha" AT TIME ZONE \'UTC\' AS "fecha", m."tipo", m."cajas", m."referencia", '
            'm."costoUnitarioUsd", m."costoUnitarioBs", m."tasa", m."valorTotalUsd", m."valorTotalBs", '
            'm."saldoCajasEmpresa", m."costoPromedioResultanteUsd", m."costoPromedioResultanteBs", '
            'm."proveedor", m."numeroFacturaCompra", '
            'p."codigo", p."nombre", l."numero" AS "lote", a."nombre" AS "almacen", d."numero" AS "documento", '
            'u."nombre" AS "usuario" FROM "MovimientoInventario" m JOIN "Producto" p ON p."id" = m."productoId" '
            'JOIN "Lote" l ON l."id" = m."loteId" JOIN "Almacen" a ON a."id" = m."almacenId" '
            'LEFT JOIN "DocumentoVenta" d ON d."id" = m."documentoVentaId" LEFT JOIN "Usuario" u ON u."id" = m."usuarioId" '
            'WHERE m."empresaId" = %s AND (%s::text IS NULL OR m."productoId" = %s) ORDER BY m."id" DESC LIMIT 500',
            (empresaId, productoId, productoId),
        )
        campos_float = (
            "costoUnitarioUsd",
            "costoUnitarioBs",
            "tasa",
            "valorTotalUsd",
            "valorTotalBs",
            "saldoCajasEmpresa",
            "costoPromedioResultanteUsd",
            "costoPromedioResultanteBs",
        )
        return [
            {
                **f,
                "id": int(f["id"]),
                "cajas": float(f["cajas"]),
                "codigo": int(f["codigo"]),
                **{c: (float(f[c]) if f[c] is not None else None) for c in campos_float},
            }
            for f in cur.fetchall()
        ]


@router.get("/kardex/{producto_id}")
def kardex_producto(
    producto_id: str,
    empresaId: str | None = None,
    almacenId: str | None = None,
    desde: date | None = None,
    hasta: date | None = None,
    limite: int = Query(default=500, ge=1, le=2000),
    usuario: dict = Depends(requiere_permiso("inventario.ver")),
):
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute('SELECT "id", "empresaId" FROM "Producto" WHERE "id" = %s', (producto_id,))
        prod = cur.fetchone()
        if not prod:
            raise HTTPException(404, "Producto no encontrado")
        if empresaId and empresaId != prod["empresaId"]:
            raise HTTPException(400, "El producto no pertenece a esta empresa")
        _abrir(cur, usuario, prod["empresaId"])
        return costos_inventario.kardex_producto(
            cur,
            empresa_id=prod["empresaId"],
            producto_id=producto_id,
            almacen_id=almacenId,
            desde=desde,
            hasta=hasta,
            limite=limite,
        )


def _registrar_entrada(
    cur,
    empresa_id: str,
    almacen_id: str,
    items: list[RenglonEntrada],
    referencia: str | None,
    usuario_id: str,
    *,
    tasa_global: Decimal | None = None,
    proveedor_global: str | None = None,
    factura_global: str | None = None,
) -> int:
    prov_base = proveedor_global.strip() if proveedor_global and proveedor_global.strip() else None
    fact_base = factura_global.strip() if factura_global and factura_global.strip() else None
    for it in items:
        lote_id = inv.lote(cur, it.productoId, it.lote, it.vencimiento)
        c_usd = it.costoCajaUsd if it.costoCajaUsd is not None else it.costoUnitarioUsd
        c_bs = it.costoCajaBs if it.costoCajaBs is not None else it.costoUnitarioBs
        tasa_it = it.tasa if it.tasa is not None else tasa_global
        prov_it = (it.proveedor.strip() if it.proveedor and it.proveedor.strip() else None) or prov_base
        fact_it = (
            it.numeroFacturaCompra.strip()
            if it.numeroFacturaCompra and it.numeroFacturaCompra.strip()
            else None
        ) or fact_base
        inv.mover(
            cur,
            empresa_id=empresa_id,
            almacen_id=almacen_id,
            producto_id=it.productoId,
            lote_id=lote_id,
            tipo="ENTRADA",
            cajas=it.cajas,
            referencia=referencia,
            usuario_id=usuario_id,
            costo_unitario_usd=c_usd,
            costo_unitario_bs=c_bs,
            tasa=tasa_it,
            proveedor=prov_it,
            numero_factura_compra=fact_it,
        )
    bitacora.registrar(
        cur,
        usuario_id,
        "Inventario",
        almacen_id,
        "entrada",
        None,
        {
            "referencia": referencia,
            "proveedor": prov_base,
            "numeroFacturaCompra": fact_base,
            "renglones": len(items),
        },
    )
    return len(items)


@router.post("/entradas", status_code=201)
def registrar_entrada(data: Entrada, usuario: dict = Depends(requiere_permiso("inventario.entradas"))):
    with get_connection() as conn, conn.cursor() as cur:
        _abrir(cur, usuario, data.empresaId)
        _almacen(cur, data.almacenId)
        _productos_de(cur, data.empresaId, [i.productoId for i in data.items])
        n = _registrar_entrada(
            cur,
            data.empresaId,
            data.almacenId,
            data.items,
            data.referencia,
            usuario["id"],
            tasa_global=data.tasa,
            proveedor_global=data.proveedor,
            factura_global=data.numeroFacturaCompra,
        )
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


def _leer_decimal_celda(valor) -> Decimal | None:
    if valor in (None, ""):
        return None
    if isinstance(valor, bool):
        raise ValueError("booleano")
    if isinstance(valor, (int, float, Decimal)):
        return Decimal(str(valor))
    s = str(valor).strip()
    if not s:
        return None
    if "," in s and "." in s:
        if s.rfind(",") > s.rfind("."):
            s = s.replace(".", "").replace(",", ".")
        else:
            s = s.replace(",", "")
    elif "," in s:
        s = s.replace(",", ".")
    return Decimal(s)


@router.post("/entradas/excel")
async def entrada_desde_excel(
    empresaId: str,
    almacenId: str,
    referencia: str = "Conteo inicial",
    confirmar: bool = False,
    tasa: Decimal | None = Query(default=None, gt=0),
    proveedor: str | None = Query(default=None, max_length=200),
    numeroFacturaCompra: str | None = Query(default=None, max_length=80),
    archivo: UploadFile = File(...),
    usuario: dict = Depends(requiere_permiso("inventario.entradas")),
):
    """Excel con: codigo de producto (A), cajas (B), lote (C, opc.), vencimiento
    (D, opc.), costoCajaUsd (E, opc.), costoCajaBs (F, opc.), tasa (G, opc.),
    proveedor (H, opc.), numeroFacturaCompra (I, opc.). Sin confirmar=true solo
    devuelve la vista previa."""
    contenido = await archivo.read()
    if len(contenido) > 5 * 1024 * 1024:
        raise HTTPException(400, "El archivo pesa mas de 5 MB")
    try:
        filas = list(
            openpyxl.load_workbook(io.BytesIO(contenido), read_only=True, data_only=True).active.iter_rows(
                values_only=True
            )
        )
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
                cajas = _leer_decimal_celda(fila[1]) if len(fila) > 1 else None
                if cajas is None:
                    raise ValueError("sin cajas")
                vence = _leer_fecha(fila[3]) if len(fila) > 3 else None
                costo_usd = _leer_decimal_celda(fila[4]) if len(fila) > 4 else None
                costo_bs = _leer_decimal_celda(fila[5]) if len(fila) > 5 else None
                tasa_fila = _leer_decimal_celda(fila[6]) if len(fila) > 6 else None
            except (ValueError, InvalidOperation, IndexError, TypeError):
                if n > 1:
                    problemas.append({"fila": n, "motivo": "codigo, cajas, fecha o costos no validos"})
                continue
            if codigo not in por_codigo:
                problemas.append({"fila": n, "motivo": f"el producto {codigo} no esta en el catalogo"})
                continue
            if cajas <= 0:
                problemas.append({"fila": n, "motivo": "cajas debe ser mayor que cero"})
                continue
            if (costo_usd is not None and costo_usd < 0) or (costo_bs is not None and costo_bs < 0):
                problemas.append({"fila": n, "motivo": "el costo no puede ser negativo"})
                continue
            if tasa_fila is not None and tasa_fila <= 0:
                problemas.append({"fila": n, "motivo": "la tasa debe ser mayor que cero"})
                continue
            lote = str(fila[2]).strip() if len(fila) > 2 and fila[2] not in (None, "") else None
            prov_fila = str(fila[7]).strip() if len(fila) > 7 and fila[7] not in (None, "") else None
            fact_fila = str(fila[8]).strip() if len(fila) > 8 and fila[8] not in (None, "") else None
            items.append(
                RenglonEntrada(
                    productoId=por_codigo[codigo]["id"],
                    lote=lote,
                    vencimiento=vence,
                    cajas=cajas,
                    costoCajaUsd=costo_usd,
                    costoCajaBs=costo_bs,
                    tasa=tasa_fila,
                    proveedor=prov_fila,
                    numeroFacturaCompra=fact_fila,
                )
            )
            vista.append({
                "fila": n,
                "codigo": codigo,
                "nombre": por_codigo[codigo]["nombre"],
                "cajas": float(cajas),
                "costoUsd": float(costo_usd) if costo_usd is not None else None,
                "costoCajaUsd": float(costo_usd) if costo_usd is not None else None,
                "costoCajaBs": float(costo_bs) if costo_bs is not None else None,
                "lote": lote,
                "vencimiento": vence,
            })
        if confirmar:
            if problemas:
                raise HTTPException(409, "Corrige las filas con problemas antes de confirmar")
            _registrar_entrada(
                cur,
                empresaId,
                almacenId,
                items,
                referencia,
                usuario["id"],
                tasa_global=tasa,
                proveedor_global=proveedor,
                factura_global=numeroFacturaCompra,
            )
            conn.commit()
    return {"confirmado": confirmar, "renglones": vista, "problemas": problemas[:300]}


@router.post("/retiros", status_code=201)
def registrar_retiro(data: RetiroDatos, usuario: dict = Depends(requiere_permiso("inventario.entradas"))):
    tipo = (data.tipo or "").strip().upper()
    if tipo not in ("RETIRO", "AUTOCONSUMO"):
        raise HTTPException(400, "El tipo debe ser RETIRO o AUTOCONSUMO")
    motivo = (data.motivo or "").strip()
    if len(motivo) < 3:
        raise HTTPException(400, "El motivo es obligatorio (minimo 3 caracteres)")

    if data.items:
        renglones = data.items
    elif data.productoId and data.cajas is not None:
        renglones = [RenglonRetiro(productoId=data.productoId, loteId=data.loteId, cajas=data.cajas)]
    else:
        raise HTTPException(400, "Indica los renglones o productoId y cajas a retirar")

    with get_connection() as conn, conn.cursor() as cur:
        _abrir(cur, usuario, data.empresaId)
        _almacen(cur, data.almacenId)
        _productos_de(cur, data.empresaId, [r.productoId for r in renglones])
        try:
            for r in renglones:
                if r.loteId:
                    inv.mover(
                        cur,
                        empresa_id=data.empresaId,
                        almacen_id=data.almacenId,
                        producto_id=r.productoId,
                        lote_id=r.loteId,
                        tipo=tipo,
                        cajas=-r.cajas,
                        referencia=motivo,
                        usuario_id=usuario["id"],
                    )
                else:
                    inv.salida_por_vencimiento(
                        cur,
                        empresa_id=data.empresaId,
                        almacen_id=data.almacenId,
                        producto_id=r.productoId,
                        cajas=r.cajas,
                        tipo=tipo,
                        documento_id=None,
                        usuario_id=usuario["id"],
                        referencia=motivo,
                    )
        except inv.SinExistencia as e:
            raise HTTPException(409, f"No alcanza la existencia para el {tipo.lower()}: {e}") from e
        bitacora.registrar(
            cur,
            usuario["id"],
            "Inventario",
            data.almacenId,
            tipo.lower(),
            None,
            {
                "tipo": tipo,
                "motivo": motivo,
                "renglones": [
                    {"productoId": r.productoId, "loteId": r.loteId, "cajas": float(r.cajas)} for r in renglones
                ],
            },
        )
        conn.commit()
    return {"renglones": len(renglones), "tipo": tipo, "motivo": motivo}


@router.put("/productos/{producto_id}/costo-presupuestario")
def actualizar_costo_presupuestario(
    producto_id: str,
    data: CostoPresupuestarioDatos,
    usuario: dict = Depends(requiere_permiso("inventario.costos")),
):
    modo = (data.modo or data.modoPresupuestario or "").strip().upper()
    if not modo:
        raise HTTPException(400, "Debes indicar el modo presupuestario")
    porcentaje = data.porcentaje if data.porcentaje is not None else data.porcentajePresupuestario
    costo_manual = (
        data.costoPresupuestarioCajaUsd
        if data.costoPresupuestarioCajaUsd is not None
        else data.costoManualUsd
    )
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute('SELECT "id", "empresaId" FROM "Producto" WHERE "id" = %s', (producto_id,))
        prod = cur.fetchone()
        if not prod:
            raise HTTPException(404, "Producto no encontrado")
        _abrir(cur, usuario, prod["empresaId"])
        actualizado = costos_inventario.configurar_costo_presupuestario(
            cur,
            producto_id=producto_id,
            modo=modo,
            porcentaje=porcentaje,
            costo_manual_usd=costo_manual,
            motivo=data.motivo,
            usuario_id=usuario["id"],
        )
        conn.commit()
    return _producto_json(actualizado)


@router.post("/costos-presupuestarios/masivo")
def actualizar_costo_presupuestario_masivo(
    data: CostoPresupuestarioMasivoDatos,
    usuario: dict = Depends(requiere_permiso("inventario.costos")),
):
    modo = (data.modo or data.modoPresupuestario or "").strip().upper()
    if not modo:
        raise HTTPException(400, "Debes indicar el modo presupuestario")
    porcentaje = data.porcentaje if data.porcentaje is not None else data.porcentajePresupuestario
    costo_manual = (
        data.costoPresupuestarioCajaUsd
        if data.costoPresupuestarioCajaUsd is not None
        else data.costoManualUsd
    )
    with get_connection() as conn, conn.cursor() as cur:
        _abrir(cur, usuario, data.empresaId)
        actualizados = costos_inventario.configurar_costo_presupuestario_masivo(
            cur,
            empresa_id=data.empresaId,
            modo=modo,
            porcentaje=porcentaje,
            costo_manual_usd=costo_manual,
            grupo=data.grupo,
            producto_ids=data.productoIds,
            solo_activos=data.soloActivos,
            motivo=data.motivo,
            usuario_id=usuario["id"],
        )
        conn.commit()
    return {
        "actualizados": len(actualizados),
        "productos": [_producto_json(p) for p in actualizados],
    }


@router.get("/reportes/art-177")
def reporte_art_177(
    empresaId: str,
    mes: str,
    formato: str = Query(default="json"),
    usuario: dict = Depends(requiere_permiso("inventario.ver")),
):
    fmt = (formato or "json").strip().lower()
    if fmt not in ("json", "xlsx"):
        raise HTTPException(400, "El parametro formato debe ser json o xlsx")
    with get_connection() as conn, conn.cursor() as cur:
        empresa = _abrir(cur, usuario, empresaId)
        reporte = costos_inventario.reporte_art_177(cur, empresa_id=empresaId, mes=mes)
    if fmt == "xlsx":
        datos = costos_inventario.reporte_art_177_xlsx(empresa, reporte)
        nombre = f"libro_inventario_art177_{empresa['codigo']}_{reporte['mes']}.xlsx"
        return StreamingResponse(
            datos,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f'attachment; filename="{nombre}"'},
        )
    return reporte


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
            inv.mover(
                cur,
                empresa_id=data.empresaId,
                almacen_id=data.desdeAlmacenId,
                producto_id=data.productoId,
                lote_id=data.loteId,
                tipo="TRASLADO_SALIDA",
                cajas=-data.cajas,
                referencia=referencia,
                usuario_id=usuario["id"],
            )
        except inv.SinExistencia as e:
            raise HTTPException(409, f"No alcanza la existencia del lote: {e}") from e
        inv.mover(
            cur,
            empresa_id=data.empresaId,
            almacen_id=data.haciaAlmacenId,
            producto_id=data.productoId,
            lote_id=data.loteId,
            tipo="TRASLADO_ENTRADA",
            cajas=data.cajas,
            referencia=referencia,
            usuario_id=usuario["id"],
        )
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
            (
                ajuste_id,
                data.empresaId,
                data.almacenId,
                data.motivo.strip(),
                Jsonb([{"productoId": i.productoId, "loteId": i.loteId, "cajas": str(i.cajas)} for i in data.items]),
                usuario["id"],
            ),
        )
        bitacora.registrar(cur, usuario["id"], "AjusteInventario", ajuste_id, "proponer", None, data.model_dump(mode="json"))
        conn.commit()
    return {"id": ajuste_id}


@router.post("/ajustes/{ajuste_id}/{decision}")
def resolver_ajuste(
    ajuste_id: str,
    decision: str,
    usuario: dict = Depends(requiere_permiso("inventario.aprobar_ajuste")),
):
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
                    inv.mover(
                        cur,
                        empresa_id=ajuste["empresaId"],
                        almacen_id=ajuste["almacenId"],
                        producto_id=it["productoId"],
                        lote_id=it["loteId"],
                        tipo="AJUSTE",
                        cajas=Decimal(it["cajas"]),
                        ajuste_id=ajuste_id,
                        referencia=ajuste["motivo"],
                        usuario_id=usuario["id"],
                    )
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
