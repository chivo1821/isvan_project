from fastapi import APIRouter, HTTPException

from app.core.db import get_connection
from app.schemas import Cliente, Factura

router = APIRouter(prefix="/clientes", tags=["clientes"])


@router.get("", response_model=list[Cliente])
def listar_clientes():
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute('SELECT * FROM "Cliente" ORDER BY "nombre"')
        return cur.fetchall()


@router.get("/facturas", response_model=list[Factura])
def listar_todas_las_facturas():
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute('SELECT * FROM "Factura"')
        return cur.fetchall()


@router.get("/{codigo}", response_model=Cliente)
def obtener_cliente(codigo: str):
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute('SELECT * FROM "Cliente" WHERE "codigo" = %s', (codigo,))
        row = cur.fetchone()
    if not row:
        raise HTTPException(404, "Cliente no encontrado")
    return row


@router.get("/{codigo}/facturas", response_model=list[Factura])
def facturas_de_cliente(codigo: str):
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute('SELECT * FROM "Factura" WHERE "clienteId" = %s ORDER BY "fechaEmision" DESC', (codigo,))
        return cur.fetchall()
