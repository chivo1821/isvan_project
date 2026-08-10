from fastapi import APIRouter, HTTPException

from app.core.db import get_connection
from app.schemas import Producto, StockAlmacen

router = APIRouter(tags=["productos"])


@router.get("/stock", response_model=list[StockAlmacen])
def listar_stock():
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute('SELECT * FROM "StockAlmacen"')
        return cur.fetchall()


@router.get("/productos", response_model=list[Producto])
def listar_productos():
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute('SELECT * FROM "Producto" ORDER BY "nombre"')
        return cur.fetchall()


@router.get("/productos/{producto_id}", response_model=Producto)
def obtener_producto(producto_id: str):
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute('SELECT * FROM "Producto" WHERE "id" = %s', (producto_id,))
        row = cur.fetchone()
    if not row:
        raise HTTPException(404, "Producto no encontrado")
    return row
