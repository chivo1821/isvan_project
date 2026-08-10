"""Genera el siguiente numero secuencial (V-0001, D-0001, F-01001) por
prefijo. Simple (MAX + 1), no pensado para escrituras concurrentes — es una
demo de un solo usuario, no un sistema multiusuario real.
"""

from __future__ import annotations

import psycopg


def siguiente_numero(cur: psycopg.Cursor, tabla: str, prefijo: str, ancho: int) -> str:
    cur.execute(f'SELECT "numero" FROM "{tabla}" WHERE "numero" LIKE %s ORDER BY "numero" DESC LIMIT 1', (f"{prefijo}-%",))
    row = cur.fetchone()
    if not row:
        siguiente = 1
    else:
        ultimo = row["numero"]
        siguiente = int(ultimo.split("-")[-1]) + 1
    return f"{prefijo}-{str(siguiente).zfill(ancho)}"
