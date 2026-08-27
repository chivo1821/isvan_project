"""Login/logout/sesion actual. Ver app/core/auth.py para el mecanismo de
sesion (cookie httpOnly + tabla Sesion)."""

from __future__ import annotations

from fastapi import APIRouter, Cookie, Depends, HTTPException, Response

from app.core.auth import (
    COOKIE_SECURE,
    SESSION_COOKIE_NAME,
    SESSION_TTL,
    crear_sesion,
    eliminar_sesion,
    get_current_user,
    verify_password,
)
from app.core.db import get_connection
from app.schemas import LoginRequest, Usuario

router = APIRouter(prefix="/auth", tags=["auth"])


def _set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=token,
        max_age=int(SESSION_TTL.total_seconds()),
        httponly=True,
        secure=COOKIE_SECURE,
        samesite="lax",
        path="/",
    )


@router.post("/login", response_model=Usuario)
def login(data: LoginRequest, response: Response):
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute('SELECT * FROM "Usuario" WHERE "email" = %s', (data.email,))
        usuario = cur.fetchone()
        if not usuario or not usuario["activo"] or not verify_password(data.password, usuario["passwordHash"]):
            raise HTTPException(401, "Correo o contraseña incorrectos")

        token = crear_sesion(cur, usuario["id"])
        conn.commit()

    _set_session_cookie(response, token)
    return usuario


@router.post("/logout", status_code=204)
def logout(response: Response, sesion_id: str | None = Cookie(default=None)):
    if sesion_id:
        with get_connection() as conn, conn.cursor() as cur:
            eliminar_sesion(cur, sesion_id)
            conn.commit()
    response.delete_cookie(SESSION_COOKIE_NAME, path="/")


@router.get("/me", response_model=Usuario)
def me(usuario: dict = Depends(get_current_user)):
    return usuario
