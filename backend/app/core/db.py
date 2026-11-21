"""Conexion a Postgres via psycopg (mismo patron que jobs/sync_tasa_bcv.py).

Sin ORM: cada endpoint hace SQL directo contra las tablas que
prisma/schema.prisma ya creo via "migrate". Ver la nota junto al
"generator client" en ese archivo sobre por que no se uso prisma-client-py.

Las conexiones se reutilizan (pool). Antes cada llamada a la API abria dos
conexiones nuevas a Neon (una para revisar la sesion y otra para la
consulta) y las cerraba al terminar: el cifrado TLS y la autenticacion de
cada conexion eran buena parte de la CPU que Vercel cobra (aviso del plan
gratis, 2026-11-12/16). En Vercel la misma instancia atiende muchas
llamadas seguidas, asi que el pool sobrevive entre ellas.
"""

from __future__ import annotations

import os
import threading
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

import psycopg
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool
from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parents[3]
load_dotenv(PROJECT_ROOT / ".env")

# Pocas: las llamadas son cortas y el plan gratis de Neon admite pocas
# conexiones. Una conexion sin usar se cierra al minuto, asi el pool no
# mantiene despierta la base (Neon la suspende cuando nadie la usa).
POOL_MAXIMO = 8
POOL_SEGUNDOS_OCIOSA = 60
POOL_ESPERA_SEGUNDOS = 20

_pools: dict[str, ConnectionPool] = {}
_candado = threading.Lock()


def _database_url() -> str:
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL no esta definido (revisa el .env en la raiz del proyecto)")
    return url


def _restablecer(conn: psycopg.Connection) -> None:
    """Al volver al pool, la conexion queda como recien abierta: si alguien
    la paso a autocommit (VACUUM en scripts/cargar_red_vial.py), el
    siguiente que la use no hereda ese modo."""
    if conn.autocommit:
        conn.autocommit = False


def _pool() -> ConnectionPool:
    """Un pool por DATABASE_URL: las pruebas cambian la base en caliente."""
    url = _database_url()
    pool = _pools.get(url)
    if pool is None:
        with _candado:
            pool = _pools.get(url)
            if pool is None:
                pool = ConnectionPool(
                    url,
                    min_size=0,
                    max_size=POOL_MAXIMO,
                    max_idle=POOL_SEGUNDOS_OCIOSA,
                    timeout=POOL_ESPERA_SEGUNDOS,
                    # Antes de entregar una conexion, revisa que siga viva: Neon
                    # la corta al suspenderse y Vercel congela la instancia
                    # entre llamadas.
                    check=ConnectionPool.check_connection,
                    reset=_restablecer,
                    # Sin sentencias preparadas del lado del servidor: si algun
                    # dia la URL pasa por el pooler de Neon (PgBouncer), no se
                    # rompen.
                    kwargs={"row_factory": dict_row, "prepare_threshold": None},
                    name="api",
                    open=True,
                )
                _pools[url] = pool
    return pool


@contextmanager
def get_connection() -> Iterator[psycopg.Connection]:
    """Conexion con filas como dict (para que Pydantic las lea directo).

    Igual que antes: al salir sin error hace commit; con error, rollback. La
    conexion vuelve al pool en vez de cerrarse."""
    with _pool().connection() as conn:
        yield conn
