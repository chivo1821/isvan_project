"""Bitacora del sistema administrativo: quien hizo que, cuando, y el antes y
el despues. Solo se agregan filas (un trigger rechaza UPDATE y DELETE, ver
la migracion 20261106120000). Va en la misma transaccion que el cambio: si
el cambio se deshace, su registro tambien."""

from __future__ import annotations

import json
from datetime import date, datetime
from decimal import Decimal

from psycopg.types.json import Jsonb


def _a_json(valor):
    if valor is None:
        return None

    def convertir(v):
        if isinstance(v, Decimal):
            return float(v)
        if isinstance(v, (datetime, date)):
            return v.isoformat()
        raise TypeError(type(v).__name__)

    return Jsonb(json.loads(json.dumps(valor, default=convertir)))


def registrar(
    cur,
    usuario_id: str | None,
    entidad: str,
    entidad_id: str,
    accion: str,
    antes: dict | None = None,
    despues: dict | None = None,
    organizacion_id: str = "org-principal",
) -> None:
    cur.execute(
        'INSERT INTO "Bitacora" ("organizacionId", "usuarioId", "entidad", "entidadId", "accion", "antes", "despues") '
        "VALUES (%s, %s, %s, %s, %s, %s, %s)",
        (organizacion_id, usuario_id, entidad, str(entidad_id), accion, _a_json(antes), _a_json(despues)),
    )


def de(cur, entidad: str, entidad_id: str) -> list[dict]:
    cur.execute(
        'SELECT b."id", b."fecha" AT TIME ZONE \'UTC\' AS "fecha", b."accion", b."antes", b."despues", '
        'u."nombre" AS "usuario" FROM "Bitacora" b LEFT JOIN "Usuario" u ON u."id" = b."usuarioId" '
        'WHERE b."entidad" = %s AND b."entidadId" = %s ORDER BY b."id" DESC LIMIT 200',
        (entidad, str(entidad_id)),
    )
    return cur.fetchall()
