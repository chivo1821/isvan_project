"""Valoracion de inventario (SENIAT Art. 177 RISLR), tres tipos de costo por
caja (ultimo, promedio ponderado movil y presupuestario), Kardex valorado,
reporte mensual Art. 177 y calculo de precios/margenes de venta.
"""

from __future__ import annotations

import io
import re
from datetime import date, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal

import openpyxl
from fastapi import HTTPException
from openpyxl.styles import Alignment, Font, PatternFill

from app.core.fechas import ahora_utc, dias_caracas_en_utc
from app.schemas import en_utc
from app.services import bitacora, tasa_bcv

CERO = Decimal("0")
UNO = Decimal("1")
CIEN = Decimal("100")
Q2 = Decimal("0.01")
Q3 = Decimal("0.001")
Q4 = Decimal("0.0001")
Q8 = Decimal("0.00000001")

MODOS_PRESUPUESTARIOS = ("MANUAL", "SOBRE_ULTIMO", "SOBRE_PROMEDIO")
BASES_COSTO = ("ULTIMO", "PROMEDIO", "PRESUPUESTARIO")
METODOS_MARGEN = ("SOBRE_COSTO", "SOBRE_VENTA")


def q2(valor: Decimal | int | float | str) -> Decimal:
    return Decimal(valor).quantize(Q2, rounding=ROUND_HALF_UP)


def q3(valor: Decimal | int | float | str) -> Decimal:
    return Decimal(valor).quantize(Q3, rounding=ROUND_HALF_UP)


def q4(valor: Decimal | int | float | str) -> Decimal:
    return Decimal(valor).quantize(Q4, rounding=ROUND_HALF_UP)


def q8(valor: Decimal | int | float | str) -> Decimal:
    return Decimal(valor).quantize(Q8, rounding=ROUND_HALF_UP)


def resolver_tasa(cur, tasa_explicita: Decimal | None = None) -> Decimal | None:
    """Devuelve la tasa explicita (si > 0) o la ultima tasa BCV registrada."""
    if tasa_explicita is not None:
        t = Decimal(tasa_explicita)
        if t <= CERO:
            raise HTTPException(400, "La tasa debe ser mayor que cero")
        return q8(t)
    fila = tasa_bcv.ultima(cur)
    if fila and fila.get("tasa") is not None:
        return q8(Decimal(str(fila["tasa"])))
    return None


def normalizar_costo_entrada(
    cur,
    *,
    costo_usd: Decimal | None = None,
    costo_bs: Decimal | None = None,
    tasa: Decimal | None = None,
) -> tuple[Decimal | None, Decimal | None, Decimal | None]:
    """Resuelve (costo_unitario_usd, costo_unitario_bs, tasa) para una entrada.
    Si no viene costo (o viene 0), devuelve (None, None, tasa_resuelta)."""
    u_in = Decimal(costo_usd) if costo_usd is not None else None
    b_in = Decimal(costo_bs) if costo_bs is not None else None
    if u_in is not None and u_in < CERO:
        raise HTTPException(400, "El costo en USD no puede ser negativo")
    if b_in is not None and b_in < CERO:
        raise HTTPException(400, "El costo en Bs no puede ser negativo")
    if u_in is not None and u_in == CERO:
        u_in = None
    if b_in is not None and b_in == CERO:
        b_in = None

    tasa_resuelta = resolver_tasa(cur, tasa)
    if u_in is None and b_in is None:
        return None, None, tasa_resuelta

    if u_in is not None and b_in is not None:
        if tasa_resuelta is None:
            tasa_resuelta = q8(b_in / u_in)
        return q4(u_in), q4(b_in), tasa_resuelta

    if u_in is not None:
        u = q4(u_in)
        b = q4(u_in * tasa_resuelta) if tasa_resuelta is not None else None
        return u, b, tasa_resuelta

    # Solo vino costo en Bs
    if tasa_resuelta is None:
        raise HTTPException(409, "No hay tasa BCV registrada; indica la tasa para convertir el costo en Bs")
    b = q4(b_in)  # type: ignore[arg-type]
    u = q4(Decimal(b_in) / tasa_resuelta)  # type: ignore[arg-type]
    return u, b, tasa_resuelta


def calcular_presupuestario(
    *,
    modo: str,
    porcentaje: Decimal | None,
    ultimo_usd: Decimal | None,
    promedio_usd: Decimal | None,
    manual_usd: Decimal | None,
) -> Decimal | None:
    if modo not in MODOS_PRESUPUESTARIOS:
        raise HTTPException(400, f"Modo presupuestario invalido: usa {', '.join(MODOS_PRESUPUESTARIOS)}")
    if modo == "MANUAL":
        if manual_usd is None:
            return None
        m = Decimal(manual_usd)
        if m < CERO:
            raise HTTPException(400, "El costo presupuestario no puede ser negativo")
        return q4(m)
    pct = Decimal(porcentaje) if porcentaje is not None else CERO
    factor = UNO + (pct / CIEN)
    if factor < CERO:
        raise HTTPException(400, "El porcentaje presupuestario no puede dejar el costo en negativo")
    base = ultimo_usd if modo == "SOBRE_ULTIMO" else promedio_usd
    if base is None:
        return None
    return q4(Decimal(base) * factor)


def registrar_historial_costo(
    cur,
    *,
    organizacion_id: str,
    empresa_id: str,
    producto_id: str,
    tipo_costo: str,
    costo_anterior_usd: Decimal | None,
    costo_nuevo_usd: Decimal,
    costo_nuevo_bs: Decimal | None = None,
    tasa: Decimal | None = None,
    motivo: str | None = None,
    movimiento_id: int | None = None,
    usuario_id: str | None = None,
    fecha: datetime | None = None,
) -> None:
    cur.execute(
        'INSERT INTO "HistorialCostoProducto" '
        '("organizacionId", "empresaId", "productoId", "tipoCosto", "costoAnteriorUsd", "costoNuevoUsd", '
        '"costoNuevoBs", "tasa", "motivo", "movimientoId", "usuarioId", "fecha") '
        "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
        (
            organizacion_id or "org-principal",
            empresa_id,
            producto_id,
            tipo_costo,
            q4(costo_anterior_usd) if costo_anterior_usd is not None else None,
            q4(costo_nuevo_usd),
            q4(costo_nuevo_bs) if costo_nuevo_bs is not None else None,
            q8(tasa) if tasa is not None else None,
            motivo,
            movimiento_id,
            usuario_id,
            fecha or ahora_utc(),
        ),
    )


def bloquear_producto_y_existencia(cur, producto_id: str) -> tuple[dict, Decimal]:
    """Bloquea la fila de Producto y todas sus filas en Existencia en orden
    determinista (FOR UPDATE) y devuelve (producto, existencia_empresa_actual)."""
    cur.execute('SELECT * FROM "Producto" WHERE "id" = %s FOR UPDATE', (producto_id,))
    producto = cur.fetchone()
    if not producto:
        raise HTTPException(404, "Producto no encontrado")
    cur.execute(
        'SELECT "id", "cajas" FROM "Existencia" WHERE "productoId" = %s ORDER BY "id" FOR UPDATE',
        (producto_id,),
    )
    existencia_actual = sum((Decimal(f["cajas"]) for f in cur.fetchall()), CERO)
    return producto, existencia_actual


def valorar_y_actualizar_producto(
    cur,
    *,
    producto: dict,
    existencia_antes: Decimal,
    tipo: str,
    cajas: Decimal,
    costo_unitario_usd: Decimal | None = None,
    costo_unitario_bs: Decimal | None = None,
    tasa: Decimal | None = None,
    referencia: str | None = None,
) -> tuple[dict, list[dict]]:
    """Calcula el snapshot de costos para MovimientoInventario, actualiza los 3
    costos en Producto cuando corresponde y devuelve (snapshot_mov, cambios_historial)."""
    ahora = ahora_utc()
    saldo_empresa = q3(existencia_antes + cajas)

    ult_ant_usd = Decimal(producto["ultimoCostoCajaUsd"]) if producto.get("ultimoCostoCajaUsd") is not None else None
    ult_ant_bs = Decimal(producto["ultimoCostoCajaBs"]) if producto.get("ultimoCostoCajaBs") is not None else None
    cpp_ant_usd = Decimal(producto["costoPromedioCajaUsd"]) if producto.get("costoPromedioCajaUsd") is not None else None
    cpp_ant_bs = Decimal(producto["costoPromedioCajaBs"]) if producto.get("costoPromedioCajaBs") is not None else None
    pres_ant_usd = (
        Decimal(producto["costoPresupuestarioCajaUsd"])
        if producto.get("costoPresupuestarioCajaUsd") is not None
        else None
    )
    modo_pres = producto.get("modoPresupuestario") or "MANUAL"
    pct_pres = Decimal(producto["porcentajePresupuestario"]) if producto.get("porcentajePresupuestario") is not None else None

    historial: list[dict] = []

    if tipo == "ENTRADA" and cajas > CERO:
        c_usd, c_bs, tasa_usada = normalizar_costo_entrada(
            cur, costo_usd=costo_unitario_usd, costo_bs=costo_unitario_bs, tasa=tasa
        )
        if c_usd is not None and c_usd > CERO:
            ex_base = max(existencia_antes, CERO)
            total_cajas = ex_base + cajas
            base_cpp_usd = cpp_ant_usd if cpp_ant_usd is not None else CERO
            cpp_nuevo_usd = q4(((ex_base * base_cpp_usd) + (cajas * c_usd)) / total_cajas)

            if c_bs is not None:
                base_cpp_bs = (
                    cpp_ant_bs
                    if cpp_ant_bs is not None
                    else (q4(base_cpp_usd * tasa_usada) if tasa_usada is not None else CERO)
                )
                cpp_nuevo_bs: Decimal | None = q4(((ex_base * base_cpp_bs) + (cajas * c_bs)) / total_cajas)
            else:
                cpp_nuevo_bs = cpp_ant_bs

            nuevo_ult_usd = c_usd
            nuevo_ult_bs = c_bs if c_bs is not None else ult_ant_bs
            nuevo_pres_usd = calcular_presupuestario(
                modo=modo_pres,
                porcentaje=pct_pres,
                ultimo_usd=nuevo_ult_usd,
                promedio_usd=cpp_nuevo_usd,
                manual_usd=pres_ant_usd,
            )

            cur.execute(
                'UPDATE "Producto" SET "ultimoCostoCajaUsd" = %s, "ultimoCostoCajaBs" = %s, '
                '"costoPromedioCajaUsd" = %s, "costoPromedioCajaBs" = %s, '
                '"costoPresupuestarioCajaUsd" = %s, "costosActualizadosEn" = %s, "actualizadoEn" = %s '
                'WHERE "id" = %s',
                (
                    nuevo_ult_usd,
                    nuevo_ult_bs,
                    cpp_nuevo_usd,
                    cpp_nuevo_bs,
                    nuevo_pres_usd,
                    ahora,
                    ahora,
                    producto["id"],
                ),
            )

            motivo_hist = referencia or "Entrada valorada de inventario"
            if ult_ant_usd != nuevo_ult_usd or ult_ant_bs != nuevo_ult_bs:
                historial.append({
                    "tipo_costo": "ULTIMO",
                    "anterior_usd": ult_ant_usd,
                    "nuevo_usd": nuevo_ult_usd,
                    "nuevo_bs": nuevo_ult_bs,
                    "tasa": tasa_usada,
                    "motivo": motivo_hist,
                })
            if cpp_ant_usd != cpp_nuevo_usd or cpp_ant_bs != cpp_nuevo_bs:
                historial.append({
                    "tipo_costo": "PROMEDIO",
                    "anterior_usd": cpp_ant_usd,
                    "nuevo_usd": cpp_nuevo_usd,
                    "nuevo_bs": cpp_nuevo_bs,
                    "tasa": tasa_usada,
                    "motivo": motivo_hist,
                })
            if modo_pres in ("SOBRE_ULTIMO", "SOBRE_PROMEDIO") and nuevo_pres_usd is not None and pres_ant_usd != nuevo_pres_usd:
                historial.append({
                    "tipo_costo": "PRESUPUESTARIO",
                    "anterior_usd": pres_ant_usd,
                    "nuevo_usd": nuevo_pres_usd,
                    "nuevo_bs": q4(nuevo_pres_usd * tasa_usada) if tasa_usada is not None else None,
                    "tasa": tasa_usada,
                    "motivo": f"Recalculo automatico ({modo_pres})",
                })

            return (
                {
                    "costoUnitarioUsd": c_usd,
                    "costoUnitarioBs": c_bs,
                    "tasa": tasa_usada,
                    "valorTotalUsd": q2(cajas * c_usd),
                    "valorTotalBs": q2(cajas * c_bs) if c_bs is not None else None,
                    "saldoCajasEmpresa": saldo_empresa,
                    "costoPromedioResultanteUsd": cpp_nuevo_usd,
                    "costoPromedioResultanteBs": cpp_nuevo_bs,
                },
                historial,
            )

        # Entrada sin costo (compatibilidad con conteo sin valoracion)
        return (
            {
                "costoUnitarioUsd": None,
                "costoUnitarioBs": None,
                "tasa": tasa_usada,
                "valorTotalUsd": None,
                "valorTotalBs": None,
                "saldoCajasEmpresa": saldo_empresa,
                "costoPromedioResultanteUsd": cpp_ant_usd,
                "costoPromedioResultanteBs": cpp_ant_bs,
            },
            historial,
        )

    if tipo == "DEVOLUCION" and cajas > CERO:
        tasa_usada = resolver_tasa(cur, tasa)
        c_usd = q4(costo_unitario_usd) if costo_unitario_usd is not None else cpp_ant_usd
        c_bs = q4(costo_unitario_bs) if costo_unitario_bs is not None else cpp_ant_bs
        if c_bs is None and c_usd is not None and tasa_usada is not None:
            c_bs = q4(c_usd * tasa_usada)

        if c_usd is not None:
            ex_base = max(existencia_antes, CERO)
            total_cajas = ex_base + cajas
            base_cpp_usd = cpp_ant_usd if cpp_ant_usd is not None else c_usd
            cpp_nuevo_usd = q4(((ex_base * base_cpp_usd) + (cajas * c_usd)) / total_cajas)
            if c_bs is not None:
                base_cpp_bs = cpp_ant_bs if cpp_ant_bs is not None else c_bs
                cpp_nuevo_bs = q4(((ex_base * base_cpp_bs) + (cajas * c_bs)) / total_cajas)
            else:
                cpp_nuevo_bs = cpp_ant_bs

            if cpp_nuevo_usd != cpp_ant_usd or cpp_nuevo_bs != cpp_ant_bs:
                nuevo_pres_usd = calcular_presupuestario(
                    modo=modo_pres,
                    porcentaje=pct_pres,
                    ultimo_usd=ult_ant_usd,
                    promedio_usd=cpp_nuevo_usd,
                    manual_usd=pres_ant_usd,
                )
                cur.execute(
                    'UPDATE "Producto" SET "costoPromedioCajaUsd" = %s, "costoPromedioCajaBs" = %s, '
                    '"costoPresupuestarioCajaUsd" = %s, "costosActualizadosEn" = %s, "actualizadoEn" = %s '
                    'WHERE "id" = %s',
                    (cpp_nuevo_usd, cpp_nuevo_bs, nuevo_pres_usd, ahora, ahora, producto["id"]),
                )
                if cpp_nuevo_usd != cpp_ant_usd:
                    historial.append({
                        "tipo_costo": "PROMEDIO",
                        "anterior_usd": cpp_ant_usd,
                        "nuevo_usd": cpp_nuevo_usd,
                        "nuevo_bs": cpp_nuevo_bs,
                        "tasa": tasa_usada,
                        "motivo": referencia or "Devolucion de venta",
                    })
                if modo_pres == "SOBRE_PROMEDIO" and nuevo_pres_usd is not None and nuevo_pres_usd != pres_ant_usd:
                    historial.append({
                        "tipo_costo": "PRESUPUESTARIO",
                        "anterior_usd": pres_ant_usd,
                        "nuevo_usd": nuevo_pres_usd,
                        "nuevo_bs": q4(nuevo_pres_usd * tasa_usada) if tasa_usada is not None else None,
                        "tasa": tasa_usada,
                        "motivo": "Recalculo automatico por devolucion (SOBRE_PROMEDIO)",
                    })

            return (
                {
                    "costoUnitarioUsd": c_usd,
                    "costoUnitarioBs": c_bs,
                    "tasa": tasa_usada,
                    "valorTotalUsd": q2(cajas * c_usd),
                    "valorTotalBs": q2(cajas * c_bs) if c_bs is not None else None,
                    "saldoCajasEmpresa": saldo_empresa,
                    "costoPromedioResultanteUsd": cpp_nuevo_usd,
                    "costoPromedioResultanteBs": cpp_nuevo_bs,
                },
                historial,
            )

    # Salidas (SALIDA_VENTA, RETIRO, AUTOCONSUMO), AJUSTE (+/-) y TRASLADOS:
    # se valoran al CPP vigente sin alterar los costos del producto.
    tasa_usada = resolver_tasa(cur, tasa)
    if cpp_ant_usd is not None:
        c_usd = q4(cpp_ant_usd)
        c_bs = (
            q4(cpp_ant_bs)
            if cpp_ant_bs is not None
            else (q4(c_usd * tasa_usada) if tasa_usada is not None else None)
        )
        val_usd: Decimal | None = q2(cajas * c_usd)
        val_bs: Decimal | None = q2(cajas * c_bs) if c_bs is not None else None
    else:
        c_usd = None
        c_bs = None
        val_usd = None
        val_bs = None

    return (
        {
            "costoUnitarioUsd": c_usd,
            "costoUnitarioBs": c_bs,
            "tasa": tasa_usada,
            "valorTotalUsd": val_usd,
            "valorTotalBs": val_bs,
            "saldoCajasEmpresa": saldo_empresa,
            "costoPromedioResultanteUsd": cpp_ant_usd,
            "costoPromedioResultanteBs": cpp_ant_bs,
        },
        historial,
    )


# ---------- Configuracion de Costo Presupuestario ----------


def _aplicar_presupuestario_a_fila(
    cur,
    *,
    producto: dict,
    modo: str,
    porcentaje: Decimal | None,
    costo_manual_usd: Decimal | None,
    motivo: str | None,
    usuario_id: str | None,
    tasa_actual: Decimal | None,
    ahora: datetime,
) -> dict:
    if modo == "MANUAL":
        if costo_manual_usd is None:
            raise HTTPException(400, "En modo MANUAL debes indicar costoPresupuestarioCajaUsd")
        pct_guardar = None
        nuevo_pres = calcular_presupuestario(
            modo="MANUAL",
            porcentaje=None,
            ultimo_usd=producto.get("ultimoCostoCajaUsd"),
            promedio_usd=producto.get("costoPromedioCajaUsd"),
            manual_usd=costo_manual_usd,
        )
    else:
        pct_guardar = q2(porcentaje if porcentaje is not None else CERO)
        nuevo_pres = calcular_presupuestario(
            modo=modo,
            porcentaje=pct_guardar,
            ultimo_usd=producto.get("ultimoCostoCajaUsd"),
            promedio_usd=producto.get("costoPromedioCajaUsd"),
            manual_usd=None,
        )

    ant_pres = (
        Decimal(producto["costoPresupuestarioCajaUsd"])
        if producto.get("costoPresupuestarioCajaUsd") is not None
        else None
    )
    cur.execute(
        'UPDATE "Producto" SET "modoPresupuestario" = %s, "porcentajePresupuestario" = %s, '
        '"costoPresupuestarioCajaUsd" = %s, "costosActualizadosEn" = %s, "actualizadoEn" = %s '
        'WHERE "id" = %s RETURNING *',
        (modo, pct_guardar, nuevo_pres, ahora, ahora, producto["id"]),
    )
    actualizado = cur.fetchone()
    if nuevo_pres is not None and ant_pres != nuevo_pres:
        registrar_historial_costo(
            cur,
            organizacion_id=producto.get("organizacionId", "org-principal"),
            empresa_id=producto["empresaId"],
            producto_id=producto["id"],
            tipo_costo="PRESUPUESTARIO",
            costo_anterior_usd=ant_pres,
            costo_nuevo_usd=nuevo_pres,
            costo_nuevo_bs=q4(nuevo_pres * tasa_actual) if tasa_actual is not None else None,
            tasa=tasa_actual,
            motivo=motivo or f"Configuracion presupuestaria ({modo})",
            usuario_id=usuario_id,
            fecha=ahora,
        )
    return actualizado


def configurar_costo_presupuestario(
    cur,
    *,
    producto_id: str,
    modo: str,
    porcentaje: Decimal | None = None,
    costo_manual_usd: Decimal | None = None,
    motivo: str | None = None,
    usuario_id: str | None = None,
) -> dict:
    cur.execute('SELECT * FROM "Producto" WHERE "id" = %s FOR UPDATE', (producto_id,))
    producto = cur.fetchone()
    if not producto:
        raise HTTPException(404, "Producto no encontrado")
    tasa_act = resolver_tasa(cur)
    ahora = ahora_utc()
    despues = _aplicar_presupuestario_a_fila(
        cur,
        producto=producto,
        modo=modo,
        porcentaje=porcentaje,
        costo_manual_usd=costo_manual_usd,
        motivo=motivo,
        usuario_id=usuario_id,
        tasa_actual=tasa_act,
        ahora=ahora,
    )
    bitacora.registrar(
        cur,
        usuario_id,
        "Producto",
        producto_id,
        "costo_presupuestario",
        {
            "modoPresupuestario": producto.get("modoPresupuestario"),
            "porcentajePresupuestario": producto.get("porcentajePresupuestario"),
            "costoPresupuestarioCajaUsd": producto.get("costoPresupuestarioCajaUsd"),
        },
        {
            "modoPresupuestario": despues.get("modoPresupuestario"),
            "porcentajePresupuestario": despues.get("porcentajePresupuestario"),
            "costoPresupuestarioCajaUsd": despues.get("costoPresupuestarioCajaUsd"),
        },
        organizacion_id=producto.get("organizacionId", "org-principal"),
    )
    return despues


def configurar_costo_presupuestario_masivo(
    cur,
    *,
    empresa_id: str,
    modo: str,
    porcentaje: Decimal | None = None,
    costo_manual_usd: Decimal | None = None,
    grupo: str | None = None,
    producto_ids: list[str] | None = None,
    solo_activos: bool = True,
    motivo: str | None = None,
    usuario_id: str | None = None,
) -> list[dict]:
    condiciones = ['"empresaId" = %s']
    params: list = [empresa_id]
    if solo_activos:
        condiciones.append('"activo"')
    if grupo and grupo.strip() and grupo.strip().upper() != "TODOS":
        condiciones.append('"grupo" = %s')
        params.append(grupo.strip())
    if producto_ids:
        condiciones.append('"id" = ANY(%s)')
        params.append(producto_ids)

    cur.execute(
        f'SELECT * FROM "Producto" WHERE {" AND ".join(condiciones)} ORDER BY "id" FOR UPDATE',
        params,
    )
    productos = cur.fetchall()
    tasa_act = resolver_tasa(cur)
    ahora = ahora_utc()
    actualizados = []
    for prod in productos:
        actualizados.append(
            _aplicar_presupuestario_a_fila(
                cur,
                producto=prod,
                modo=modo,
                porcentaje=porcentaje,
                costo_manual_usd=costo_manual_usd,
                motivo=motivo,
                usuario_id=usuario_id,
                tasa_actual=tasa_act,
                ahora=ahora,
            )
        )
    if actualizados:
        org_id = actualizados[0].get("organizacionId", "org-principal")
        bitacora.registrar(
            cur,
            usuario_id,
            "EmpresaFiscal",
            empresa_id,
            "costo_presupuestario_masivo",
            None,
            {
                "modoPresupuestario": modo,
                "porcentajePresupuestario": porcentaje,
                "costoPresupuestarioCajaUsd": costo_manual_usd,
                "grupo": grupo,
                "actualizados": len(actualizados),
            },
            organizacion_id=org_id,
        )
    return actualizados


# ---------- Kardex Valorado ----------


def kardex_producto(
    cur,
    *,
    empresa_id: str,
    producto_id: str,
    almacen_id: str | None = None,
    desde: date | None = None,
    hasta: date | None = None,
    limite: int = 500,
) -> list[dict]:
    condiciones = ['m."empresaId" = %s', 'm."productoId" = %s']
    params: list = [empresa_id, producto_id]
    if almacen_id:
        condiciones.append('m."almacenId" = %s')
        params.append(almacen_id)
    if desde:
        inicio_utc, _ = dias_caracas_en_utc(desde, desde)
        condiciones.append('m."fecha" >= %s')
        params.append(inicio_utc)
    if hasta:
        _, fin_utc = dias_caracas_en_utc(hasta, hasta)
        condiciones.append('m."fecha" < %s')
        params.append(fin_utc)
    params.append(limite)

    cur.execute(
        f"""
        SELECT m."id", m."fecha", m."tipo", m."cajas",
               m."costoUnitarioUsd", m."costoUnitarioBs", m."tasa",
               m."valorTotalUsd", m."valorTotalBs",
               m."saldoCajasEmpresa", m."costoPromedioResultanteUsd", m."costoPromedioResultanteBs",
               m."proveedor", m."numeroFacturaCompra", m."referencia",
               l."numero" AS "lote", a."nombre" AS "almacen",
               d."numero" AS "documento", u."nombre" AS "usuario"
        FROM "MovimientoInventario" m
        JOIN "Lote" l ON l."id" = m."loteId"
        JOIN "Almacen" a ON a."id" = m."almacenId"
        LEFT JOIN "DocumentoVenta" d ON d."id" = m."documentoVentaId"
        LEFT JOIN "Usuario" u ON u."id" = m."usuarioId"
        WHERE {" AND ".join(condiciones)}
        ORDER BY m."id" DESC
        LIMIT %s
        """,
        params,
    )
    salida = []
    for f in cur.fetchall():
        fecha = f["fecha"]
        fecha_iso = en_utc(fecha).isoformat() if isinstance(fecha, datetime) else str(fecha)
        salida.append({
            "id": int(f["id"]),
            "fecha": fecha_iso,
            "tipo": f["tipo"],
            "cajas": float(f["cajas"]),
            "costoUnitarioUsd": float(f["costoUnitarioUsd"]) if f["costoUnitarioUsd"] is not None else None,
            "costoUnitarioBs": float(f["costoUnitarioBs"]) if f["costoUnitarioBs"] is not None else None,
            "tasa": float(f["tasa"]) if f["tasa"] is not None else None,
            "valorTotalUsd": float(f["valorTotalUsd"]) if f["valorTotalUsd"] is not None else None,
            "valorTotalBs": float(f["valorTotalBs"]) if f["valorTotalBs"] is not None else None,
            "saldoCajasEmpresa": float(f["saldoCajasEmpresa"]) if f["saldoCajasEmpresa"] is not None else None,
            "costoPromedioResultanteUsd": (
                float(f["costoPromedioResultanteUsd"]) if f["costoPromedioResultanteUsd"] is not None else None
            ),
            "costoPromedioResultanteBs": (
                float(f["costoPromedioResultanteBs"]) if f["costoPromedioResultanteBs"] is not None else None
            ),
            "proveedor": f["proveedor"],
            "numeroFacturaCompra": f["numeroFacturaCompra"],
            "referencia": f["referencia"],
            "lote": f["lote"],
            "almacen": f["almacen"],
            "documento": f["documento"],
            "usuario": f["usuario"],
        })
    return salida


# ---------- Reporte SENIAT Art. 177 RISLR ----------


def parsear_mes(mes: str) -> tuple[str, date, date]:
    texto = (mes or "").strip()
    m = re.fullmatch(r"(\d{4})-(\d{2})(?:-\d{2})?", texto)
    if not m:
        raise HTTPException(400, "El parametro mes debe tener el formato YYYY-MM")
    anio, num_mes = int(m[1]), int(m[2])
    if not (1 <= num_mes <= 12):
        raise HTTPException(400, "Mes invalido")
    primer_dia = date(anio, num_mes, 1)
    sig_mes = date(anio + (1 if num_mes == 12 else 0), 1 if num_mes == 12 else num_mes + 1, 1)
    ultimo_dia = sig_mes - timedelta(days=1)
    return f"{anio:04d}-{num_mes:02d}", primer_dia, ultimo_dia


def reporte_art_177(cur, *, empresa_id: str, mes: str) -> dict:
    mes_norm, primer_dia, ultimo_dia = parsear_mes(mes)
    inicio_utc, fin_utc = dias_caracas_en_utc(primer_dia, ultimo_dia)

    cur.execute(
        'SELECT "id", "codigo", "nombre", "grupo", "unidadesPorCaja", '
        '"costoPromedioCajaBs", "costoPromedioCajaUsd" '
        'FROM "Producto" WHERE "empresaId" = %s ORDER BY "codigo" ASC',
        (empresa_id,),
    )
    productos = cur.fetchall()
    if not productos:
        return {
            "empresaId": empresa_id,
            "mes": mes_norm,
            "filas": [],
            "totales": {
                "invInicialBs": 0.0,
                "invInicialUsd": 0.0,
                "entradasBs": 0.0,
                "entradasUsd": 0.0,
                "salidasVentaBs": 0.0,
                "salidasVentaUsd": 0.0,
                "retirosAutoconsumoBs": 0.0,
                "retirosAutoconsumoUsd": 0.0,
                "invFinalBs": 0.0,
                "invFinalUsd": 0.0,
            },
        }

    # Saldo de cajas previo al inicio del mes + ultimo CPP previo por producto
    cur.execute(
        """
        SELECT m."productoId",
               COALESCE(SUM(m."cajas"), 0) AS "cajasIniciales"
        FROM "MovimientoInventario" m
        WHERE m."empresaId" = %s AND m."fecha" < %s
        GROUP BY m."productoId"
        """,
        (empresa_id, inicio_utc),
    )
    inicial_cajas_map = {f["productoId"]: Decimal(f["cajasIniciales"]) for f in cur.fetchall()}

    cur.execute(
        """
        SELECT DISTINCT ON (m."productoId")
               m."productoId", m."costoPromedioResultanteBs", m."costoPromedioResultanteUsd"
        FROM "MovimientoInventario" m
        WHERE m."empresaId" = %s AND m."fecha" < %s
        ORDER BY m."productoId", m."fecha" DESC, m."id" DESC
        """,
        (empresa_id, inicio_utc),
    )
    inicial_cpp_map = {f["productoId"]: f for f in cur.fetchall()}

    # Movimientos ocurridos dentro del mes en orden cronologico
    cur.execute(
        """
        SELECT m."id", m."productoId", m."tipo", m."cajas",
               m."valorTotalBs", m."valorTotalUsd",
               m."costoPromedioResultanteBs", m."costoPromedioResultanteUsd"
        FROM "MovimientoInventario" m
        WHERE m."empresaId" = %s AND m."fecha" >= %s AND m."fecha" < %s
        ORDER BY m."fecha" ASC, m."id" ASC
        """,
        (empresa_id, inicio_utc, fin_utc),
    )
    movs_por_prod: dict[str, list[dict]] = {}
    for mov in cur.fetchall():
        movs_por_prod.setdefault(mov["productoId"], []).append(mov)

    filas: list[dict] = []
    totales = {
        "invInicialBs": CERO,
        "invInicialUsd": CERO,
        "entradasBs": CERO,
        "entradasUsd": CERO,
        "salidasVentaBs": CERO,
        "salidasVentaUsd": CERO,
        "retirosAutoconsumoBs": CERO,
        "retirosAutoconsumoUsd": CERO,
        "invFinalBs": CERO,
        "invFinalUsd": CERO,
    }

    for p in productos:
        pid = p["id"]
        inv_ini_cajas = max(inicial_cajas_map.get(pid, CERO), CERO)
        movs = movs_por_prod.get(pid, [])
        if inv_ini_cajas == CERO and not movs:
            continue

        prev_cpp = inicial_cpp_map.get(pid)
        cpp_ini_bs = (
            Decimal(prev_cpp["costoPromedioResultanteBs"])
            if prev_cpp and prev_cpp["costoPromedioResultanteBs"] is not None
            else CERO
        )
        cpp_ini_usd = (
            Decimal(prev_cpp["costoPromedioResultanteUsd"])
            if prev_cpp and prev_cpp["costoPromedioResultanteUsd"] is not None
            else CERO
        )
        inv_ini_bs = q2(inv_ini_cajas * cpp_ini_bs) if inv_ini_cajas > CERO else CERO
        inv_ini_usd = q2(inv_ini_cajas * cpp_ini_usd) if inv_ini_cajas > CERO else CERO

        ent_cajas = ent_bs = ent_usd = CERO
        sal_cajas = sal_bs = sal_usd = CERO
        ret_cajas = ret_bs = ret_usd = CERO
        aju_cajas = aju_bs = aju_usd = CERO

        cpp_fin_bs = cpp_ini_bs
        cpp_fin_usd = cpp_ini_usd

        for m in movs:
            cajas_m = Decimal(m["cajas"])
            val_bs = Decimal(m["valorTotalBs"]) if m["valorTotalBs"] is not None else CERO
            val_usd = Decimal(m["valorTotalUsd"]) if m["valorTotalUsd"] is not None else CERO
            tipo = m["tipo"]

            if tipo in ("ENTRADA", "DEVOLUCION"):
                ent_cajas += cajas_m
                ent_bs += val_bs
                ent_usd += val_usd
            elif tipo == "SALIDA_VENTA":
                sal_cajas += -cajas_m
                sal_bs += -val_bs
                sal_usd += -val_usd
            elif tipo in ("RETIRO", "AUTOCONSUMO"):
                ret_cajas += -cajas_m
                ret_bs += -val_bs
                ret_usd += -val_usd
            elif tipo == "AJUSTE":
                aju_cajas += cajas_m
                aju_bs += val_bs
                aju_usd += val_usd

            if m["costoPromedioResultanteBs"] is not None:
                cpp_fin_bs = Decimal(m["costoPromedioResultanteBs"])
            if m["costoPromedioResultanteUsd"] is not None:
                cpp_fin_usd = Decimal(m["costoPromedioResultanteUsd"])

        inv_fin_cajas = q3(inv_ini_cajas + ent_cajas - sal_cajas - ret_cajas + aju_cajas)
        if inv_fin_cajas <= CERO:
            inv_fin_cajas = CERO
            inv_fin_bs = CERO
            inv_fin_usd = CERO
        else:
            inv_fin_bs = q2(inv_fin_cajas * cpp_fin_bs)
            inv_fin_usd = q2(inv_fin_cajas * cpp_fin_usd)

        totales["invInicialBs"] += inv_ini_bs
        totales["invInicialUsd"] += inv_ini_usd
        totales["entradasBs"] += q2(ent_bs)
        totales["entradasUsd"] += q2(ent_usd)
        totales["salidasVentaBs"] += q2(sal_bs)
        totales["salidasVentaUsd"] += q2(sal_usd)
        totales["retirosAutoconsumoBs"] += q2(ret_bs)
        totales["retirosAutoconsumoUsd"] += q2(ret_usd)
        totales["invFinalBs"] += inv_fin_bs
        totales["invFinalUsd"] += inv_fin_usd

        filas.append({
            "productoId": pid,
            "codigo": int(p["codigo"]),
            "nombre": p["nombre"],
            "grupo": p["grupo"],
            "unidadesPorCaja": int(p["unidadesPorCaja"]),
            "invInicialCajas": float(inv_ini_cajas),
            "invInicialBs": float(inv_ini_bs),
            "invInicialUsd": float(inv_ini_usd),
            "entradasCajas": float(q3(ent_cajas)),
            "entradasBs": float(q2(ent_bs)),
            "entradasUsd": float(q2(ent_usd)),
            "salidasVentaCajas": float(q3(sal_cajas)),
            "salidasVentaBs": float(q2(sal_bs)),
            "salidasVentaUsd": float(q2(sal_usd)),
            "retirosAutoconsumoCajas": float(q3(ret_cajas)),
            "retirosAutoconsumoBs": float(q2(ret_bs)),
            "retirosAutoconsumoUsd": float(q2(ret_usd)),
            "ajustesCajas": float(q3(aju_cajas)),
            "ajustesBs": float(q2(aju_bs)),
            "ajustesUsd": float(q2(aju_usd)),
            "invFinalCajas": float(inv_fin_cajas),
            "costoPromedioFinalBs": float(q4(cpp_fin_bs)),
            "costoPromedioFinalUsd": float(q4(cpp_fin_usd)),
            "invFinalBs": float(inv_fin_bs),
            "invFinalUsd": float(inv_fin_usd),
        })

    return {
        "empresaId": empresa_id,
        "mes": mes_norm,
        "filas": filas,
        "totales": {k: float(q2(v)) for k, v in totales.items()},
    }


COLUMNAS_ART_177 = [
    ("codigo", "Código"),
    ("nombre", "Descripción del Producto"),
    ("grupo", "Grupo"),
    ("unidadesPorCaja", "Und/Caja"),
    ("invInicialCajas", "Inv. Inicial (Cajas)"),
    ("invInicialBs", "Inv. Inicial (Bs)"),
    ("invInicialUsd", "Inv. Inicial (USD)"),
    ("entradasCajas", "Entradas (Cajas)"),
    ("entradasBs", "Entradas (Bs)"),
    ("entradasUsd", "Entradas (USD)"),
    ("salidasVentaCajas", "Salidas Venta (Cajas)"),
    ("salidasVentaBs", "Salidas Venta (Bs)"),
    ("salidasVentaUsd", "Salidas Venta (USD)"),
    ("retirosAutoconsumoCajas", "Retiros/Autoconsumo (Cajas)"),
    ("retirosAutoconsumoBs", "Retiros/Autoconsumo (Bs)"),
    ("retirosAutoconsumoUsd", "Retiros/Autoconsumo (USD)"),
    ("ajustesCajas", "Ajustes (Cajas)"),
    ("ajustesBs", "Ajustes (Bs)"),
    ("ajustesUsd", "Ajustes (USD)"),
    ("invFinalCajas", "Inv. Final (Cajas)"),
    ("costoPromedioFinalBs", "Costo Prom. Final (Bs)"),
    ("costoPromedioFinalUsd", "Costo Prom. Final (USD)"),
    ("invFinalBs", "Inv. Final (Bs)"),
    ("invFinalUsd", "Inv. Final (USD)"),
]


def reporte_art_177_xlsx(empresa: dict, reporte: dict) -> io.BytesIO:
    libro = openpyxl.Workbook()
    hoja = libro.active
    hoja.title = f"Art 177 {reporte['mes']}"

    rif = empresa.get("rif") or "Sin RIF"
    hoja.append([
        f"REGISTRO DETALLADO DE ENTRADAS Y SALIDAS DE INVENTARIO (Art. 177 RISLR) — "
        f"{empresa['razonSocial']} ({rif}) — Período {reporte['mes']}"
    ])
    hoja.cell(1, 1).font = Font(bold=True, size=12)

    hoja.append([titulo for _, titulo in COLUMNAS_ART_177])
    relleno_enc = PatternFill(start_color="1F2937", end_color="1F2937", fill_type="solid")
    fuente_enc = Font(bold=True, color="FFFFFF")
    for col_idx in range(1, len(COLUMNAS_ART_177) + 1):
        celda = hoja.cell(2, col_idx)
        celda.fill = relleno_enc
        celda.font = fuente_enc
        celda.alignment = Alignment(horizontal="center" if col_idx <= 4 else "right")

    filas = reporte["filas"]
    for f in filas:
        hoja.append([f[clave] if f[clave] is not None else "" for clave, _ in COLUMNAS_ART_177])

    if filas:
        fila_totales: list = ["TOTALES", "", "", ""]
        for clave, _ in COLUMNAS_ART_177[4:]:
            if clave in ("costoPromedioFinalBs", "costoPromedioFinalUsd"):
                fila_totales.append("")
            else:
                fila_totales.append(round(sum(f[clave] for f in filas), 3 if clave.endswith("Cajas") else 2))
        hoja.append(fila_totales)
        idx_tot = len(filas) + 3
        for col_idx in range(1, len(COLUMNAS_ART_177) + 1):
            hoja.cell(idx_tot, col_idx).font = Font(bold=True)

    datos = io.BytesIO()
    libro.save(datos)
    datos.seek(0)
    return datos


# ---------- Precios de Venta y Margenes ----------


def calcular_margen_pct(precio: Decimal | None, costo: Decimal | None, metodo: str) -> Decimal | None:
    """SOBRE_COSTO: (precio - costo) / costo * 100
    SOBRE_VENTA: (precio - costo) / precio * 100"""
    if precio is None or costo is None:
        return None
    if metodo == "SOBRE_VENTA":
        if precio <= CERO:
            return None
        return q2((precio - costo) / precio * CIEN)
    if costo <= CERO:
        return None
    return q2((precio - costo) / costo * CIEN)


def calcular_utilidad_usd(precio: Decimal | None, costo: Decimal | None) -> Decimal | None:
    if precio is None or costo is None:
        return None
    return q4(precio - costo)


def costo_segun_base(producto: dict, base: str) -> Decimal | None:
    mapa = {
        "ULTIMO": "ultimoCostoCajaUsd",
        "PROMEDIO": "costoPromedioCajaUsd",
        "PRESUPUESTARIO": "costoPresupuestarioCajaUsd",
    }
    campo = mapa.get(base)
    if not campo:
        raise HTTPException(400, f"Base de costo invalida: usa {', '.join(BASES_COSTO)}")
    val = producto.get(campo)
    return Decimal(val) if val is not None else None


def calcular_precio_desde_costo(costo: Decimal, margen_pct: Decimal, metodo: str) -> Decimal:
    if metodo not in METODOS_MARGEN:
        raise HTTPException(400, f"Metodo de margen invalido: usa {', '.join(METODOS_MARGEN)}")
    if metodo == "SOBRE_VENTA":
        if margen_pct >= CIEN:
            raise HTTPException(400, "En margen sobre venta el porcentaje debe ser menor que 100 %")
        divisor = UNO - (margen_pct / CIEN)
        return q4(costo / divisor)
    return q4(costo * (UNO + (margen_pct / CIEN)))


def enriquecer_precio_producto(base_json: dict, fila_raw: dict, lista: dict) -> dict:
    precio = Decimal(fila_raw["precioCajaUsd"]) if fila_raw.get("precioCajaUsd") is not None else None
    c_ult = Decimal(fila_raw["ultimoCostoCajaUsd"]) if fila_raw.get("ultimoCostoCajaUsd") is not None else None
    c_prom = Decimal(fila_raw["costoPromedioCajaUsd"]) if fila_raw.get("costoPromedioCajaUsd") is not None else None
    c_pres = (
        Decimal(fila_raw["costoPresupuestarioCajaUsd"])
        if fila_raw.get("costoPresupuestarioCajaUsd") is not None
        else None
    )

    metodo = lista.get("metodoMargen") or "SOBRE_COSTO"
    base_defecto = lista.get("baseCostoPorDefecto") or "ULTIMO"
    objetivo = Decimal(lista["margenObjetivoPct"]) if lista.get("margenObjetivoPct") is not None else None

    m_ult = calcular_margen_pct(precio, c_ult, metodo)
    m_prom = calcular_margen_pct(precio, c_prom, metodo)
    m_pres = calcular_margen_pct(precio, c_pres, metodo)

    u_ult = calcular_utilidad_usd(precio, c_ult)
    u_prom = calcular_utilidad_usd(precio, c_prom)
    u_pres = calcular_utilidad_usd(precio, c_pres)

    costo_ref = {"ULTIMO": c_ult, "PROMEDIO": c_prom, "PRESUPUESTARIO": c_pres}.get(base_defecto, c_ult)
    margen_ref = {"ULTIMO": m_ult, "PROMEDIO": m_prom, "PRESUPUESTARIO": m_pres}.get(base_defecto, m_ult)

    bajo_costo = bool(precio is not None and costo_ref is not None and precio < costo_ref)
    bajo_margen = bool(
        precio is not None and objetivo is not None and margen_ref is not None and margen_ref < objetivo
    )

    base_item = (
        fila_raw.get("baseCostoUsada")
        if fila_raw.get("baseCostoUsada") in BASES_COSTO
        else base_defecto
    )
    margen_item = {"ULTIMO": m_ult, "PROMEDIO": m_prom, "PRESUPUESTARIO": m_pres}.get(base_item)
    margen_mostrar = (
        margen_item
        if margen_item is not None
        else (Decimal(fila_raw["margenPct"]) if fila_raw.get("margenPct") is not None else margen_ref)
    )

    return {
        **base_json,
        "precioCajaUsd": float(precio) if precio is not None else None,
        "margenPct": float(margen_mostrar) if margen_mostrar is not None else None,
        "baseCostoUsada": fila_raw.get("baseCostoUsada"),
        "precioFijo": bool(fila_raw["precioFijo"]) if fila_raw.get("precioFijo") is not None else True,
        "margenUltimoPct": float(m_ult) if m_ult is not None else None,
        "margenPromedioPct": float(m_prom) if m_prom is not None else None,
        "margenPresupuestarioPct": float(m_pres) if m_pres is not None else None,
        "utilidadUltimoUsd": float(u_ult) if u_ult is not None else None,
        "utilidadPromedioUsd": float(u_prom) if u_prom is not None else None,
        "utilidadPresupuestarioUsd": float(u_pres) if u_pres is not None else None,
        "bajoCosto": bajo_costo,
        "bajoMargenObjetivo": bajo_margen,
    }
