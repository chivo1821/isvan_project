"""Cola de tareas en Postgres (tabla Tarea), sin Redis.

- encolar(): dentro de la transaccion del cambio que la origina (si el
  cambio se deshace, la tarea tambien). Con clave_unica no se encola dos
  veces lo mismo.
- procesar(): toma de a una con FOR UPDATE SKIP LOCKED (varios procesos a la
  vez no toman la misma), la ejecuta en su propia transaccion y, si falla,
  la reintenta mas tarde (1, 2, 4, 8... minutos) hasta maxIntentos.

La llaman: la propia API despues de responder (BackgroundTasks, para que la
emision salga enseguida), el endpoint /tareas/procesar (cron) y, en los
contenedores, el servicio "tareas" cada minuto. En Vercel Hobby los crons son
diarios: ahi lo inmediato depende de la llamada en segundo plano.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from datetime import timedelta

from psycopg.types.json import Jsonb

from app.core.db import get_connection
from app.core.fechas import ahora_utc

log = logging.getLogger(__name__)

# tipo -> funcion(cur, datos). Los modulos registran las suyas al importarse.
MANEJADORES: dict[str, Callable] = {}


def manejador(tipo: str):
    def registrar(funcion):
        MANEJADORES[tipo] = funcion
        return funcion

    return registrar


def encolar(cur, tipo: str, datos: dict, clave_unica: str | None = None, organizacion_id: str = "org-principal") -> None:
    cur.execute(
        'INSERT INTO "Tarea" ("id", "organizacionId", "tipo", "datos", "claveUnica") '
        "VALUES ('tar-' || substr(md5(random()::text || clock_timestamp()::text), 1, 16), %s, %s, %s, %s) "
        'ON CONFLICT ("claveUnica") DO NOTHING',
        (organizacion_id, tipo, Jsonb(datos), clave_unica),
    )


def _tomar(cur):
    cur.execute(
        'SELECT * FROM "Tarea" WHERE "estado" = \'PENDIENTE\' AND "ejecutarDesde" <= %s '
        'ORDER BY "creadaEn" LIMIT 1 FOR UPDATE SKIP LOCKED',
        (ahora_utc(),),
    )
    return cur.fetchone()


def procesar(limite: int = 20) -> dict:
    """Ejecuta hasta `limite` tareas pendientes. Devuelve el conteo."""
    hechas = fallidas = 0
    for _ in range(limite):
        with get_connection() as conn, conn.cursor() as cur:
            tarea = _tomar(cur)
            if not tarea:
                break
            funcion = MANEJADORES.get(tarea["tipo"])
            try:
                if not funcion:
                    raise RuntimeError(f"No hay manejador para la tarea {tarea['tipo']}")
                with conn.transaction():
                    funcion(cur, tarea["datos"])
                cur.execute(
                    'UPDATE "Tarea" SET "estado" = \'HECHA\', "intentos" = "intentos" + 1, "terminadaEn" = %s, '
                    '"ultimoError" = NULL WHERE "id" = %s',
                    (ahora_utc(), tarea["id"]),
                )
                hechas += 1
            except Exception as e:  # noqa: BLE001 - cualquier falla se reintenta
                intentos = tarea["intentos"] + 1
                agotada = intentos >= tarea["maxIntentos"]
                log.warning("Tarea %s (%s) fallo: %s", tarea["id"], tarea["tipo"], e)
                cur.execute(
                    'UPDATE "Tarea" SET "estado" = %s, "intentos" = %s, "ultimoError" = %s, "ejecutarDesde" = %s '
                    'WHERE "id" = %s',
                    (
                        "FALLIDA" if agotada else "PENDIENTE",
                        intentos,
                        str(e)[:1000],
                        ahora_utc() + timedelta(minutes=2 ** (intentos - 1)),
                        tarea["id"],
                    ),
                )
                fallidas += 1
            conn.commit()
    return {"hechas": hechas, "fallidas": fallidas}
