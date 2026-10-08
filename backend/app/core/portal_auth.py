"""Sesion del portal de clientes: el mismo mecanismo que la interna
(app/core/auth.py: token en cookie httpOnly, solo su hash en la base), pero
en otra tabla (SesionPortal) y con otra cookie (portal_sesion).

Separarlas es la defensa principal del portal: una cuenta de cliente no es
un Usuario, asi que get_current_user nunca la reconoce y toda la API interna
le responde 401, sin depender de que cada endpoint revise el rol.
"""

from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import timedelta

from fastapi import Cookie, Depends, HTTPException

from app.core.db import get_connection
from app.core.fechas import ahora_utc

PORTAL_COOKIE = "portal_sesion"
PORTAL_TTL = timedelta(hours=12)


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def crear_sesion_portal(cur, cuenta_id: str) -> str:
    token = secrets.token_urlsafe(32)
    cur.execute(
        'INSERT INTO "SesionPortal" ("id", "cuentaId", "tokenHash", "creadoEn", "expiraEn") VALUES (%s, %s, %s, %s, %s)',
        (f"sesp-{uuid.uuid4().hex[:16]}", cuenta_id, _hash(token), ahora_utc(), ahora_utc() + PORTAL_TTL),
    )
    return token


def eliminar_sesion_portal(cur, token: str) -> None:
    cur.execute('DELETE FROM "SesionPortal" WHERE "tokenHash" = %s', (_hash(token),))


def cerrar_sesiones(cur, cuenta_id: str) -> None:
    cur.execute('DELETE FROM "SesionPortal" WHERE "cuentaId" = %s', (cuenta_id,))


def cuenta_de_sesion(portal_sesion: str | None = Cookie(default=None)) -> dict:
    """La cuenta de la sesion, este o no vinculada todavia (para /portal/me)."""
    if not portal_sesion:
        raise HTTPException(401, "No autenticado")
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            'SELECT c."id", c."email", c."nombre", c."rif", c."telefono", c."estado", c."empresaDeclarada", '
            'c."codigoDeclarado", c."createdAt" FROM "SesionPortal" s JOIN "CuentaPortal" c ON c."id" = s."cuentaId" '
            "WHERE s.\"tokenHash\" = %s AND s.\"expiraEn\" > now() AT TIME ZONE 'UTC' "
            "AND c.\"estado\" IN ('POR_VALIDAR', 'ACTIVA')",
            (_hash(portal_sesion),),
        )
        cuenta = cur.fetchone()
        if not cuenta:
            raise HTTPException(401, "Sesion invalida o expirada")
        cur.execute(
            'SELECT "empresa"::text AS "empresa", "codigoCliente" FROM "CuentaPortalCliente" WHERE "cuentaId" = %s '
            'ORDER BY "empresa", "codigoCliente"',
            (cuenta["id"],),
        )
        cuenta["clientes"] = [(f["empresa"], f["codigoCliente"]) for f in cur.fetchall()]
    return cuenta


def get_cuenta_portal(cuenta: dict = Depends(cuenta_de_sesion)) -> dict:
    """Dependencia de los endpoints del portal con datos: la cuenta tiene que
    estar activa y vinculada a al menos un cliente. Todo lo que devuelven se
    filtra por cuenta["clientes"]."""
    if cuenta["estado"] != "ACTIVA" or not cuenta["clientes"]:
        raise HTTPException(403, "Tu cuenta todavia esta en validacion")
    return cuenta
