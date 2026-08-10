"""Conexion a Postgres via psycopg (mismo patron que jobs/sync_tasa_bcv.py).

Sin ORM: cada endpoint hace SQL directo contra las tablas que
prisma/schema.prisma ya creo via "migrate". Ver la nota junto al
"generator client" en ese archivo sobre por que no se uso prisma-client-py.
"""

from __future__ import annotations

import os
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

import psycopg
from psycopg.rows import dict_row
from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parents[3]
load_dotenv(PROJECT_ROOT / ".env")


def _database_url() -> str:
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL no esta definido (revisa el .env en la raiz del proyecto)")
    return url


@contextmanager
def get_connection() -> Iterator[psycopg.Connection]:
    """Conexion con filas como dict (para que Pydantic las lea directo)."""
    with psycopg.connect(_database_url(), row_factory=dict_row) as conn:
        yield conn
