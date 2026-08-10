"""Port de src/lib/route-analysis/{common,find-path}.ts.

Si NETWORK_ANALYST_URL esta configurado, calcula la ruta real contra el
servicio de Transportation Analyst (FindPath) de SuperMap iServer — ver
_consultar_iserver(). Si no esta configurado, o si la llamada falla o no
encuentra un camino, cae de vuelta a una ruta "de ejemplo" precalculada o
sintetica (mismo comportamiento que antes), para que la demo no dependa de
que el servicio externo este disponible.
"""

from __future__ import annotations

import json
import math
import os
from dataclasses import dataclass
from pathlib import Path

import httpx
from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parents[3]
load_dotenv(PROJECT_ROOT / ".env")

EARTH_RADIUS_KM = 6371
FACTOR_VIALIDAD = 1.3
VELOCIDAD_PROMEDIO_KMH = 45

NETWORK_ANALYST_URL = (os.environ.get("NETWORK_ANALYST_URL") or "").rstrip("/")
NETWORK_ANALYST_WEIGHT_FIELD = os.environ.get("NETWORK_ANALYST_WEIGHT_FIELD", "time")
NETWORK_ANALYST_TIMEOUT_S = 20.0


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


# Mismas rutas "de ejemplo" que src/lib/mock-data/rutas-optimizadas.ts —
# fallback si el servicio real no esta configurado o no responde para estos
# despachos sembrados en la demo (desp-2, desp-7).
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


def _consultar_iserver(origen: LatLng, destino: LatLng) -> RutaResultado | None:
    """Llama al servicio real de SuperMap iServer (Transportation Analyst ->
    FindPath). Devuelve None si no esta configurado, o si el analisis falla
    o no encuentra camino, para que el llamador use un fallback.

    El servidor solo acepta GET (POST devuelve 405 detras del proxy), asi
    que los parametros complejos (nodes/parameter) van serializados como
    JSON dentro de la query string -- mismo contrato que usa el SDK iClient
    JS (ver network_analysis/page_1/public/js/analyses/findPath.js), solo
    que por GET en vez de POST.
    """
    if not NETWORK_ANALYST_URL:
        return None

    nodes = [
        {"x": origen.lng, "y": origen.lat},
        {"x": destino.lng, "y": destino.lat},
    ]
    parameter = {
        "weightFieldName": NETWORK_ANALYST_WEIGHT_FIELD,
        "resultSetting": {
            "returnEdgeFeatures": False,
            "returnEdgeGeometry": True,
            "returnEdgeIDs": False,
            "returnNodeFeatures": False,
            "returnNodeGeometry": False,
            "returnNodeIDs": False,
            "returnPathGuides": False,
            "returnRoutes": True,
        },
    }
    params = {
        "nodes": json.dumps(nodes),
        "parameter": json.dumps(parameter),
        "isAnalyzeById": "false",
        "hasLeastEdgeCount": "false",
        "returnContent": "true",
    }

    try:
        resp = httpx.get(f"{NETWORK_ANALYST_URL}/path.json", params=params, timeout=NETWORK_ANALYST_TIMEOUT_S)
        resp.raise_for_status()
        data = resp.json()
    except (httpx.HTTPError, ValueError):
        return None

    path_list = data.get("pathList") or []
    if not path_list:
        return None
    path = path_list[0]
    points = ((path.get("route") or {}).get("line") or {}).get("points")
    if not points:
        return None

    geometry = [(p["x"], p["y"]) for p in points]
    distancia_km = sum(
        haversine_km(LatLng(lat=a["y"], lng=a["x"]), LatLng(lat=b["y"], lng=b["x"]))
        for a, b in zip(points, points[1:])
    )
    tiempo_min = max(1, round(path.get("weight") or 0))

    return RutaResultado(geometry=geometry, distancia_km=round(distancia_km, 1), tiempo_min=tiempo_min)


def calcular_mejor_ruta(despacho_id: str, origen: LatLng, destino: LatLng) -> RutaResultado:
    real = _consultar_iserver(origen, destino)
    if real:
        return real

    precalculada = RUTAS_PRECALCULADAS.get(despacho_id)
    if precalculada:
        return precalculada
    return _generar_ruta_sintetica(origen, destino)
