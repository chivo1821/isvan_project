from fastapi import APIRouter

from app.core.db import get_connection
from app.schemas import Almacen

router = APIRouter(prefix="/almacenes", tags=["almacenes"])


@router.get("", response_model=list[Almacen])
def listar_almacenes():
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute('SELECT * FROM "Almacen"')
        return cur.fetchall()
