"""Sincroniza la tasa oficial del BCV (via dolarapi.com) en la tabla TasaCambio.

Standalone: no depende de que FastAPI este corriendo. Pensado para correr
una vez al dia (ver run_sync_tasa_bcv.bat + Tarea Programada de Windows,
documentado en README.md de esta carpeta).

Uso: python sync_tasa_bcv.py
"""

from __future__ import annotations

import os
import sys
import uuid
from datetime import datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path

import httpx
import psycopg
from dotenv import load_dotenv

BCV_API_URL = "https://ve.dolarapi.com/v1/dolares/oficial"
REQUEST_TIMEOUT_S = 10

PROJECT_ROOT = Path(__file__).resolve().parents[3]
load_dotenv(PROJECT_ROOT / ".env")


class SyncError(Exception):
    """Cualquier fallo que deba detener el sync sin escribir nada en la DB."""


def obtener_tasa_bcv() -> tuple[Decimal, datetime]:
    """Consulta dolarapi.com y devuelve (tasa, fecha_de_publicacion)."""
    try:
        response = httpx.get(BCV_API_URL, timeout=REQUEST_TIMEOUT_S)
    except httpx.HTTPError as exc:
        raise SyncError(f"No se pudo contactar {BCV_API_URL}: {exc}") from exc

    if response.status_code != 200:
        raise SyncError(f"{BCV_API_URL} respondio {response.status_code}: {response.text[:200]}")

    data = response.json()
    promedio = data.get("promedio")
    fecha_actualizacion = data.get("fechaActualizacion")

    if promedio is None:
        raise SyncError(f"La respuesta no trae 'promedio': {data}")
    if not fecha_actualizacion:
        raise SyncError(f"La respuesta no trae 'fechaActualizacion': {data}")

    try:
        tasa = Decimal(str(promedio))
    except InvalidOperation as exc:
        raise SyncError(f"'promedio' no es un numero valido: {promedio!r}") from exc
    if tasa <= 0:
        raise SyncError(f"Tasa invalida (<= 0): {tasa}")

    try:
        fecha = datetime.fromisoformat(fecha_actualizacion)
    except ValueError as exc:
        raise SyncError(f"'fechaActualizacion' no es ISO 8601 valido: {fecha_actualizacion!r}") from exc

    return tasa, fecha


def guardar_tasa(tasa: Decimal, fecha_publicacion: datetime) -> None:
    """Upsert en TasaCambio, con la fecha (sin hora) de fecha_publicacion como llave."""
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise SyncError("DATABASE_URL no esta definido (revisa el .env en la raiz del proyecto)")

    # Se guarda a medianoche naive, igual que el resto del modelo (ver
    # toLocalDate() en src/lib/constants.ts) — un valor por dia, sin hora.
    fecha_dia = datetime(fecha_publicacion.year, fecha_publicacion.month, fecha_publicacion.day)

    try:
        with psycopg.connect(database_url, connect_timeout=10) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO "TasaCambio" ("id", "fecha", "tasa")
                    VALUES (%s, %s, %s)
                    ON CONFLICT ("fecha") DO UPDATE SET "tasa" = EXCLUDED."tasa"
                    """,
                    (uuid.uuid4().hex, fecha_dia, tasa),
                )
            conn.commit()
    except psycopg.Error as exc:
        raise SyncError(f"Error de base de datos: {exc}") from exc


def main() -> int:
    try:
        tasa, fecha_publicacion = obtener_tasa_bcv()
        guardar_tasa(tasa, fecha_publicacion)
    except SyncError as exc:
        print(f"[{datetime.now().isoformat(timespec='seconds')}] ERROR: {exc}", file=sys.stderr)
        return 1

    print(f"[{datetime.now().isoformat(timespec='seconds')}] OK {fecha_publicacion.date()}: {tasa} Bs/USD")
    return 0


if __name__ == "__main__":
    sys.exit(main())
