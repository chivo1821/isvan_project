"""Jornada de campo y ubicacion en vivo (app movil, pedido del cliente
2026-11-10).

El repartidor pulsa «Iniciar jornada» en la app y, hasta «Terminar
jornada», la app manda su ubicacion en segundo plano: un punto cada
SEGUNDOS_ENTRE_PUNTOS (o cada METROS_ENTRE_PUNTOS si se mueve) en lotes cada
SEGUNDOS_ENTRE_ENVIOS. Sin senal los guarda y los manda despues.

La hora de cada punto es la del telefono, que puede estar corrida (el mismo
problema del censo): el lote trae tambien la hora del telefono al enviarlo,
y la diferencia contra el reloj del servidor se le corrige a cada punto.

Volumen: ~120 puntos por hora y repartidor; con 10 repartidores son unas 12
mil filas al dia (~2 MB). Se guardan DIAS_DE_POSICIONES dias.
"""

from __future__ import annotations

from datetime import datetime, timedelta

from fastapi import HTTPException

from app.core.fechas import ahora_utc

SEGUNDOS_ENTRE_PUNTOS = 30
METROS_ENTRE_PUNTOS = 50
SEGUNDOS_ENTRE_ENVIOS = 90
# Una jornada que nadie cierra (el telefono se apago, se olvido) se cierra
# sola: si no, el mapa mostraria para siempre a alguien "trabajando".
HORAS_MAXIMAS_JORNADA = 16
DIAS_DE_POSICIONES = 60
# Puntos que llegan despues del cierre (la cola sin senal) se aceptan si se
# tomaron antes de cerrar, con este margen.
MARGEN_CIERRE = timedelta(minutes=2)
# Un punto "del futuro" (desfase mal medido) se deja en la hora del servidor.
MARGEN_FUTURO = timedelta(minutes=1)


def intervalos() -> dict:
    return {
        "segundosEntrePuntos": SEGUNDOS_ENTRE_PUNTOS,
        "metrosEntrePuntos": METROS_ENTRE_PUNTOS,
        "segundosEntreEnvios": SEGUNDOS_ENTRE_ENVIOS,
    }


def cerrar_vencidas(cur, usuario_id: str | None = None) -> int:
    """Cierra las jornadas abiertas hace mas de HORAS_MAXIMAS_JORNADA, en la
    hora de su ultimo punto (o en el tope, si no mando ninguno)."""
    tope = timedelta(hours=HORAS_MAXIMAS_JORNADA)
    condicion = 'j."terminadaEn" IS NULL AND j."iniciadaEn" < %s'
    params: list = [ahora_utc() - tope]
    if usuario_id:
        condicion += ' AND j."usuarioId" = %s'
        params.append(usuario_id)
    cur.execute(
        f'''UPDATE "Jornada" j SET "cierre" = 'AUTOMATICO', "terminadaEn" = LEAST(
                j."iniciadaEn" + %s::interval,
                COALESCE((SELECT MAX(p."tomadaEn") FROM "Posicion" p WHERE p."jornadaId" = j."id"),
                         j."iniciadaEn" + %s::interval))
            WHERE {condicion}''',
        [f"{HORAS_MAXIMAS_JORNADA} hours", f"{HORAS_MAXIMAS_JORNADA} hours", *params],
    )
    return cur.rowcount


def abierta(cur, usuario_id: str) -> dict | None:
    cerrar_vencidas(cur, usuario_id)
    cur.execute(
        'SELECT * FROM "Jornada" WHERE "usuarioId" = %s AND "terminadaEn" IS NULL ORDER BY "iniciadaEn" DESC LIMIT 1',
        (usuario_id,),
    )
    return cur.fetchone()


def iniciar(cur, usuario: dict) -> dict:
    """Idempotente: si ya hay una abierta (la app reintenta sin senal), es
    esa."""
    actual = abierta(cur, usuario["id"])
    if actual:
        return actual
    cur.execute(
        'INSERT INTO "Jornada" ("id", "usuarioId", "vehiculoId", "iniciadaEn") '
        "VALUES ('jor-' || substr(md5(random()::text || clock_timestamp()::text), 1, 16), %s, %s, %s) RETURNING *",
        (usuario["id"], usuario.get("vehiculoAsignadoId"), ahora_utc()),
    )
    return cur.fetchone()


def terminar(cur, usuario_id: str) -> dict | None:
    """Idempotente: sin jornada abierta no hace nada."""
    actual = abierta(cur, usuario_id)
    if not actual:
        return None
    cur.execute(
        'UPDATE "Jornada" SET "terminadaEn" = %s, "cierre" = \'MANUAL\' WHERE "id" = %s RETURNING *',
        (ahora_utc(), actual["id"]),
    )
    return cur.fetchone()


def _ruta_en_transito(cur, vehiculo_id: str | None) -> dict | None:
    if not vehiculo_id:
        return None
    cur.execute(
        'SELECT "id", "iniciadaEn" FROM "Ruta" WHERE %s IN ("vehiculoId", "vehiculoApoyoId") '
        "AND \"estado\" = 'EN_TRANSITO' ORDER BY \"iniciadaEn\" DESC LIMIT 1",
        (vehiculo_id,),
    )
    return cur.fetchone()


def guardar_lote(cur, usuario: dict, jornada_id: str, enviado_en_ms: int, puntos: list) -> dict:
    """Guarda un lote de puntos de la jornada. Reenviar el mismo lote no
    duplica (unico por usuario y hora). Devuelve cuantos llegaron, cuantos
    eran nuevos y si la jornada sigue abierta."""
    cur.execute('SELECT * FROM "Jornada" WHERE "id" = %s AND "usuarioId" = %s', (jornada_id, usuario["id"]))
    jornada = cur.fetchone()
    if not jornada:
        raise HTTPException(404, "Jornada no encontrada")

    ahora = ahora_utc()
    desfase = ahora - datetime(1970, 1, 1) - timedelta(milliseconds=enviado_en_ms)
    desde = jornada["iniciadaEn"] - MARGEN_CIERRE
    hasta = (jornada["terminadaEn"] + MARGEN_CIERRE) if jornada["terminadaEn"] else ahora + MARGEN_FUTURO
    ruta = _ruta_en_transito(cur, jornada["vehiculoId"] or usuario.get("vehiculoAsignadoId"))

    filas = []
    vistos = set()
    for p in puntos:
        tomada = datetime(1970, 1, 1) + timedelta(milliseconds=p.tomadaEnMs) + desfase
        # Un punto "del futuro" aun despues de corregir el reloj es un dato
        # malo: se descarta (ajustarlo a ahora lo colaba despues del cierre).
        if tomada > ahora + MARGEN_FUTURO or tomada < desde or tomada > hasta or p.tomadaEnMs in vistos:
            continue
        vistos.add(p.tomadaEnMs)
        ruta_id = ruta["id"] if ruta and ruta["iniciadaEn"] and tomada >= ruta["iniciadaEn"] else None
        filas.append((p.lat, p.lng, p.precisionM, p.velocidad, p.rumbo, p.bateria, tomada, ruta_id, p.tomadaEnMs))

    nuevos = 0
    if filas:
        columnas = list(zip(*filas))
        cur.execute(
            'INSERT INTO "Posicion" ("usuarioId", "jornadaId", "lat", "lng", "precisionM", "velocidad", "rumbo", '
            '"bateria", "tomadaEn", "rutaId", "tomadaTelefonoMs") '
            "SELECT %s, %s, * FROM unnest(%s::float8[], %s::float8[], %s::float8[], %s::float8[], %s::float8[], "
            "%s::float8[], %s::timestamp[], %s::text[], %s::bigint[]) "
            'ON CONFLICT ("usuarioId", "tomadaTelefonoMs") DO NOTHING RETURNING 1',
            (usuario["id"], jornada_id, *[list(c) for c in columnas]),
        )
        nuevos = len(cur.fetchall())
        ultimo = max(filas, key=lambda f: f[6])
        cur.execute(
            'INSERT INTO "UltimaPosicion" ("usuarioId", "jornadaId", "rutaId", "lat", "lng", "precisionM", '
            '"velocidad", "rumbo", "bateria", "tomadaEn", "recibidaEn") '
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) "
            'ON CONFLICT ("usuarioId") DO UPDATE SET "jornadaId" = EXCLUDED."jornadaId", "rutaId" = EXCLUDED."rutaId", '
            '"lat" = EXCLUDED."lat", "lng" = EXCLUDED."lng", "precisionM" = EXCLUDED."precisionM", '
            '"velocidad" = EXCLUDED."velocidad", "rumbo" = EXCLUDED."rumbo", "bateria" = EXCLUDED."bateria", '
            '"tomadaEn" = EXCLUDED."tomadaEn", "recibidaEn" = EXCLUDED."recibidaEn" '
            'WHERE "UltimaPosicion"."tomadaEn" < EXCLUDED."tomadaEn"',
            (usuario["id"], jornada_id, ultimo[7], ultimo[0], ultimo[1], ultimo[2], ultimo[3], ultimo[4], ultimo[5],
             ultimo[6], ahora),
        )
    return {"recibidos": len(puntos), "nuevos": nuevos, "jornadaAbierta": jornada["terminadaEn"] is None}


def limpiar_viejas(cur) -> int:
    """Lo de la tarea diaria: cierra las jornadas vencidas y borra los puntos
    de mas de DIAS_DE_POSICIONES dias."""
    cerrar_vencidas(cur)
    cur.execute(
        'DELETE FROM "Posicion" WHERE "tomadaEn" < %s', (ahora_utc() - timedelta(days=DIAS_DE_POSICIONES),)
    )
    return cur.rowcount
