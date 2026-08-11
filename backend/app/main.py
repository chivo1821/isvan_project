"""FastAPI app — API real de Gestion Logistica (ver docs/PLAN.md)."""

from __future__ import annotations

import logging

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
# directo desde el navegador -> hace falta CORS. Solo localhost:3000 (dev).
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(tasa_cambio.router)
app.include_router(productos.router)
app.include_router(almacenes.router)
app.include_router(clientes.router)
app.include_router(usuarios.router)
app.include_router(vehiculos.router)
app.include_router(ventas.router)
app.include_router(despachos.router)
app.include_router(historial.router)


@app.get("/")
def root():
    return {"status": "ok", "docs": "/docs"}
