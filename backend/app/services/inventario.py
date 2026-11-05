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
) -> Decimal:
    """Agrega el movimiento y devuelve la existencia que queda. Lanza
    SinExistencia si una salida la deja en negativo."""
    cajas = Decimal(cajas)
    if cajas == CERO:
        return CERO
    cur.execute(
        'INSERT INTO "Existencia" ("id", "almacenId", "productoId", "loteId", "cajas") VALUES (%s, %s, %s, %s, %s) '
        'ON CONFLICT ("almacenId", "productoId", "loteId") DO UPDATE SET "cajas" = "Existencia"."cajas" + EXCLUDED."cajas" '
        'RETURNING "cajas"',
        (f"exi-{uuid.uuid4().hex[:12]}", almacen_id, producto_id, lote_id, cajas),
    )
    queda = Decimal(cur.fetchone()["cajas"])
    if queda < CERO:
        raise SinExistencia(f"La salida deja la existencia en {queda} cajas")
    cur.execute(
        'INSERT INTO "MovimientoInventario" ("empresaId", "almacenId", "productoId", "loteId", "tipo", "cajas", '
        '"documentoVentaId", "ajusteId", "referencia", "usuarioId") VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)',
        (empresa_id, almacen_id, producto_id, lote_id, tipo, cajas, documento_id, ajuste_id, referencia, usuario_id),
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
        'SELECT m."empresaId", m."almacenId", m."loteId", -SUM(m."cajas") AS salio FROM "MovimientoInventario" m '
        'WHERE m."documentoVentaId" = %s AND m."productoId" = %s GROUP BY 1, 2, 3 HAVING SUM(m."cajas") < 0',
        (documento_origen_id, producto_id),
    )
    falta = Decimal(cajas)
    for fila in cur.fetchall():
        if falta <= CERO:
            break
        vuelve = min(Decimal(fila["salio"]), falta)
        mover(
            cur, empresa_id=fila["empresaId"], almacen_id=fila["almacenId"], producto_id=producto_id,
            lote_id=fila["loteId"], tipo="DEVOLUCION", cajas=vuelve, documento_id=documento_id, usuario_id=usuario_id,
        )
        falta -= vuelve
    if falta > CERO:
        raise HTTPException(409, "Se devuelven mas cajas de las que salieron con el documento")


def existencias(cur, empresa_id: str, almacen_id: str | None = None) -> list[dict]:
    """Por producto: existencia, reservado, disponible y sus lotes."""
    cur.execute(
        'SELECT p."id" AS "productoId", p."codigo", p."nombre", p."grupo", p."unidadesPorCaja", e."almacenId", '
        'e."loteId", l."numero" AS "lote", l."vencimiento", e."cajas" '
        'FROM "Existencia" e JOIN "Producto" p ON p."id" = e."productoId" JOIN "Lote" l ON l."id" = e."loteId" '
        'WHERE p."empresaId" = %s AND (%s::text IS NULL OR e."almacenId" = %s) AND e."cajas" <> 0 '
        'ORDER BY p."grupo", p."nombre", l."vencimiento" NULLS LAST',
        (empresa_id, almacen_id, almacen_id),
    )
    por_producto: dict[tuple[str, str], dict] = {}
    for f in cur.fetchall():
        clave = (f["productoId"], f["almacenId"])
        item = por_producto.setdefault(clave, {
            "productoId": f["productoId"], "codigo": int(f["codigo"]), "nombre": f["nombre"], "grupo": f["grupo"],
            "unidadesPorCaja": f["unidadesPorCaja"], "almacenId": f["almacenId"], "cajas": CERO, "lotes": [],
        })
        item["cajas"] += Decimal(f["cajas"])
        item["lotes"].append({"loteId": f["loteId"], "lote": f["lote"], "vencimiento": f["vencimiento"],
                              "cajas": float(f["cajas"])})
    resultado = []
    almacenes = {a for _, a in por_producto}
    reservas = {a: reservado(cur, a) for a in almacenes}
    for (producto_id, almacen), item in por_producto.items():
        res = reservas[almacen].get(producto_id, CERO)
        resultado.append({**item, "cajas": float(item["cajas"]), "reservado": float(res),
                          "disponible": float(item["cajas"] - res)})
    return resultado
