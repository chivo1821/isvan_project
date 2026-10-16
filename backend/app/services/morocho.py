"""Morocho: un pedido grande que sale en dos motos juntas (asi le dice el
cliente). Reglas unicas, las usan la sugerencia de rutas (plan_rutas.py),
la sugerencia de vehiculos para una ruta armada a mano (suggest_vehiculo.py)
y la API al crear o reprogramar una ruta.

- Son exactamente dos motos distintas: la principal es Ruta.vehiculoId y la
  segunda, Ruta.vehiculoApoyoId.
- Llevan, entre las dos, hasta min(morochoMaxKg, capacidad1 + capacidad2).
- Se sugiere solo para un pedido que no cabe en ninguna moto libre, dentro
  de la distancia maxima para motos y, si el pedido necesita frio, con las
  dos motos refrigeradas.
"""

from __future__ import annotations

from dataclasses import dataclass

from fastapi import HTTPException


@dataclass
class Par:
    principal: dict
    apoyo: dict
    # Lo que pueden llevar entre las dos (con el tope del Morocho).
    capacidad_kg: float
    con_refrigeracion: bool


def capacidad(principal: dict, apoyo: dict, limite_kg: float) -> float:
    return min(limite_kg, principal["capacidadKg"] + apoyo["capacidadKg"])


def elegir_par(
    libres: list[dict], peso_kg: float, requiere_frio: bool, mas_lejos_km: float,
    limite_moto_km: float, limite_morocho_kg: float,
) -> Par | None:
    """Las dos motos libres para un pedido que no cabe en una sola, o None
    si no hace falta o no se puede (menos de dos motos, muy lejos, muy
    pesado)."""
    if mas_lejos_km > limite_moto_km:
        return None
    motos = sorted(
        (v for v in libres if v["tipo"] == "MOTO" and (not requiere_frio or v["tieneRefrigeracion"])),
        key=lambda v: -v["capacidadKg"],
    )
    if len(motos) < 2 or peso_kg <= motos[0]["capacidadKg"]:
        return None
    principal, apoyo = motos[0], motos[1]
    tope = capacidad(principal, apoyo, limite_morocho_kg)
    if peso_kg > tope:
        return None
    return Par(principal, apoyo, tope, principal["tieneRefrigeracion"] and apoyo["tieneRefrigeracion"])


def validar_apoyo(cur, vehiculo_id: str | None, apoyo_id: str | None) -> None:
    """Para crear o reprogramar: la segunda moto solo con una principal, las
    dos motos y distintas."""
    if apoyo_id is None:
        return
    if vehiculo_id is None:
        raise HTTPException(400, "Para un Morocho primero hay que elegir la moto principal")
    if apoyo_id == vehiculo_id:
        raise HTTPException(400, "La segunda moto del Morocho tiene que ser otra moto")
    cur.execute('SELECT "id", "tipo", "placa" FROM "Vehiculo" WHERE "id" = ANY(%s)', ([vehiculo_id, apoyo_id],))
    por_id = {v["id"]: v for v in cur.fetchall()}
    if apoyo_id not in por_id:
        raise HTTPException(400, "La segunda moto no existe")
    no_motos = [por_id[v]["placa"] for v in (vehiculo_id, apoyo_id) if v in por_id and por_id[v]["tipo"] != "MOTO"]
    if no_motos:
        raise HTTPException(400, f"Un Morocho son dos motos: {', '.join(no_motos)} no es una moto")
