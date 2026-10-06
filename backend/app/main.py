"""FastAPI app — API real de Gestion Logistica (ver docs/PLAN.md)."""

from __future__ import annotations

import logging
import os

import psycopg
from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

# INFO para que se vean los logs de app.services.route_analysis al llamar al
# servicio de SuperMap iServer (URL consultada, cuantos puntos devolvio, o el
# motivo exacto de por que cayo al fallback mock) en la consola de uvicorn.
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

from app.api import (
    almacenes,
    auth,
    censo,
    clientes,
    delivery,
    despachos,
    historial,
    indicadores,
    reportes,
    rutas,
    usuarios,
    vehiculos,
    vendedor,
)
from app.core.auth import get_current_user
from app.core.permisos import sin_acceso_vendedor

app = FastAPI(title="Gestion Logistica API")

# Los formularios/acciones del frontend (Client Components) llaman la API
# directo desde el navegador -> hace falta CORS. ALLOWED_ORIGINS (.env) es una
# lista separada por comas de los origenes del frontend permitidos (ej. la
# URL de produccion en Vercel); si no esta definida, solo se permite
# localhost:3000 (dev local).
_allowed_origins_env = os.environ.get("ALLOWED_ORIGINS", "")
ALLOWED_ORIGINS = [o.strip() for o in _allowed_origins_env.split(",") if o.strip()] or ["http://localhost:3000"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    # La cookie de sesion (ver app/core/auth.py) viaja en llamadas
    # cross-origin (frontend en :3000, backend en :8000 en dev) — sin esto
    # el navegador no la manda ni el backend la deja pasar. Solo funciona
    # con una lista explicita de origenes (no "*"), que es lo que ya usamos.
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def cabeceras_de_seguridad(request: Request, call_next):
    """Cabeceras que pidio el escaneo de OWASP ZAP: que el navegador no
    adivine el tipo de una respuesta (nosniff) y que otro sitio no pueda
    incrustar las respuestas de la API (CORP). same-site, no same-origin: en
    desarrollo el frontend (:3000) y la API (:8000) son el mismo sitio, pero
    no el mismo origen."""
    respuesta = await call_next(request)
    respuesta.headers.setdefault("X-Content-Type-Options", "nosniff")
    respuesta.headers.setdefault("Cross-Origin-Resource-Policy", "same-site")
    return respuesta


_log = logging.getLogger("app.errores")


@app.exception_handler(psycopg.errors.ForeignKeyViolation)
async def referencia_inexistente(request: Request, exc: psycopg.errors.ForeignKeyViolation):
    """Un id que no existe (cliente, usuario, vehiculo...): es un dato mal
    enviado, no una falla del servidor."""
    _log.warning("Referencia inexistente en %s %s: %s", request.method, request.url.path, exc)
    return JSONResponse(status_code=422, content={"detail": "Hace referencia a un registro que no existe"})


@app.exception_handler(psycopg.errors.UniqueViolation)
async def registro_duplicado(request: Request, exc: psycopg.errors.UniqueViolation):
    """Un valor que tiene que ser unico y ya existe (una placa, un numero...)."""
    _log.warning("Duplicado en %s %s: %s", request.method, request.url.path, exc)
    return JSONResponse(status_code=409, content={"detail": "Ya existe un registro con ese valor"})


@app.exception_handler(psycopg.DataError)
async def dato_invalido(request: Request, exc: psycopg.DataError):
    """Un dato que Postgres no puede guardar ni comparar: un caracter nulo
    (%00) en un texto, un valor fuera de rango... Antes era un 500. Queda en
    el log por si algun dia es un error nuestro y no del que llama."""
    _log.warning("Dato invalido en %s %s: %s", request.method, request.url.path, exc)
    return JSONResponse(status_code=422, content={"detail": "Hay un dato con un formato que no es valido"})

# auth.router se deja sin la dependencia global de sesion (login/logout no
# la requieren; GET /auth/me exige sesion por su cuenta). Todos los demas
# routers exigen una sesion valida en cada endpoint.
ROUTERS_PUBLICOS = [auth.router]
ROUTERS_PROTEGIDOS = [
    almacenes.router,
    censo.router,
    clientes.router,
    usuarios.router,
    vehiculos.router,
    despachos.router,
    rutas.router,
    reportes.router,
    delivery.router,
    historial.router,
    indicadores.router,
    vendedor.router,
]

# Los unicos routers a los que entra un VENDEDOR: el suyo, usuarios (su
# propia ficha y su clave; lo demas de ese router es de ADMIN) y el censo
# (lo llena el; la revision es de ADMIN, endpoint por endpoint). El resto de
# la operacion se le cierra aca, de una sola vez, en vez de endpoint por
# endpoint (ver sin_acceso_vendedor en app/core/permisos.py).
ROUTERS_DEL_VENDEDOR = [usuarios.router, vendedor.router, censo.router]

# En Vercel, backend y frontend quedan bajo el mismo dominio (vercel.json:
# services + rewrites), con /api/backend/* -> este servicio. No hay forma de
# confirmar sin desplegar si Vercel reenvia la ruta completa
# (/api/backend/despachos) o la recorta antes de reenviarla (/despachos), asi
# que cada router queda registrado en ambas variantes -- funciona sin
# importar cual de las dos use, y no rompe el desarrollo local (donde el
# frontend llama directo a localhost:8000 sin prefijo).
for _router in ROUTERS_PUBLICOS:
    app.include_router(_router)
    app.include_router(_router, prefix="/api/backend")

for _router in ROUTERS_PROTEGIDOS:
    _dependencias = [Depends(get_current_user)]
    if _router not in ROUTERS_DEL_VENDEDOR:
        _dependencias.append(Depends(sin_acceso_vendedor))
    app.include_router(_router, dependencies=_dependencias)
    app.include_router(_router, prefix="/api/backend", dependencies=_dependencias)


@app.get("/")
def root():
    return {"status": "ok", "docs": "/docs"}
