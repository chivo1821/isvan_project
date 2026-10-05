"""Ranking de vehiculos disponibles por mejor ajuste de capacidad (el que
sobra menos sin quedar corto) para el conjunto de despachos que se quieren
agrupar en una misma Ruta — filtra por refrigeracion si algun item la
requiere. El peso ya viene en cada DespachoItem (pesoUnitarioKg, cargado
desde el Excel o la carga manual — ya no hay catalogo de Producto del que
derivarlo). Un solo almacen -> la cercania ya no es un criterio.

Disponible = libre a la hora de salida de la ruta (sin otra ruta que se
pise, ver app/services/planificacion.py), y si es moto, sin paradas mas
lejos del almacen que el limite configurado.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from app.core.db import get_connection
from app.core.fechas import ahora_utc
from app.core.ubicacion import sin_ubicacion
from app.services import configuracion
from app.services import planificacion as pl
from app.services.route_analysis import LatLng

ALMACEN_BASE_ID = "alm-catia"


def sugerir_vehiculos(
    despacho_ids: list[str], salida: datetime | None = None, ruta_id: str | None = None
) -> list[dict]:
    if not despacho_ids:
        return []

    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            'SELECT "cantidad", "pesoUnitarioKg", "requiereFrio" FROM "DespachoItem" '
            'WHERE "despachoId" = ANY(%s)',
            (despacho_ids,),
        )
        items = cur.fetchall()
        if not items:
            return []

        peso_estimado_kg = round(sum(item["cantidad"] * item["pesoUnitarioKg"] for item in items))
        requiere_cadena_frio = any(item["requiereFrio"] for item in items)

        # El horario a cubrir: el de la ruta que se esta reasignando, o la
        # salida elegida, o ahora.
        duracion_min = pl.DURACION_POR_DEFECTO_MIN
        inicio = salida.astimezone(timezone.utc).replace(tzinfo=None) if salida else None
        if ruta_id:
            cur.execute('SELECT "salidaProgramada", "tiempoTotalMin" FROM "Ruta" WHERE "id" = %s', (ruta_id,))
            ruta = cur.fetchone()
            if ruta:
                inicio = inicio or ruta["salidaProgramada"]
                duracion_min = ruta["tiempoTotalMin"] or duracion_min
        inicio = inicio or ahora_utc()
        libres = pl.vehiculos_libres(cur, inicio, inicio + timedelta(minutes=duracion_min), excluir_ruta=ruta_id)

        # La parada mas lejos del almacen, para no proponer una moto de mas.
        cur.execute('SELECT "lat", "lng" FROM "Almacen" WHERE "id" = %s', (ALMACEN_BASE_ID,))
        almacen = cur.fetchone()
        cur.execute(
            'SELECT c."lat", c."lng" FROM "Despacho" d JOIN "Cliente" c ON c."id" = d."destinoClienteId" '
            'WHERE d."id" = ANY(%s)',
            (despacho_ids,),
        )
        clientes = [c for c in cur.fetchall() if not sin_ubicacion(c["lat"], c["lng"])]
        mas_lejos_km = (
            max(
                pl.km_por_calle(LatLng(lat=almacen["lat"], lng=almacen["lng"]), LatLng(lat=c["lat"], lng=c["lng"]))
                for c in clientes
            )
            if almacen and clientes
            else 0.0
        )
        limite_moto = configuracion.leer(cur, "motoDistanciaMaxKm")

    candidatos = [
        v for v in libres
        if v["capacidadKg"] >= peso_estimado_kg
        and (not requiere_cadena_frio or v["tieneRefrigeracion"])
        and (v["tipo"] != "MOTO" or mas_lejos_km <= limite_moto)
    ]

    sugerencias = []
    for vehiculo in candidatos:
        holgura_kg = vehiculo["capacidadKg"] - peso_estimado_kg
        motivos = [f"Capacidad suficiente ({vehiculo['capacidadKg']:,.0f} kg / ~{peso_estimado_kg} kg estimados)"]
        if requiere_cadena_frio:
            motivos.append("Con refrigeración")
        motivos.append("Libre en ese horario")
        sugerencias.append({"vehiculo": vehiculo, "holguraKg": holgura_kg, "motivos": motivos})

    sugerencias.sort(key=lambda s: s["holguraKg"])
    return sugerencias[:3]
