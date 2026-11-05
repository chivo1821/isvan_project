"""Numeracion de documentos del sistema administrativo (facturas, notas,
pedidos): sin saltos y sin choques entre usuarios.

Un solo UPDATE ... RETURNING toma el numero y deja la fila bloqueada hasta el
fin de la transaccion: dos emisiones a la vez se ponen en fila, y si la
transaccion que tomo un numero falla, el aumento tambien se deshace (no
queda un salto). Por eso se llama dentro de la misma transaccion que crea el
documento, nunca en una aparte.

core/numero.py (MAX + 1) sigue para despachos y rutas, que no son fiscales.
"""

from __future__ import annotations

TIPOS = {"FA", "NE", "NC", "ND", "PEDIDO"}


def siguiente(cur, empresa_id: str, tipo: str, serie: str = "") -> int:
    if tipo not in TIPOS:
        raise ValueError(f"Tipo de documento desconocido: {tipo}")
    cur.execute(
        'INSERT INTO "Correlativo" ("empresaId", "tipo", "serie", "siguiente") VALUES (%s, %s, %s, 2) '
        'ON CONFLICT ("empresaId", "tipo", "serie") DO UPDATE SET "siguiente" = "Correlativo"."siguiente" + 1 '
        'RETURNING "siguiente" - 1 AS "numero"',
        (empresa_id, tipo, serie),
    )
    return int(cur.fetchone()["numero"])


def formatear(tipo: str, numero: int, serie: str = "") -> str:
    """FA-00000123 (con la serie delante si la hay: A-FA-00000123)."""
    base = f"{tipo}-{numero:08d}"
    return f"{serie}-{base}" if serie else base
