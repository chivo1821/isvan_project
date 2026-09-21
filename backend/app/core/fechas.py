"""Fechas y horas de negocio, iguales en cualquier servidor.

Convencion de la base: los instantes (llegadaEn, entregadoEn, createdAt...)
se guardan en UTC sin zona, como hace Prisma y como hace Postgres con now()
en una sesion GMT. Para escribirlos desde Python se usa ahora_utc(), nunca
datetime.now(): esa devuelve la hora local de la maquina, que en Vercel es
UTC pero en una PC de Caracas es UTC-4, y el mismo codigo guardaba horas
distintas segun donde corriera.

Para "que dia es hoy" en el negocio se usa hoy_caracas(): entre las 20:00 y
la medianoche de Caracas, en UTC ya es el dia siguiente.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

# Venezuela no tiene horario de verano desde 2016: la hora de Caracas es
# UTC-4 fija. Se calcula asi, y no con zoneinfo, para no depender de la
# base de zonas horarias (en Windows no viene instalada).
_DESFASE_CARACAS = timedelta(hours=-4)


def ahora_utc() -> datetime:
    """El instante actual en UTC, sin zona: tal como va a la base."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def hoy_caracas() -> date:
    return (datetime.now(timezone.utc) + _DESFASE_CARACAS).date()


def a_caracas(instante: datetime) -> datetime:
    """Un instante guardado en UTC, en hora de Caracas y sin zona: para
    mostrarlo donde no hay navegador que lo convierta (un Excel)."""
    if instante.tzinfo is not None:
        instante = instante.astimezone(timezone.utc).replace(tzinfo=None)
    return instante + _DESFASE_CARACAS
