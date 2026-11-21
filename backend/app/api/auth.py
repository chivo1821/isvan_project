"""Login/logout/sesion actual. Ver app/core/auth.py para el mecanismo de
sesion (cookie httpOnly + tabla Sesion; la app de campo usa la misma tabla
con un token Bearer)."""

from __future__ import annotations

from datetime import timedelta

from fastapi import APIRouter, Cookie, Depends, Header, HTTPException, Response

from app.core.auth import (
    COOKIE_SECURE,
    ORIGEN_MOVIL,
    SESSION_COOKIE_NAME,
    SESSION_TTL,
    SESSION_TTL_MOVIL,
    comparar_sin_cuenta,
    crear_sesion,
    eliminar_sesion,
    get_current_user,
    token_de_la_peticion,
    verify_password,
)
from app.core.db import get_connection
from app.core.fechas import ahora_utc
from app.schemas import (
    LoginMotorizadoMovilRequest,
    LoginMotorizadoRequest,
    LoginMovilRequest,
    LoginRequest,
    RegistroMotorizadoMovilRequest,
    RegistroMotorizadoRequest,
    SesionMovil,
    Usuario,
)
from app.services import motorizados

router = APIRouter(prefix="/auth", tags=["auth"])

# Igual que el portal y los motorizados: tras INTENTOS_MAXIMOS claves
# erradas seguidas la cuenta queda bloqueada MINUTOS_BLOQUEO, para que nadie
# pueda probar claves sin parar contra un correo.
INTENTOS_MAXIMOS = 5
MINUTOS_BLOQUEO = 15
_MENSAJE_GENERICO = "Correo o contraseña incorrectos"

# La app de campo es para quien trabaja en la calle; la oficina usa la web.
ROLES_APP_MOVIL = frozenset({"REPARTIDOR", "VENDEDOR"})


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


def _autenticar_por_correo(conn, cur, email: str, password: str) -> dict:
    """El usuario si el correo y la clave son correctos, con el bloqueo por
    intentos y el tiempo parejo cuando el correo no existe."""
    # El email ya viene normalizado (ver Correo en schemas.py); se normaliza
    # tambien el guardado para que sigan entrando los usuarios creados antes
    # de esto con alguna mayuscula o espacio.
    cur.execute('SELECT * FROM "Usuario" WHERE lower(trim("email")) = %s FOR UPDATE', (email,))
    usuario = cur.fetchone()
    if not usuario:
        comparar_sin_cuenta()
        raise HTTPException(401, _MENSAJE_GENERICO)

    ahora = ahora_utc()
    if usuario["bloqueadoHasta"] and usuario["bloqueadoHasta"] > ahora:
        minutos = max(1, int((usuario["bloqueadoHasta"] - ahora).total_seconds() // 60) + 1)
        raise HTTPException(429, f"Demasiados intentos fallidos. Intenta de nuevo en {minutos} minuto(s).")

    if not verify_password(password, usuario["passwordHash"]):
        intentos = usuario["intentosFallidos"] + 1
        bloqueo = ahora + timedelta(minutes=MINUTOS_BLOQUEO) if intentos >= INTENTOS_MAXIMOS else None
        cur.execute(
            'UPDATE "Usuario" SET "intentosFallidos" = %s, "bloqueadoHasta" = %s WHERE "id" = %s',
            (0 if bloqueo else intentos, bloqueo, usuario["id"]),
        )
        # El intento queda contado aunque la respuesta sea un error.
        conn.commit()
        raise HTTPException(401, _MENSAJE_GENERICO)

    cur.execute(
        'UPDATE "Usuario" SET "intentosFallidos" = 0, "bloqueadoHasta" = NULL WHERE "id" = %s', (usuario["id"],)
    )
    # Un usuario dado de baja recibe el mismo mensaje: no se revela que la
    # cuenta existe.
    if not usuario["activo"]:
        conn.commit()
        raise HTTPException(401, _MENSAJE_GENERICO)
    return usuario


@router.post("/login", response_model=Usuario)
def login(data: LoginRequest, response: Response):
    with get_connection() as conn, conn.cursor() as cur:
        usuario = _autenticar_por_correo(conn, cur, data.email, data.password)
        token = crear_sesion(cur, usuario["id"])
        conn.commit()

    _set_session_cookie(response, token)
    return usuario


# ---------- Motorizados: se registran solos y entran con placa + PIN ----------
# (ver app/services/motorizados.py)


@router.post("/motorizado/registro", response_model=Usuario, status_code=201)
def registrar_motorizado(data: RegistroMotorizadoRequest, response: Response):
    """Publico, pero exige el codigo de registro de la empresa. Crea al
    motorizado con su moto y lo deja con la sesion iniciada."""
    with get_connection() as conn, conn.cursor() as cur:
        usuario = motorizados.registrar(
            cur, codigo=data.codigoRegistro, nombre=data.nombre, placa=data.placa, telefono=data.telefono, pin=data.pin
        )
        token = crear_sesion(cur, usuario["id"])
        conn.commit()
    _set_session_cookie(response, token)
    return usuario


@router.post("/motorizado/login", response_model=Usuario)
def login_motorizado(data: LoginMotorizadoRequest, response: Response):
    with get_connection() as conn, conn.cursor() as cur:
        usuario = motorizados.autenticar(cur, data.placa, data.pin)
        token = crear_sesion(cur, usuario["id"])
        conn.commit()
    _set_session_cookie(response, token)
    return usuario


# ---------- App de campo: el token va en la respuesta, no en una cookie ----------


def _sesion_movil(conn, cur, usuario: dict, dispositivo: str | None) -> dict:
    if usuario["rol"] not in ROLES_APP_MOVIL:
        # La clave era correcta: se puede decir por que no entra.
        conn.commit()
        raise HTTPException(403, "Esta app es para despachadores y vendedores. Entra desde la página web.")
    token = crear_sesion(cur, usuario["id"], origen=ORIGEN_MOVIL, dispositivo=dispositivo)
    conn.commit()
    return {"token": token, "usuario": usuario, "expiraEn": ahora_utc() + SESSION_TTL_MOVIL}


@router.post("/movil/login", response_model=SesionMovil)
def login_movil(data: LoginMovilRequest):
    with get_connection() as conn, conn.cursor() as cur:
        usuario = _autenticar_por_correo(conn, cur, data.email, data.password)
        return _sesion_movil(conn, cur, usuario, data.dispositivo)


@router.post("/movil/motorizado/login", response_model=SesionMovil)
def login_movil_motorizado(data: LoginMotorizadoMovilRequest):
    with get_connection() as conn, conn.cursor() as cur:
        usuario = motorizados.autenticar(cur, data.placa, data.pin)
        return _sesion_movil(conn, cur, usuario, data.dispositivo)


@router.post("/movil/motorizado/registro", response_model=SesionMovil, status_code=201)
def registro_movil_motorizado(data: RegistroMotorizadoMovilRequest):
    with get_connection() as conn, conn.cursor() as cur:
        usuario = motorizados.registrar(
            cur, codigo=data.codigoRegistro, nombre=data.nombre, placa=data.placa, telefono=data.telefono, pin=data.pin
        )
        return _sesion_movil(conn, cur, usuario, data.dispositivo)


@router.post("/logout", status_code=204)
def logout(
    response: Response,
    sesion_id: str | None = Cookie(default=None),
    authorization: str | None = Header(default=None),
):
    token = token_de_la_peticion(sesion_id, authorization)
    if token:
        with get_connection() as conn, conn.cursor() as cur:
            eliminar_sesion(cur, token)
            conn.commit()
    response.delete_cookie(SESSION_COOKIE_NAME, path="/")


@router.get("/me", response_model=Usuario)
def me(usuario: dict = Depends(get_current_user)):
    return usuario
