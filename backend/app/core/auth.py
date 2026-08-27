"""Autenticacion por sesion: cookie httpOnly emitida por FastAPI, respaldada
en la tabla Sesion (no JWT). Revocar una sesion es borrar la fila — practico
para un equipo interno pequeno donde puede hacer falta cerrar la sesion de
alguien a mano. El token crudo nunca se guarda, solo su hash (sha256).

Herramienta interna para un equipo de confianza: sin JWT/OAuth/recuperacion
de contraseña por correo, todo desproporcionado aca (ver docs/PLAN.md).
"""

from __future__ import annotations

import hashlib
import os
import secrets
import uuid
from datetime import datetime, timedelta

import bcrypt
from fastapi import Cookie, Depends, HTTPException

from app.core.db import get_connection

SESSION_COOKIE_NAME = "sesion_id"
SESSION_TTL = timedelta(hours=12)

# En prod (HTTPS) la cookie debe ir con Secure; en dev local (HTTP) no puede
# llevarlo o el navegador la descarta. COOKIE_SECURE=true en el .env de prod.
COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "false").lower() == "true"


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def crear_sesion(cur, usuario_id: str) -> str:
    """Crea la fila en Sesion y devuelve el token crudo (va en la cookie);
    solo su hash queda en la BD."""
    token = secrets.token_urlsafe(32)
    expira_en = datetime.now() + SESSION_TTL
    cur.execute(
        'INSERT INTO "Sesion" ("id", "usuarioId", "tokenHash", "expiraEn") VALUES (%s, %s, %s, %s)',
        (f"ses-{uuid.uuid4().hex[:16]}", usuario_id, _hash_token(token), expira_en),
    )
    return token


def eliminar_sesion(cur, token: str) -> None:
    cur.execute('DELETE FROM "Sesion" WHERE "tokenHash" = %s', (_hash_token(token),))


def get_current_user(sesion_id: str | None = Cookie(default=None)) -> dict:
    """Dependencia FastAPI: resuelve el usuario autenticado a partir de la
    cookie de sesion. 401 si no hay cookie, la sesion no existe, expiro, o el
    usuario esta inactivo."""
    if not sesion_id:
        raise HTTPException(401, "No autenticado")

    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            'SELECT u.* FROM "Sesion" s JOIN "Usuario" u ON u."id" = s."usuarioId" '
            'WHERE s."tokenHash" = %s AND s."expiraEn" > now() AND u."activo" = true',
            (_hash_token(sesion_id),),
        )
        usuario = cur.fetchone()

    if not usuario:
        raise HTTPException(401, "Sesion invalida o expirada")
    return usuario


def requiere_rol(*roles: str):
    """Dependencia parametrizada para restringir un endpoint a ciertos
    roles (ver tabla de permisos en docs/PLAN.md). ADMIN siempre pasa."""

    def _check(usuario: dict = Depends(get_current_user)) -> dict:
        if usuario["rol"] != "ADMIN" and usuario["rol"] not in roles:
            raise HTTPException(403, "No tienes permiso para realizar esta accion")
        return usuario

    return _check
