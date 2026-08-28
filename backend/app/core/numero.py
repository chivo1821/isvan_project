"""Genera el siguiente numero secuencial (V-0001, D-0001, F-01001) por
prefijo. Simple (MAX + 1), no pensado para escrituras concurrentes — es una
demo de un solo usuario, no un sistema multiusuario real.
"""

from __future__ import annotations

import psycopg


def _proximo_correlativo(cur: psycopg.Cursor, tabla: str, prefijo: str) -> int:
    cur.execute(f'SELECT "numero" FROM "{tabla}" WHERE "numero" LIKE %s ORDER BY "numero" DESC LIMIT 1', (f"{prefijo}-%",))
    row = cur.fetchone()
    if not row:
        return 1
    return int(row["numero"].split("-")[-1]) + 1


def siguiente_numero(cur: psycopg.Cursor, tabla: str, prefijo: str, ancho: int) -> str:
    siguiente = _proximo_correlativo(cur, tabla, prefijo)
    return f"{prefijo}-{str(siguiente).zfill(ancho)}"


def siguientes_numeros(cur: psycopg.Cursor, tabla: str, prefijo: str, ancho: int, cantidad: int) -> list[str]:
    """Version en lote: consulta el maximo una sola vez y genera N
    correlativos en memoria, en vez de una consulta por cada numero. Con la
    base en otra region (Neon) cada round-trip pesa, y una importacion de
    Excel puede crear cientos de despachos de una vez."""
    inicio = _proximo_correlativo(cur, tabla, prefijo)
    return [f"{prefijo}-{str(inicio + i).zfill(ancho)}" for i in range(cantidad)]
