import uuid

from fastapi import APIRouter, HTTPException

from app.core.db import get_connection
from app.core.numero import siguiente_numero
from app.schemas import Venta, VentaCreate, VentaRevisionCreate

router = APIRouter(prefix="/ventas", tags=["ventas"])

FACTURA_ESTADOS_DEUDA = ("PENDIENTE", "VENCIDA")


def _con_items(cur, venta_row: dict) -> dict:
    cur.execute(
        'SELECT "id", "productoId", "cantidad", "precioUnitario", "subtotal" '
        'FROM "VentaItem" WHERE "ventaId" = %s',
        (venta_row["id"],),
    )
    return {**venta_row, "items": cur.fetchall()}


@router.get("", response_model=list[Venta])
def listar_ventas():
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute('SELECT * FROM "Venta" ORDER BY "fecha" DESC')
        ventas = cur.fetchall()
        return [_con_items(cur, v) for v in ventas]


@router.get("/revision", response_model=list[Venta])
def listar_ventas_en_revision():
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute('SELECT * FROM "Venta" WHERE "estado" = \'EN_REVISION\' ORDER BY "fecha"')
        ventas = cur.fetchall()
        return [_con_items(cur, v) for v in ventas]


@router.get("/{venta_id}", response_model=Venta)
def obtener_venta(venta_id: str):
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute('SELECT * FROM "Venta" WHERE "id" = %s', (venta_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Venta no encontrada")
        return _con_items(cur, row)


@router.post("", response_model=Venta, status_code=201)
def crear_venta(data: VentaCreate):
    if not data.items:
        raise HTTPException(400, "La venta necesita al menos un producto")

    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            'SELECT 1 FROM "Factura" WHERE "clienteId" = %s AND "estado" = ANY(%s) LIMIT 1',
            (data.clienteId, list(FACTURA_ESTADOS_DEUDA)),
        )
        tiene_deuda = cur.fetchone() is not None

        cur.execute('SELECT "tasa" FROM "TasaCambio" ORDER BY "fecha" DESC LIMIT 1')
        tasa_row = cur.fetchone()
        if not tasa_row:
            raise HTTPException(409, "No hay ninguna tasa BCV registrada todavia")
        tasa_bcv = tasa_row["tasa"]

        items_armados = []
        total = 0
        for item in data.items:
            cur.execute('SELECT "precioUnitario" FROM "Producto" WHERE "id" = %s', (item.productoId,))
            producto = cur.fetchone()
            if not producto:
                raise HTTPException(400, f"Producto {item.productoId} no existe")
            precio = producto["precioUnitario"]
            subtotal = precio * item.cantidad
            total += subtotal
            items_armados.append({
                "id": f"vi-{uuid.uuid4().hex[:10]}",
                "productoId": item.productoId,
                "cantidad": item.cantidad,
                "precioUnitario": precio,
                "subtotal": subtotal,
            })

        numero = siguiente_numero(cur, "Venta", "V", 4)
        estado = "EN_REVISION" if tiene_deuda else "APROBADA"
        venta_id = f"venta-{uuid.uuid4().hex[:10]}"

        cur.execute(
            'INSERT INTO "Venta" ("id", "numero", "clienteId", "vendedorId", "estado", "total", "tasaBcv") '
            "VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING *",
            (venta_id, numero, data.clienteId, data.vendedorId, estado, total, tasa_bcv),
        )
        venta_row = cur.fetchone()

        for item in items_armados:
            cur.execute(
                'INSERT INTO "VentaItem" ("id", "ventaId", "productoId", "cantidad", "precioUnitario", "subtotal") '
                "VALUES (%s, %s, %s, %s, %s, %s)",
                (item["id"], venta_id, item["productoId"], item["cantidad"], item["precioUnitario"], item["subtotal"]),
            )

        conn.commit()
        return {**venta_row, "items": items_armados}


@router.post("/{venta_id}/revision", response_model=Venta)
def revisar_venta(venta_id: str, data: VentaRevisionCreate):
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute('SELECT * FROM "Venta" WHERE "id" = %s', (venta_id,))
        venta = cur.fetchone()
        if not venta:
            raise HTTPException(404, "Venta no encontrada")
        if venta["estado"] != "EN_REVISION":
            raise HTTPException(400, "Esta venta no esta en revision")

        cur.execute(
            'INSERT INTO "VentaRevision" ("id", "ventaId", "usuarioId", "accion", "comentario") '
            "VALUES (%s, %s, %s, %s, %s)",
            (f"vrev-{uuid.uuid4().hex[:10]}", venta_id, data.usuarioId, data.accion, data.comentario),
        )

        nuevo_estado = "APROBADA" if data.accion == "APROBADA" else "RECHAZADA"
        cur.execute(
            'UPDATE "Venta" SET "estado" = %s WHERE "id" = %s RETURNING *',
            (nuevo_estado, venta_id),
        )
        venta_row = cur.fetchone()
        conn.commit()
        return _con_items(cur, venta_row)
