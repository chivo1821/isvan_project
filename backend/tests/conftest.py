"""Base de las pruebas: una base de datos desechable creada desde cero con
las migraciones de prisma/migrations (en orden), y una API de prueba.

Necesita un Postgres con PostGIS y pgRouting. Por defecto toma el servidor
de DATABASE_URL del .env, que debe ser local (localhost o 127.0.0.1); en CI
se pasa PRUEBAS_POSTGRES_URL. Nunca corre contra otra cosa: lo comprueba antes
de crear nada.

    cd backend && .venv/Scripts/python.exe -m pytest tests
"""

from __future__ import annotations

import os
import re
import uuid
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

import psycopg
import pytest

RAIZ = Path(__file__).resolve().parents[2]
MIGRACIONES = RAIZ / "prisma" / "migrations"
HOSTS_LOCALES = {"localhost", "127.0.0.1", "::1", "postgres"}


def _servidor() -> str:
    """URL del servidor (sin base) donde se crea la base desechable."""
    url = os.environ.get("PRUEBAS_POSTGRES_URL")
    if not url:
        env = (RAIZ / ".env").read_text(encoding="utf-8") if (RAIZ / ".env").exists() else ""
        m = re.search(r'^DATABASE_URL="?([^"\s]+)', env, re.M)
        if not m:
            pytest.exit("Falta PRUEBAS_POSTGRES_URL o un DATABASE_URL local en el .env", 2)
        url = m[1]
    partes = urlsplit(url)
    if partes.hostname not in HOSTS_LOCALES:
        pytest.exit(f"Las pruebas solo corren contra un Postgres local, no contra {partes.hostname}", 2)
    return urlunsplit(partes._replace(path="", query=""))


def _aplicar_migraciones(url: str) -> None:
    carpetas = sorted(p for p in MIGRACIONES.iterdir() if (p / "migration.sql").exists())
    with psycopg.connect(url, autocommit=True) as conn:
        for carpeta in carpetas:
            conn.execute((carpeta / "migration.sql").read_text(encoding="utf-8"))


@pytest.fixture(scope="session")
def base_url():
    """Crea la base, aplica todas las migraciones y la borra al final."""
    servidor = _servidor()
    nombre = f"gl_pruebas_{uuid.uuid4().hex[:8]}"
    with psycopg.connect(f"{servidor}/postgres", autocommit=True) as conn:
        conn.execute(f'CREATE DATABASE "{nombre}"')
    url = f"{servidor}/{nombre}"
    try:
        _aplicar_migraciones(url)
        os.environ["DATABASE_URL"] = url
        yield url
    finally:
        with psycopg.connect(f"{servidor}/postgres", autocommit=True) as conn:
            conn.execute(f'DROP DATABASE IF EXISTS "{nombre}" WITH (FORCE)')


@pytest.fixture(scope="session")
def app(base_url):
    from app.main import app as aplicacion

    return aplicacion


@pytest.fixture()
def db(base_url):
    from psycopg.rows import dict_row

    with psycopg.connect(base_url, row_factory=dict_row) as conn:
        yield conn


@pytest.fixture()
def usuario(db):
    """Crea usuarios de prueba: usuario(rol="ADMIN") -> dict con id, email y clave."""
    from app.core.auth import hash_password

    def crear(rol: str = "ADMIN", clave: str = "clave-de-prueba") -> dict:
        uid = f"usr-{uuid.uuid4().hex[:10]}"
        email = f"{uid}@pruebas.test"
        db.execute(
            'INSERT INTO "Usuario" ("id", "nombre", "email", "passwordHash", "rol") VALUES (%s, %s, %s, %s, %s)',
            (uid, f"Prueba {rol}", email, hash_password(clave), rol),
        )
        db.commit()
        return {"id": uid, "email": email, "clave": clave, "rol": rol}

    return crear


@pytest.fixture()
def cliente_api(app, db):
    """Un TestClient con sesión: cliente_api(usuario) -> TestClient."""
    from fastapi.testclient import TestClient

    from app.core.auth import crear_sesion

    def crear(u: dict | None = None) -> TestClient:
        c = TestClient(app)
        if u:
            with db.cursor() as cur:
                c.cookies.set("sesion_id", crear_sesion(cur, u["id"]))
            db.commit()
        return c

    return crear
