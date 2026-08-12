"""FastAPI app — API real de Gestion Logistica (ver docs/PLAN.md)."""

from __future__ import annotations

import logging
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# INFO para que se vean los logs de app.services.route_analysis al llamar al
# servicio de SuperMap iServer (URL consultada, cuantos puntos devolvio, o el
# motivo exacto de por que cayo al fallback mock) en la consola de uvicorn.
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

from app.api import (
    almacenes,
    clientes,
    despachos,
    historial,
    productos,
    tasa_cambio,
    usuarios,
    vehiculos,
    ventas,
)

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
    allow_methods=["*"],
    allow_headers=["*"],
)

ROUTERS = [
    tasa_cambio.router,
    productos.router,
    almacenes.router,
    clientes.router,
    usuarios.router,
    vehiculos.router,
    ventas.router,
    despachos.router,
    historial.router,
]

# En Vercel, backend y frontend quedan bajo el mismo dominio (vercel.json:
# services + rewrites), con /api/backend/* -> este servicio. No hay forma de
# confirmar sin desplegar si Vercel reenvia la ruta completa
# (/api/backend/despachos) o la recorta antes de reenviarla (/despachos), asi
# que cada router queda registrado en ambas variantes -- funciona sin
# importar cual de las dos use, y no rompe el desarrollo local (donde el
# frontend llama directo a localhost:8000 sin prefijo).
for _router in ROUTERS:
    app.include_router(_router)
    app.include_router(_router, prefix="/api/backend")


@app.get("/")
def root():
    return {"status": "ok", "docs": "/docs"}
