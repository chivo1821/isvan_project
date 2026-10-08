"""Acceso al portal de clientes: registro, confirmacion del correo, ingreso,
salida y recuperacion de la clave. Publico (sin sesion); la logica esta en
app/services/portal_cuentas.py y la sesion en app/core/portal_auth.py."""

from __future__ import annotations

from fastapi import APIRouter, Cookie, Response

from app.core.auth import COOKIE_SECURE
from app.core.db import get_connection
from app.core.portal_auth import PORTAL_COOKIE, PORTAL_TTL, crear_sesion_portal, eliminar_sesion_portal
from app.schemas import (
    CambiarClavePortalRequest,
    ConfirmarCorreoRequest,
    CorreoRequest,
    LoginPortalRequest,
    RegistroPortalRequest,
)
from app.services import portal_cuentas as pc

router = APIRouter(prefix="/portal/auth", tags=["portal"])

# Misma respuesta exista o no el correo (ver portal_cuentas).
_ENVIADO = {"mensaje": "Si el correo puede usarse, te enviamos un código. Revisa tu bandeja de entrada y el spam."}


def _poner_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=PORTAL_COOKIE,
        value=token,
        max_age=int(PORTAL_TTL.total_seconds()),
        httponly=True,
        secure=COOKIE_SECURE,
        samesite="lax",
        path="/",
    )


@router.post("/registro")
def registro(data: RegistroPortalRequest):
    with get_connection() as conn, conn.cursor() as cur:
        pc.registrar(cur, data.model_dump())
        conn.commit()
    return _ENVIADO


@router.post("/confirmar")
def confirmar(data: ConfirmarCorreoRequest, response: Response):
    """Confirma el correo y deja la sesion iniciada."""
    with get_connection() as conn, conn.cursor() as cur:
        cuenta = pc.confirmar(cur, data.email, data.codigo)
        token = crear_sesion_portal(cur, cuenta["id"])
        conn.commit()
    _poner_cookie(response, token)
    return {"ok": True}


@router.post("/reenviar")
def reenviar(data: CorreoRequest):
    with get_connection() as conn, conn.cursor() as cur:
        pc.reenviar(cur, data.email, pc.CONFIRMAR)
        conn.commit()
    return _ENVIADO


@router.post("/login")
def login(data: LoginPortalRequest, response: Response):
    with get_connection() as conn, conn.cursor() as cur:
        cuenta = pc.autenticar(cur, data.email, data.password)
        token = crear_sesion_portal(cur, cuenta["id"])
        conn.commit()
    _poner_cookie(response, token)
    return {"ok": True}


@router.post("/logout", status_code=204)
def logout(response: Response, portal_sesion: str | None = Cookie(default=None)):
    if portal_sesion:
        with get_connection() as conn, conn.cursor() as cur:
            eliminar_sesion_portal(cur, portal_sesion)
            conn.commit()
    response.delete_cookie(PORTAL_COOKIE, path="/")


@router.post("/recuperar")
def recuperar(data: CorreoRequest):
    with get_connection() as conn, conn.cursor() as cur:
        pc.recuperar(cur, data.email)
        conn.commit()
    return _ENVIADO


@router.post("/recuperar/confirmar")
def cambiar_clave(data: CambiarClavePortalRequest):
    with get_connection() as conn, conn.cursor() as cur:
        pc.cambiar_clave_con_codigo(cur, data.email, data.codigo, data.password)
        conn.commit()
    return {"ok": True}
