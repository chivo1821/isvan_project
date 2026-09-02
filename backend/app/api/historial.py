"""Listas completas (sin filtrar) de tablas de auditoria/tracking — el
frontend ya sabe filtrarlas por despachoId/rutaId (misma logica que hoy
tiene sobre los arrays, ver src/lib/mock-data/index.ts).
"""

from fastapi import APIRouter, Depends

from app.core.auth import get_current_user
from app.core.db import get_connection
from app.core.permisos import ids_rutas_visibles
from app.schemas import DespachoAprobacion, RutaPunto

router = APIRouter(tags=["historial"])


@router.get("/despacho-aprobaciones", response_model=list[DespachoAprobacion])
def listar_despacho_aprobaciones(usuario: dict = Depends(get_current_user)):
    """El historial de aprobaciones es informacion de la coordinacion: un
    REPARTIDOR no lo necesita y no lo recibe (lista vacia)."""
    with get_connection() as conn, conn.cursor() as cur:
        if ids_rutas_visibles(cur, usuario) is not None:
            return []
        cur.execute('SELECT * FROM "DespachoAprobacion"')
        return cur.fetchall()


@router.get("/ruta-puntos", response_model=list[RutaPunto])
def listar_ruta_puntos(usuario: dict = Depends(get_current_user)):
    with get_connection() as conn, conn.cursor() as cur:
        rutas = ids_rutas_visibles(cur, usuario)
        if rutas is not None:
            if not rutas:
                return []
            cur.execute(
                'SELECT * FROM "RutaPunto" WHERE "rutaId" = ANY(%s) ORDER BY "rutaId", "orden"',
                (rutas,),
            )
            return cur.fetchall()
        cur.execute('SELECT * FROM "RutaPunto" ORDER BY "rutaId", "orden"')
        return cur.fetchall()
