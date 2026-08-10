from fastapi import APIRouter, HTTPException

from app.core.db import get_connection
from app.schemas import TasaCambio

router = APIRouter(prefix="/tasa-cambio", tags=["tasa-cambio"])


@router.get("/actual", response_model=TasaCambio)
def obtener_tasa_actual():
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute('SELECT * FROM "TasaCambio" ORDER BY "fecha" DESC LIMIT 1')
        row = cur.fetchone()
    if not row:
        raise HTTPException(404, "No hay ninguna tasa BCV registrada todavia")
    return row


@router.get("", response_model=list[TasaCambio])
def listar_tasas():
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute('SELECT * FROM "TasaCambio" ORDER BY "fecha" DESC')
        return cur.fetchall()
