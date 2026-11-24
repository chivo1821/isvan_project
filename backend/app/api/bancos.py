"""Módulo de Bancos, Tesorería, Conciliación y Flujo de Caja (`/bancos`).

Todos los endpoints verifican pertenencia del usuario a la empresa fiscal
(`empresas.exigir`), exigen el interruptor `bancos` activo para la empresa
(`exigir_modulo`) y validan permisos granulares:
- `bancos.ver`: resumen, cuentas, libro de movimientos, historial de conciliaciones y flujo de caja.
- `bancos.operar`: ingresos, egresos y transferencias / cambio de divisas.
- `bancos.conciliar`: conciliar movimientos y analizar/confirmar estados de cuenta.
- `bancos.administrar`: crear/editar cuentas de tesorería y anular movimientos.
"""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.core.db import get_connection
from app.core.fechas import hoy_caracas
from app.core.permisos import requiere_permiso
from app.services import empresas, extracto_bancario, tesoreria

router = APIRouter(prefix="/bancos", tags=["bancos"])

TAMANO_MAXIMO_BYTES = 4_500_000


class CuentaTesoreriaCreate(BaseModel):
    empresaId: str
    nombre: str = Field(min_length=2, max_length=120)
    tipo: str
    moneda: str
    bancoCodigo: str | None = None
    numeroCuenta: str | None = None
    titular: str | None = None
    rif: str | None = None
    saldoInicial: Decimal = Decimal("0")
    fechaSaldoInicial: date | None = None
    cuentaPortalId: str | None = None
    activa: bool = True


class CuentaTesoreriaUpdate(BaseModel):
    empresaId: str | None = None
    nombre: str | None = Field(default=None, min_length=2, max_length=120)
    tipo: str | None = None
    moneda: str | None = None
    bancoCodigo: str | None = None
    numeroCuenta: str | None = None
    titular: str | None = None
    rif: str | None = None
    saldoInicial: Decimal | None = None
    fechaSaldoInicial: date | None = None
    cuentaPortalId: str | None = None
    activa: bool | None = None


class MovimientoBancarioCreate(BaseModel):
    empresaId: str | None = None
    cuentaId: str
    fecha: date | None = None
    tipo: str
    metodo: str = "TRANSFERENCIA"
    categoria: str = "OTRO"
    concepto: str = Field(min_length=1, max_length=300)
    tercero: str | None = Field(default=None, max_length=200)
    referencia: str | None = Field(default=None, max_length=100)
    monto: Decimal
    tasa: Decimal | None = None
    gastoId: str | None = None
    pagoId: str | None = None
    conciliado: bool = False


class TransferenciaCreate(BaseModel):
    empresaId: str | None = None
    cuentaOrigenId: str
    cuentaDestinoId: str
    monto: Decimal | None = None
    montoOrigen: Decimal | None = None
    tasaPactada: Decimal | None = None
    tasa: Decimal | None = None
    montoDestino: Decimal | None = None
    fecha: date | None = None
    concepto: str | None = Field(default=None, max_length=300)
    referencia: str | None = Field(default=None, max_length=100)
    metodo: str = "TRANSFERENCIA"


class AnularMovimientoRequest(BaseModel):
    motivo: str = Field(min_length=3, max_length=300)
    empresaId: str | None = None


class ConciliarMovimientosRequest(BaseModel):
    movimientoIds: list[int] = Field(min_length=1, max_length=1000)
    conciliado: bool = True
    empresaId: str | None = None


class ConfirmarConciliacionRequest(BaseModel):
    lineasSeleccionadas: list[int] | None = None
    indices: list[int] | None = None
    registrarFaltantes: bool = True
    empresaId: str | None = None


# ---------- Resumen y Cuentas ----------


@router.get("/resumen")
def obtener_resumen(
    empresaId: str,
    usuario: dict = Depends(requiere_permiso("bancos.ver")),
):
    with get_connection() as conn, conn.cursor() as cur:
        empresas.exigir(cur, usuario, empresaId)
        return tesoreria.resumen_disponible(cur, empresaId)


@router.get("/cuentas")
def listar_cuentas(
    empresaId: str,
    soloActivas: bool = False,
    usuario: dict = Depends(requiere_permiso("bancos.ver")),
):
    with get_connection() as conn, conn.cursor() as cur:
        empresas.exigir(cur, usuario, empresaId)
        return tesoreria.listar_cuentas(cur, empresaId, solo_activas=soloActivas)


@router.post("/cuentas", status_code=201)
def crear_cuenta(
    data: CuentaTesoreriaCreate,
    usuario: dict = Depends(requiere_permiso("bancos.administrar")),
):
    with get_connection() as conn, conn.cursor() as cur:
        empresa = empresas.exigir(cur, usuario, data.empresaId)
        creada = tesoreria.crear_cuenta(
            cur,
            empresa_id=data.empresaId,
            organizacion_id=empresa.get("organizacionId", "org-principal"),
            nombre=data.nombre,
            tipo=data.tipo,
            moneda=data.moneda,
            banco_codigo=data.bancoCodigo,
            numero_cuenta=data.numeroCuenta,
            titular=data.titular,
            rif=data.rif,
            saldo_inicial=data.saldoInicial,
            fecha_saldo_inicial=data.fechaSaldoInicial,
            cuenta_portal_id=data.cuentaPortalId,
            activa=data.activa,
            usuario_id=usuario["id"],
        )
        conn.commit()
        return creada


@router.put("/cuentas/{cuenta_id}")
def editar_cuenta(
    cuenta_id: str,
    data: CuentaTesoreriaUpdate,
    usuario: dict = Depends(requiere_permiso("bancos.administrar")),
):
    campos = data.model_fields_set
    with get_connection() as conn, conn.cursor() as cur:
        actual = tesoreria.obtener_cuenta(cur, cuenta_id, empresa_id=data.empresaId)
        empresas.exigir(cur, usuario, actual["empresaId"])
        actualizada = tesoreria.actualizar_cuenta(
            cur,
            cuenta_id,
            empresa_id=actual["empresaId"],
            nombre=data.nombre,
            tipo=data.tipo,
            moneda=data.moneda,
            banco_codigo=data.bancoCodigo,
            banco_codigo_enviado="bancoCodigo" in campos,
            numero_cuenta=data.numeroCuenta,
            numero_cuenta_enviado="numeroCuenta" in campos,
            titular=data.titular,
            titular_enviado="titular" in campos,
            rif=data.rif,
            rif_enviado="rif" in campos,
            saldo_inicial=data.saldoInicial,
            fecha_saldo_inicial=data.fechaSaldoInicial,
            cuenta_portal_id=data.cuentaPortalId,
            cuenta_portal_enviado="cuentaPortalId" in campos,
            activa=data.activa,
            usuario_id=usuario["id"],
        )
        conn.commit()
        return actualizada


# ---------- Libro de Movimientos y Transferencias ----------


@router.get("/movimientos")
def listar_movimientos(
    empresaId: str,
    cuentaId: str | None = None,
    desde: date | None = None,
    hasta: date | None = None,
    tipo: str | None = None,
    categoria: str | None = None,
    conciliado: bool | None = None,
    buscar: str | None = None,
    incluirAnulados: bool = True,
    limite: int = Query(500, ge=1, le=2000),
    usuario: dict = Depends(requiere_permiso("bancos.ver")),
):
    with get_connection() as conn, conn.cursor() as cur:
        empresas.exigir(cur, usuario, empresaId)
        return tesoreria.listar_movimientos(
            cur,
            empresa_id=empresaId,
            cuenta_id=cuentaId,
            desde=desde,
            hasta=hasta,
            tipo=tipo,
            categoria=categoria,
            conciliado=conciliado,
            buscar=buscar,
            incluir_anulados=incluirAnulados,
            limite=limite,
        )


@router.post("/movimientos", status_code=201)
def registrar_movimiento(
    data: MovimientoBancarioCreate,
    usuario: dict = Depends(requiere_permiso("bancos.operar")),
):
    with get_connection() as conn, conn.cursor() as cur:
        cuenta = tesoreria.obtener_cuenta(cur, data.cuentaId, empresa_id=data.empresaId)
        empresas.exigir(cur, usuario, cuenta["empresaId"])
        creado = tesoreria.registrar_movimiento(
            cur,
            cuenta_id=data.cuentaId,
            empresa_id=cuenta["empresaId"],
            fecha=data.fecha,
            tipo=data.tipo,
            metodo=data.metodo,
            categoria=data.categoria,
            concepto=data.concepto,
            tercero=data.tercero,
            referencia=data.referencia,
            monto=data.monto,
            tasa=data.tasa,
            gasto_id=data.gastoId,
            pago_id=data.pagoId,
            conciliado=data.conciliado,
            usuario_id=usuario["id"],
        )
        conn.commit()
        return creado


@router.post("/transferencias", status_code=201)
def transferir_entre_cuentas(
    data: TransferenciaCreate,
    usuario: dict = Depends(requiere_permiso("bancos.operar")),
):
    monto_origen = data.monto if data.monto is not None else data.montoOrigen
    if monto_origen is None:
        raise HTTPException(400, "Debes indicar el monto a transferir")
    tasa_efectiva = data.tasaPactada if data.tasaPactada is not None else data.tasa

    with get_connection() as conn, conn.cursor() as cur:
        origen = tesoreria.obtener_cuenta(cur, data.cuentaOrigenId, empresa_id=data.empresaId)
        empresas.exigir(cur, usuario, origen["empresaId"])
        resultado = tesoreria.transferir_entre_cuentas(
            cur,
            cuenta_origen_id=data.cuentaOrigenId,
            cuenta_destino_id=data.cuentaDestinoId,
            monto_origen=monto_origen,
            empresa_id=origen["empresaId"],
            fecha=data.fecha,
            tasa=tasa_efectiva,
            monto_destino=data.montoDestino,
            referencia=data.referencia,
            concepto=data.concepto,
            metodo=data.metodo,
            usuario_id=usuario["id"],
        )
        conn.commit()
        return resultado


@router.post("/movimientos/{mov_id}/anular")
def anular_movimiento(
    mov_id: int,
    data: AnularMovimientoRequest,
    usuario: dict = Depends(requiere_permiso("bancos.administrar")),
):
    with get_connection() as conn, conn.cursor() as cur:
        mov = tesoreria.obtener_movimiento(cur, mov_id)
        if data.empresaId and mov["empresaId"] != data.empresaId:
            raise HTTPException(404, "Movimiento bancario no encontrado")
        empresas.exigir(cur, usuario, mov["empresaId"])
        resultado = tesoreria.anular_movimiento(
            cur,
            mov_id=mov_id,
            motivo=data.motivo,
            empresa_id=mov["empresaId"],
            usuario_id=usuario["id"],
        )
        conn.commit()
        return resultado


@router.post("/movimientos/conciliar")
def conciliar_movimientos(
    data: ConciliarMovimientosRequest,
    usuario: dict = Depends(requiere_permiso("bancos.conciliar")),
):
    with get_connection() as conn, conn.cursor() as cur:
        ids = sorted({int(x) for x in data.movimientoIds})
        cur.execute('SELECT DISTINCT "empresaId" FROM "MovimientoBancario" WHERE "id" = ANY(%s)', (ids,))
        for fila in cur.fetchall():
            empresas.exigir(cur, usuario, fila["empresaId"])
        resultado = tesoreria.conciliar_movimientos(
            cur,
            empresa_id=data.empresaId,
            movimiento_ids=ids,
            conciliado=data.conciliado,
            usuario_id=usuario["id"],
        )
        conn.commit()
        return resultado


# ---------- Conciliación de Estados de Cuenta ----------


@router.post("/conciliaciones/analizar", status_code=201)
def analizar_conciliacion(
    archivo: UploadFile = File(...),
    cuentaId: str = Form(...),
    empresaId: str | None = Form(None),
    usuario: dict = Depends(requiere_permiso("bancos.conciliar")),
):
    contenido = archivo.file.read()
    if len(contenido) > TAMANO_MAXIMO_BYTES:
        raise HTTPException(
            413,
            f"El archivo pesa {len(contenido) / 1_000_000:.1f} MB y el máximo permitido es 4.5 MB",
        )
    with get_connection() as conn, conn.cursor() as cur:
        cuenta = tesoreria.obtener_cuenta(cur, cuentaId, empresa_id=empresaId)
        empresas.exigir(cur, usuario, cuenta["empresaId"])
        resultado = extracto_bancario.analizar_extracto(
            cur,
            empresa_id=cuenta["empresaId"],
            cuenta_id=cuentaId,
            nombre_archivo=archivo.filename or "extracto.xlsx",
            contenido=contenido,
            usuario_id=usuario["id"],
        )
        conn.commit()
        return resultado


@router.post("/conciliaciones/{conc_id}/confirmar")
def confirmar_conciliacion(
    conc_id: str,
    data: ConfirmarConciliacionRequest,
    usuario: dict = Depends(requiere_permiso("bancos.conciliar")),
):
    lineas_sel = data.lineasSeleccionadas if data.lineasSeleccionadas is not None else data.indices
    with get_connection() as conn, conn.cursor() as cur:
        conc = extracto_bancario.obtener_conciliacion(cur, conc_id, empresa_id=data.empresaId)
        empresas.exigir(cur, usuario, conc["empresaId"])
        resultado = extracto_bancario.confirmar_conciliacion(
            cur,
            conc_id=conc_id,
            empresa_id=conc["empresaId"],
            lineas_seleccionadas=lineas_sel,
            registrar_faltantes=data.registrarFaltantes,
            usuario_id=usuario["id"],
        )
        conn.commit()
        return resultado


@router.get("/conciliaciones")
def listar_conciliaciones(
    empresaId: str,
    cuentaId: str | None = None,
    limite: int = Query(100, ge=1, le=500),
    usuario: dict = Depends(requiere_permiso("bancos.ver")),
):
    with get_connection() as conn, conn.cursor() as cur:
        empresas.exigir(cur, usuario, empresaId)
        return extracto_bancario.listar_conciliaciones(
            cur,
            empresa_id=empresaId,
            cuenta_id=cuentaId,
            limite=limite,
        )


# ---------- Flujo de Caja ----------


@router.get("/flujo-caja")
def obtener_flujo_caja(
    empresaId: str,
    desde: date | None = None,
    hasta: date | None = None,
    agrupacion: str = Query("dia", pattern="^(dia|semana|mes)$"),
    cuentaId: str | None = None,
    formato: str = Query("json", pattern="^(json|xlsx)$"),
    usuario: dict = Depends(requiere_permiso("bancos.ver")),
):
    hoy = hoy_caracas()
    desde_ef = desde or hoy.replace(day=1)
    if hasta is not None:
        hasta_ef = hasta
    else:
        sig_mes = date(hoy.year + (1 if hoy.month == 12 else 0), 1 if hoy.month == 12 else hoy.month + 1, 1)
        hasta_ef = sig_mes - timedelta(days=1)

    with get_connection() as conn, conn.cursor() as cur:
        empresa = empresas.exigir(cur, usuario, empresaId)
        reporte = tesoreria.flujo_de_caja(
            cur,
            empresa_id=empresaId,
            desde=desde_ef,
            hasta=hasta_ef,
            agrupacion=agrupacion,
            cuenta_id=cuentaId,
        )
        if formato == "xlsx":
            archivo_xlsx = tesoreria.flujo_de_caja_excel(reporte, empresa)
            nombre = f"flujo_caja_{empresa.get('codigo', empresaId)}_{desde_ef}_{hasta_ef}.xlsx"
            return StreamingResponse(
                archivo_xlsx,
                media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                headers={"Content-Disposition": f'attachment; filename="{nombre}"'},
            )
        return reporte
