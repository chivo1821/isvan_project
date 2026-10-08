"""Tasa oficial BCV (Bs por USD), tomada de DolarApi.

DolarApi no es el BCV: lo replica. Por eso la tasa tambien se puede cargar a
mano (fuente MANUAL), y una carga manual nunca la pisa la automatica.

La tasa de una fecha es la de la fila mas reciente con fecha <= esa fecha:
los fines de semana y feriados no hay publicacion y vale la del ultimo dia
habil.
"""

from __future__ import annotations

import logging
from datetime import date, timedelta
from decimal import Decimal

import httpx

from app.core.fechas import ahora_utc, hoy_caracas

URL_ACTUAL = "https://ve.dolarapi.com/v1/dolares/oficial"
URL_HISTORICO = "https://ve.dolarapi.com/v1/historicos/dolares/oficial"
TIEMPO_MAXIMO = 10.0

# Si la tasa mas reciente guardada tiene mas de estos dias respecto de la
# fecha que se pide, se intenta actualizar antes de usarla.
DIAS_DESACTUALIZADA = 4

_log = logging.getLogger(__name__)


class TasaNoDisponible(Exception):
    pass


def _pedir(url: str):
    respuesta = httpx.get(url, timeout=TIEMPO_MAXIMO, headers={"Accept": "application/json"})
    respuesta.raise_for_status()
    return respuesta.json()


def _como_tasa(valor) -> Decimal | None:
    try:
        tasa = Decimal(str(valor))
    except (ArithmeticError, ValueError, TypeError):
        return None
    return tasa if tasa > 0 else None


def leer_dolarapi() -> list[tuple[date, Decimal]]:
    """Historico + la tasa de hoy, como (fecha, tasa). Lanza
    TasaNoDisponible si DolarApi no responde."""
    tasas: dict[date, Decimal] = {}
    try:
        for fila in _pedir(URL_HISTORICO):
            tasa = _como_tasa(fila.get("promedio"))
            if tasa and fila.get("fecha"):
                tasas[date.fromisoformat(fila["fecha"][:10])] = tasa
        actual = _pedir(URL_ACTUAL)
        tasa = _como_tasa(actual.get("promedio"))
        # "2026-10-08T00:00:00-04:00": la fecha valor, en hora de Caracas.
        if tasa and actual.get("fechaActualizacion"):
            tasas[date.fromisoformat(actual["fechaActualizacion"][:10])] = tasa
    except (httpx.HTTPError, ValueError) as e:
        raise TasaNoDisponible(f"DolarApi no respondio: {e}") from e
    return sorted(tasas.items())


def actualizar(cur) -> int:
    """Trae las tasas de DolarApi y guarda las fechas que falten (o que
    tenian otra tasa automatica). Devuelve cuantas filas cambio."""
    tasas = leer_dolarapi()
    if not tasas:
        return 0
    cur.executemany(
        'INSERT INTO "TasaCambio" ("fecha", "tasa", "fuente", "registradoEn") VALUES (%s, %s, \'DOLARAPI\', %s) '
        'ON CONFLICT ("fecha") DO UPDATE SET "tasa" = EXCLUDED."tasa", "registradoEn" = EXCLUDED."registradoEn" '
        'WHERE "TasaCambio"."fuente" = \'DOLARAPI\' AND "TasaCambio"."tasa" <> EXCLUDED."tasa"',
        [(fecha, tasa, ahora_utc()) for fecha, tasa in tasas],
    )
    return cur.rowcount


def guardar_manual(cur, fecha: date, tasa: Decimal, usuario_id: str) -> None:
    if tasa <= 0 or tasa > Decimal("100000000"):
        raise ValueError("La tasa no es valida")
    if fecha > hoy_caracas() + timedelta(days=3):
        raise ValueError("La fecha no puede estar tan adelante")
    cur.execute(
        'INSERT INTO "TasaCambio" ("fecha", "tasa", "fuente", "registradoEn", "registradoPorId") '
        "VALUES (%s, %s, 'MANUAL', %s, %s) "
        'ON CONFLICT ("fecha") DO UPDATE SET "tasa" = EXCLUDED."tasa", "fuente" = \'MANUAL\', '
        '"registradoEn" = EXCLUDED."registradoEn", "registradoPorId" = EXCLUDED."registradoPorId"',
        (fecha, tasa, ahora_utc(), usuario_id),
    )


def vigente(cur, fecha: date) -> dict | None:
    cur.execute(
        'SELECT "fecha", "tasa", "fuente" FROM "TasaCambio" WHERE "fecha" <= %s ORDER BY "fecha" DESC LIMIT 1',
        (fecha,),
    )
    return cur.fetchone()


def tasa_para(cur, fecha: date) -> dict:
    """{"fecha", "tasa", "fuente"} vigente en esa fecha. Si lo guardado esta
    desactualizado, intenta traerla de DolarApi primero; si aun asi no hay,
    TasaNoDisponible (cobranzas puede cargarla a mano).

    Llamarla ANTES de escribir nada en la transaccion: si actualiza, hace
    commit para no perder las tasas aunque lo que sigue falle."""
    fila = vigente(cur, fecha)
    if fila is None or (fecha - fila["fecha"]).days > DIAS_DESACTUALIZADA:
        try:
            actualizar(cur)
            cur.connection.commit()
        except TasaNoDisponible as e:
            _log.warning("%s", e)
        fila = vigente(cur, fecha)
    if fila is None:
        raise TasaNoDisponible(f"No hay tasa BCV registrada para el {fecha:%d/%m/%Y}")
    return fila
