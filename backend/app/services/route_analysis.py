"""Port de src/lib/route-analysis/{common,find-path}.ts — misma logica mock
(sin SuperMap iServer real todavia): usa una ruta "de ejemplo" precalculada
si existe para el despacho, o genera una ruta sintetica a partir de la
distancia real (haversine) entre origen y destino.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

EARTH_RADIUS_KM = 6371
FACTOR_VIALIDAD = 1.3
VELOCIDAD_PROMEDIO_KMH = 45


@dataclass
class LatLng:
    lat: float
    lng: float


def haversine_km(a: LatLng, b: LatLng) -> float:
    d_lat = math.radians(b.lat - a.lat)
    d_lng = math.radians(b.lng - a.lng)
    lat1 = math.radians(a.lat)
    lat2 = math.radians(b.lat)

    h = math.sin(d_lat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(d_lng / 2) ** 2
    return 2 * EARTH_RADIUS_KM * math.asin(min(1, math.sqrt(h)))


@dataclass
class RutaResultado:
    geometry: list[tuple[float, float]]  # [(lng, lat), ...]
    distancia_km: float
    tiempo_min: int


# Mismas rutas "de ejemplo" que src/lib/mock-data/rutas-optimizadas.ts, para
# que los despachos sembrados en la demo (desp-2, desp-7) calculen la misma
# ruta que ya se ve en el mapa de seguimiento.
RUTAS_PRECALCULADAS: dict[str, RutaResultado] = {
    "desp-2": RutaResultado(
        geometry=[(-66.944611, 10.512937), (-67.45, 10.35), (-68.0011, 10.1751)],
        distancia_km=165,
        tiempo_min=150,
    ),
    "desp-7": RutaResultado(
        geometry=[(-66.944611, 10.512937), (-68.0, 10.16), (-68.75, 10.11), (-69.347, 10.0747)],
        distancia_km=355,
        tiempo_min=260,
    ),
}


def _generar_ruta_sintetica(origen: LatLng, destino: LatLng) -> RutaResultado:
    distancia_recta_km = haversine_km(origen, destino)

    mid_lat = (origen.lat + destino.lat) / 2
    mid_lng = (origen.lng + destino.lng) / 2
    dx = destino.lng - origen.lng
    dy = destino.lat - origen.lat
    offset = 0.08 * min(1, distancia_recta_km / 50)
    perp_lat = mid_lat + dx * offset
    perp_lng = mid_lng - dy * offset

    distancia_km = round(distancia_recta_km * FACTOR_VIALIDAD, 1)
    tiempo_min = max(5, round((distancia_km / VELOCIDAD_PROMEDIO_KMH) * 60))

    return RutaResultado(
        geometry=[(origen.lng, origen.lat), (perp_lng, perp_lat), (destino.lng, destino.lat)],
        distancia_km=distancia_km,
        tiempo_min=tiempo_min,
    )


def calcular_mejor_ruta(despacho_id: str, origen: LatLng, destino: LatLng) -> RutaResultado:
    precalculada = RUTAS_PRECALCULADAS.get(despacho_id)
    if precalculada:
        return precalculada
    return _generar_ruta_sintetica(origen, destino)
