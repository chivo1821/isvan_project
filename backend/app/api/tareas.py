"""Tareas en segundo plano llamadas desde afuera (cron de Vercel, el
servicio "tareas" de docker-compose, EventBridge o Cloud Scheduler), con
"Authorization: Bearer <CRON_SECRET>"."""

from __future__ import annotations

import hmac
import os

from fastapi import APIRouter, Header, HTTPException

from app.services import tareas

router = APIRouter(prefix="/tareas", tags=["tareas"])


def exigir_secreto(authorization: str | None) -> None:
    secreto = os.getenv("CRON_SECRET")
    if not secreto:
        raise HTTPException(503, "CRON_SECRET no esta configurado")
    if not authorization or not hmac.compare_digest(authorization.encode(), f"Bearer {secreto}".encode()):
        raise HTTPException(401, "No autorizado")


@router.get("/procesar")
def procesar_cola(authorization: str | None = Header(default=None)):
    """Ejecuta las tareas pendientes de la cola (ver app/services/tareas.py)."""
    exigir_secreto(authorization)
    return tareas.procesar()
