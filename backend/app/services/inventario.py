"""Inventario por almacen, producto y lote.

La existencia solo se mueve con mover(): agrega el movimiento (solo se
agregan filas) y actualiza Existencia en la misma transaccion, sin dejarla en
negativo. Lo reservado por los pedidos confirmados que todavia no se
facturan se calcula, no se guarda.

Las salidas por venta van primero por lo que vence primero (cadena de frio):
salida_por_vencimiento().
"""

from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

from fastapi import HTTPException

from app.services import costos_inventario

SIN_LOTE = "SIN-LOTE"
CERO = Decimal("0")


class SinExistencia(Exception):
    pass


def lote(cur, producto_id: str, numero: str | None, vencimiento: date | None = None) -> str:
    """El id del lote (lo crea si no existe). Sin numero: SIN-LOTE."""
    numero = (numero or "").strip().upper() or SIN_LOTE
    cur.execute(
        'INSERT INTO "Lote" ("id", "productoId", "numero", "vencimiento") VALUES (%s, %s, %s, %s) '
        'ON CONFLICT ("productoId", "numero") DO UPDATE SET "vencimiento" = COALESCE("Lote"."vencimiento", EXCLUDED."vencimiento") '
        'RETURNING "id"',
        (f"lote-{uuid.uuid4().hex[:12]}", producto_id, numero, vencimiento),
    )
    return cur.fetchone()["id"]


def mover(
    cur,
    *,
    empresa_id: str,
    almacen_id: str,
    producto_id: str,
    lote_id: str,
    tipo: str,
    cajas: Decimal,
    documento_id: str | None = None,
    ajuste_id: str | None = None,
    referencia: str | None = None,
    usuario_id: str | None = None,
    costo_unitario_usd: Decimal | None = None,
    costo_unitario_bs: Decimal | None = None,
    tasa: Decimal | None = None,
    proveedor: str | None = None,
    numero_factura_compra: str | None = None,
) -> Decimal:
    """Agrega el movimiento valorado (Art. 177 RISLR), actualiza los 3 costos
    del producto cuando corresponde y devuelve la existencia que queda en el
    lote. Lanza SinExistencia si una salida la deja en negativo."""
    cajas = Decimal(cajas)
    if cajas == CERO:
        return CERO
    producto, existencia_antes = costos_inventario.bloquear_producto_y_existencia(cur, producto_id)
    cur.execute(
        'INSERT INTO "Existencia" ("id", "almacenId", "productoId", "loteId", "cajas") VALUES (%s, %s, %s, %s, %s) '
        'ON CONFLICT ("almacenId", "productoId", "loteId") DO UPDATE SET "cajas" = "Existencia"."cajas" + EXCLUDED."cajas" '
        'RETURNING "cajas"',
        (f"exi-{uuid.uuid4().hex[:12]}", almacen_id, producto_id, lote_id, cajas),
    )
    queda = Decimal(cur.fetchone()["cajas"])
    if queda < CERO:
        raise SinExistencia(f"La salida deja la existencia en {queda} cajas")

    snapshot, cambios_historial = costos_inventario.valorar_y_actualizar_producto(
        cur,
        producto=producto,
        existencia_antes=existencia_antes,
        tipo=tipo,
        cajas=cajas,
        costo_unitario_usd=costo_unitario_usd,
        costo_unitario_bs=costo_unitario_bs,
        tasa=tasa,
        referencia=referencia,
    )
    org_id = producto.get("organizacionId") or "org-principal"
    cur.execute(
        'INSERT INTO "MovimientoInventario" '
        '("organizacionId", "empresaId", "almacenId", "productoId", "loteId", "tipo", "cajas", '
        '"costoUnitarioUsd", "costoUnitarioBs", "tasa", "valorTotalUsd", "valorTotalBs", '
        '"saldoCajasEmpresa", "costoPromedioResultanteUsd", "costoPromedioResultanteBs", '
        '"proveedor", "numeroFacturaCompra", "documentoVentaId", "ajusteId", "referencia", "usuarioId") '
        "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) "
        'RETURNING "id", "fecha"',
        (
            org_id,
            empresa_id,
            almacen_id,
            producto_id,
            lote_id,
            tipo,
            cajas,
            snapshot["costoUnitarioUsd"],
            snapshot["costoUnitarioBs"],
            snapshot["tasa"],
            snapshot["valorTotalUsd"],
            snapshot["valorTotalBs"],
            snapshot["saldoCajasEmpresa"],
            snapshot["costoPromedioResultanteUsd"],
            snapshot["costoPromedioResultanteBs"],
            proveedor,
            numero_factura_compra,
            documento_id,
            ajuste_id,
            referencia,
            usuario_id,
        ),
    )
    mov = cur.fetchone()
    for h in cambios_historial:
        costos_inventario.registrar_historial_costo(
            cur,
            organizacion_id=org_id,
            empresa_id=empresa_id,
            producto_id=producto_id,
            tipo_costo=h["tipo_costo"],
            costo_anterior_usd=h["anterior_usd"],
            costo_nuevo_usd=h["nuevo_usd"],
            costo_nuevo_bs=h["nuevo_bs"],
            tasa=h["tasa"],
            motivo=h["motivo"],
            movimiento_id=mov["id"],
            usuario_id=usuario_id,
            fecha=mov["fecha"],
        )
    return queda


def existencia_producto(cur, almacen_id: str, producto_id: str) -> Decimal:
    cur.execute(
        'SELECT COALESCE(SUM("cajas"), 0) AS c FROM "Existencia" WHERE "almacenId" = %s AND "productoId" = %s',
        (almacen_id, producto_id),
    )
    return Decimal(cur.fetchone()["c"])


def reservado(cur, almacen_id: str, producto_ids: list[str] | None = None, sin_pedido: str | None = None) -> dict[str, Decimal]:
    """Cajas de los pedidos confirmados (todavia sin facturar) por producto."""
    cur.execute(
        'SELECT i."productoId", SUM(i."cajas") AS c FROM "PedidoItem" i JOIN "Pedido" p ON p."id" = i."pedidoId" '
        "WHERE p.\"estado\" = 'CONFIRMADO' AND p.\"almacenId\" = %s "
        'AND (%s::text[] IS NULL OR i."productoId" = ANY(%s)) AND (%s::text IS NULL OR p."id" <> %s) '
        'GROUP BY i."productoId"',
        (almacen_id, producto_ids, producto_ids, sin_pedido, sin_pedido),
    )
    return {f["productoId"]: Decimal(f["c"]) for f in cur.fetchall()}


def disponible(cur, almacen_id: str, producto_id: str, sin_pedido: str | None = None) -> Decimal:
    return existencia_producto(cur, almacen_id, producto_id) - reservado(
        cur, almacen_id, [producto_id], sin_pedido
    ).get(producto_id, CERO)


def salida_por_vencimiento(
    cur, *, empresa_id: str, almacen_id: str, producto_id: str, cajas: Decimal, tipo: str,
    documento_id: str | None, usuario_id: str | None, referencia: str | None = None,
) -> list[dict]:
    """Saca `cajas` empezando por los lotes que vencen primero (los sin fecha
    al final). Devuelve [{loteId, cajas}]. SinExistencia si no alcanza."""
    cur.execute(
        'SELECT e."loteId", e."cajas" FROM "Existencia" e JOIN "Lote" l ON l."id" = e."loteId" '
        'WHERE e."almacenId" = %s AND e."productoId" = %s AND e."cajas" > 0 '
        'ORDER BY l."vencimiento" ASC NULLS LAST, l."creadoEn" ASC FOR UPDATE OF e',
        (almacen_id, producto_id),
    )
    falta = Decimal(cajas)
    usados = []
    for fila in cur.fetchall():
        if falta <= CERO:
            break
        toma = min(Decimal(fila["cajas"]), falta)
        mover(
            cur, empresa_id=empresa_id, almacen_id=almacen_id, producto_id=producto_id, lote_id=fila["loteId"],
            tipo=tipo, cajas=-toma, documento_id=documento_id, usuario_id=usuario_id, referencia=referencia,
        )
        usados.append({"loteId": fila["loteId"], "cajas": toma})
        falta -= toma
    if falta > CERO:
        raise SinExistencia(f"Faltan {falta} cajas")
    return usados


def devolver_de_documento(
    cur, *, documento_origen_id: str, documento_id: str, producto_id: str, cajas: Decimal, usuario_id: str | None
) -> None:
    """Devuelve al inventario lo que salio con `documento_origen_id`, a los
    mismos lotes y almacen (para una nota de credito con devolucion)."""
    cur.execute(
        'SELECT m."empresaId", m."almacenId", m."loteId", -SUM(m."cajas") AS salio, '
        'MAX(m."costoUnitarioUsd") AS "costoUsd", MAX(m."costoUnitarioBs") AS "costoBs", MAX(m."tasa") AS "tasa" '
        'FROM "MovimientoInventario" m '
        'WHERE m."documentoVentaId" = %s AND m."productoId" = %s GROUP BY 1, 2, 3 HAVING SUM(m."cajas") < 0',
        (documento_origen_id, producto_id),
    )
    falta = Decimal(cajas)
    for fila in cur.fetchall():
        if falta <= CERO:
            break
        vuelve = min(Decimal(fila["salio"]), falta)
        mover(
            cur,
            empresa_id=fila["empresaId"],
            almacen_id=fila["almacenId"],
            producto_id=producto_id,
            lote_id=fila["loteId"],
            tipo="DEVOLUCION",
            cajas=vuelve,
            documento_id=documento_id,
            usuario_id=usuario_id,
            costo_unitario_usd=fila["costoUsd"],
            costo_unitario_bs=fila["costoBs"],
            tasa=fila["tasa"],
        )
        falta -= vuelve
    if falta > CERO:
        raise HTTPException(409, "Se devuelven mas cajas de las que salieron con el documento")


def existencias(cur, empresa_id: str, almacen_id: str | None = None) -> list[dict]:
    """Por producto: existencia, reservado, disponible, los 3 costos con sus
    valorizaciones totales y sus lotes."""
    cur.execute(
        'SELECT p."id" AS "productoId", p."codigo", p."nombre", p."grupo", p."unidadesPorCaja", '
        'p."ultimoCostoCajaUsd", p."ultimoCostoCajaBs", '
        'p."costoPromedioCajaUsd", p."costoPromedioCajaBs", '
        'p."costoPresupuestarioCajaUsd", p."modoPresupuestario", p."porcentajePresupuestario", '
        'e."almacenId", e."loteId", l."numero" AS "lote", l."vencimiento", e."cajas" '
        'FROM "Existencia" e JOIN "Producto" p ON p."id" = e."productoId" JOIN "Lote" l ON l."id" = e."loteId" '
        'WHERE p."empresaId" = %s AND (%s::text IS NULL OR e."almacenId" = %s) AND e."cajas" <> 0 '
        'ORDER BY p."grupo", p."nombre", l."vencimiento" NULLS LAST',
        (empresa_id, almacen_id, almacen_id),
    )
    por_producto: dict[tuple[str, str], dict] = {}
    costos_raw: dict[str, dict] = {}
    for f in cur.fetchall():
        pid = f["productoId"]
        costos_raw.setdefault(pid, f)
        clave = (pid, f["almacenId"])
        item = por_producto.setdefault(clave, {
            "productoId": pid,
            "codigo": int(f["codigo"]),
            "nombre": f["nombre"],
            "grupo": f["grupo"],
            "unidadesPorCaja": f["unidadesPorCaja"],
            "almacenId": f["almacenId"],
            "cajas": CERO,
            "lotes": [],
        })
        item["cajas"] += Decimal(f["cajas"])
        item["lotes"].append({
            "loteId": f["loteId"],
            "lote": f["lote"],
            "vencimiento": f["vencimiento"],
            "cajas": float(f["cajas"]),
        })
    resultado = []
    almacenes = {a for _, a in por_producto}
    reservas = {a: reservado(cur, a) for a in almacenes}
    for (producto_id, almacen), item in por_producto.items():
        res = reservas[almacen].get(producto_id, CERO)
        cajas_dec = item["cajas"]
        c_info = costos_raw[producto_id]
        u_usd = Decimal(c_info["ultimoCostoCajaUsd"]) if c_info["ultimoCostoCajaUsd"] is not None else None
        u_bs = Decimal(c_info["ultimoCostoCajaBs"]) if c_info["ultimoCostoCajaBs"] is not None else None
        cpp_usd = Decimal(c_info["costoPromedioCajaUsd"]) if c_info["costoPromedioCajaUsd"] is not None else None
        cpp_bs = Decimal(c_info["costoPromedioCajaBs"]) if c_info["costoPromedioCajaBs"] is not None else None
        pres_usd = (
            Decimal(c_info["costoPresupuestarioCajaUsd"])
            if c_info["costoPresupuestarioCajaUsd"] is not None
            else None
        )
        pct_pres = (
            Decimal(c_info["porcentajePresupuestario"])
            if c_info["porcentajePresupuestario"] is not None
            else None
        )
        resultado.append({
            **item,
            "cajas": float(cajas_dec),
            "reservado": float(res),
            "disponible": float(cajas_dec - res),
            "ultimoCostoCajaUsd": float(u_usd) if u_usd is not None else None,
            "ultimoCostoCajaBs": float(u_bs) if u_bs is not None else None,
            "costoPromedioCajaUsd": float(cpp_usd) if cpp_usd is not None else None,
            "costoPromedioCajaBs": float(cpp_bs) if cpp_bs is not None else None,
            "costoPresupuestarioCajaUsd": float(pres_usd) if pres_usd is not None else None,
            "modoPresupuestario": c_info["modoPresupuestario"] or "MANUAL",
            "porcentajePresupuestario": float(pct_pres) if pct_pres is not None else None,
            "valorUltimoUsd": float(costos_inventario.q2(cajas_dec * u_usd)) if u_usd is not None else 0.0,
            "valorPromedioUsd": float(costos_inventario.q2(cajas_dec * cpp_usd)) if cpp_usd is not None else 0.0,
            "valorPromedioBs": float(costos_inventario.q2(cajas_dec * cpp_bs)) if cpp_bs is not None else 0.0,
            "valorPresupuestarioUsd": (
                float(costos_inventario.q2(cajas_dec * pres_usd)) if pres_usd is not None else 0.0
            ),
        })
    return resultado
