"""Sacar despachos de su ruta sin entregarlos: vuelven a "Aprobado", sin
ruta, listos para otro viaje. Lo usan el reverso de la ruta entera y el de un
despacho (el coordinador, ver app/api/rutas.py y app/api/despachos.py) y el
"No se pudo entregar" del repartidor en la calle.

Lo entregado no se toca: un despacho ENTREGADO sigue en su ruta con sus
marcas. Cada despacho liberado deja una fila en DespachoReverso con quien,
cuando, por que y desde donde: es su historial y la estadistica de cuantas
paradas no entrego cada repartidor (ver app/api/reportes.py)."""

from __future__ import annotations

import uuid

from fastapi import HTTPException
from psycopg.types.json import Jsonb

from app.core.fechas import ahora_utc

MOTIVO_MINIMO = 5
RUTAS_ACTIVAS = ("PLANIFICADA", "EN_TRANSITO")


def motivo_valido(motivo: str) -> str:
    motivo = motivo.strip()
    if len(motivo) < MOTIVO_MINIMO:
        raise HTTPException(400, "Escribe el motivo del reverso (queda registrado con tu nombre)")
    return motivo


def ruta_activa_bloqueada(cur, ruta_id: str) -> dict:
    """La ruta, bloqueada (FOR UPDATE) para que el repartidor no marque una
    llegada o una entrega justo mientras se reversa. Solo rutas activas."""
    cur.execute('SELECT * FROM "Ruta" WHERE "id" = %s FOR UPDATE', (ruta_id,))
    ruta = cur.fetchone()
    if not ruta:
        raise HTTPException(404, "Ruta no encontrada")
    if ruta["estado"] not in RUTAS_ACTIVAS:
        raise HTTPException(
            400, f'La ruta {ruta["numero"]} ya esta {ruta["estado"].lower()}: solo se reversan rutas activas'
        )
    return ruta


def liberar(cur, ruta_id: str, despachos: list[dict], usuario_id: str, motivo: str, alcance: str) -> None:
    """Saca esos despachos (sin entregar) de la ruta y anota el reverso. La
    marca de llegada, si la tenian, pasa del despacho al reverso: en otro
    viaje se vuelve a marcar."""
    if any(d["estado"] == "ENTREGADO" for d in despachos):
        raise HTTPException(400, "Un despacho entregado no se puede reversar")
    ahora = ahora_utc()
    cur.executemany(
        'INSERT INTO "DespachoReverso" ("id", "despachoId", "rutaId", "usuarioId", "alcance", "motivo", '
        '"estadoAnterior", "llegadaEn", "fecha") VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)',
        [
            (f"rev-{uuid.uuid4().hex[:12]}", d["id"], ruta_id, usuario_id, alcance, motivo,
             d["estado"], d["llegadaEn"], ahora)
            for d in despachos
        ],
    )
    ids = [d["id"] for d in despachos]
    cur.execute(
        'UPDATE "Despacho" SET "estado" = \'APROBADO\', "rutaId" = NULL, "ordenEnRuta" = NULL, "llegadaEn" = NULL '
        'WHERE "id" = ANY(%s)',
        (ids,),
    )
    # El trazado de esta ruta ya no los marca como parada (si no, su mapa
    # seguiria mostrandolos aunque ahora vayan en otro viaje).
    cur.execute(
        'UPDATE "RutaPunto" SET "paradaDespachoId" = NULL WHERE "rutaId" = %s AND "paradaDespachoId" = ANY(%s)',
        (ruta_id, ids),
    )


def cancelar_ruta(cur, ruta: dict, usuario_id: str, motivo: str, liberados: list[dict], hubo_entregas: bool) -> None:
    """La ruta queda CANCELADA con quien, cuando y por que. Sin entregas, su
    trazado ya no sirve y se borra; con entregas se conserva, porque es el
    historial de lo que si se hizo."""
    cur.execute(
        'UPDATE "Ruta" SET "estado" = \'CANCELADA\', "canceladaEn" = %s, "canceladaPorId" = %s, '
        '"motivoCancelacion" = %s, "despachosAlCancelar" = %s WHERE "id" = %s',
        (ahora_utc(), usuario_id, motivo, Jsonb([d["numero"] for d in liberados]), ruta["id"]),
    )
    if not hubo_entregas:
        cur.execute('DELETE FROM "RutaPunto" WHERE "rutaId" = %s', (ruta["id"],))


def cerrar_ruta_si_corresponde(cur, ruta: dict, usuario_id: str, motivo: str, liberados: list[dict]) -> None:
    """Despues de sacar despachos sueltos: si la ruta se quedo sin despachos
    se cancela con ese motivo, y si estaba en camino y lo que le queda ya
    esta todo entregado, se completa (como al entregar la ultima parada)."""
    cur.execute('SELECT "estado" FROM "Despacho" WHERE "rutaId" = %s', (ruta["id"],))
    restantes = [d["estado"] for d in cur.fetchall()]
    if not restantes:
        cancelar_ruta(cur, ruta, usuario_id, motivo, liberados, hubo_entregas=False)
    elif ruta["estado"] == "EN_TRANSITO" and all(e == "ENTREGADO" for e in restantes):
        cur.execute(
            'UPDATE "Ruta" SET "estado" = \'COMPLETADA\', "completadaEn" = %s WHERE "id" = %s',
            (ahora_utc(), ruta["id"]),
        )
