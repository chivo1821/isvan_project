"""Listas completas (sin filtrar) de tablas de auditoria/tracking — el
frontend ya sabe filtrarlas por despachoId/rutaId (misma logica que hoy
tiene sobre los arrays, ver src/lib/mock-data/index.ts).
"""

from fastapi import APIRouter

from app.core.db import get_connection
from app.schemas import DespachoAprobacion, RutaPunto

router = APIRouter(tags=["historial"])


@router.get("/despacho-aprobaciones", response_model=list[DespachoAprobacion])
def listar_despacho_aprobaciones():
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute('SELECT * FROM "DespachoAprobacion"')
        return cur.fetchall()


@router.get("/ruta-puntos", response_model=list[RutaPunto])
def listar_ruta_puntos():
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute('SELECT * FROM "RutaPunto" ORDER BY "rutaId", "orden"')
        return cur.fetchall()
