"""Calculo de rutas contra el servicio de Transportation Analyst de SuperMap
iServer, con dos analisis:

- Tramo simple (origen -> destino): _consultar_iserver() / calcular_mejor_ruta()
  — endpoint .../path.json (FindPath). Port original de
  src/lib/route-analysis/{common,find-path}.ts.
- Multi-parada (origen -> N clientes, orden optimizado): _consultar_iserver_tsp()
  / calcular_mejor_ruta_multi() — endpoint .../tsppath.json (FindTSPPaths).

Si NETWORK_ANALYST_URL no esta configurado, o si una llamada falla o no
encuentra camino, cada uno cae de vuelta a un fallback (ruta "de ejemplo"
precalculada/sintetica para el tramo simple; heuristica de vecino mas
cercano + tramos encadenados para multi-parada), para que la app no dependa
de que el servicio externo este disponible.
"""

from __future__ import annotations

import json
import logging
import math
import os
from dataclasses import dataclass
from pathlib import Path

import httpx
from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parents[3]
load_dotenv(PROJECT_ROOT / ".env")

logger = logging.getLogger("route_analysis")

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
        logger.info("NETWORK_ANALYST_URL no configurado, usando ruta mock")
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
        # Coincide con network_analysis/page_1/public/js/analyses/findPath.js:
        # entre rutas con el mismo peso, prefiere la de menos tramos/cruces.
        "hasLeastEdgeCount": "true",
        "returnContent": "true",
    }

    url = f"{NETWORK_ANALYST_URL}/path.json"
    logger.info("Consultando iServer: %s nodes=%s", url, nodes)

    try:
        resp = httpx.get(url, params=params, timeout=NETWORK_ANALYST_TIMEOUT_S)
    except httpx.HTTPError as e:
        logger.warning("iServer no respondio (%s): %s -- usando fallback", type(e).__name__, e)
        return None

    if resp.status_code != 200:
        logger.warning(
            "iServer devolvio HTTP %s -- usando fallback. Cuerpo: %s",
            resp.status_code, resp.text[:500],
        )
        return None

    try:
        data = resp.json()
    except ValueError:
        logger.warning("iServer no devolvio JSON valido -- usando fallback. Cuerpo: %s", resp.text[:500])
        return None

    path_list = data.get("pathList") or []
    if not path_list:
        logger.warning("iServer no encontro ningun camino entre los puntos -- usando fallback. Respuesta: %s", data)
        return None
    path = path_list[0]
    points = ((path.get("route") or {}).get("line") or {}).get("points")
    if not points:
        logger.warning(
            "iServer encontro un camino pero sin geometria dibujable -- usando fallback. path=%s", path
        )
        return None

    logger.info("iServer devolvio %d puntos, weight=%s", len(points), path.get("weight"))
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


# ---------- Rutas multi-parada (TSP) ----------


@dataclass
class RutaMultiResultado:
    geometry: list[tuple[float, float]]  # [(lng, lat), ...] trazado completo
    distancia_km: float
    tiempo_min: int


def orden_vecino_mas_cercano(origen: LatLng, paradas: list[LatLng]) -> list[int]:
    """Heuristica de vecino mas cercano (Haversine): partiendo de `origen`,
    en cada paso elige la parada no visitada mas cercana a la posicion
    actual. Solo se usa como fallback si el servicio TSP real no responde —
    ver calcular_mejor_ruta_multi() — y como estimacion de distancia al
    sugerir agrupaciones (ver app/services/plan_rutas.py)."""
    restantes = list(range(len(paradas)))
    orden: list[int] = []
    actual = origen
    while restantes:
        siguiente = min(restantes, key=lambda i: haversine_km(actual, paradas[i]))
        orden.append(siguiente)
        actual = paradas[siguiente]
        restantes.remove(siguiente)
    return orden


def _indice_geometria_mas_cercano(geometry: list[tuple[float, float]], punto: LatLng) -> int:
    """Punto de la geometria (lng, lat) mas cercano a `punto` — usado para
    ubicar donde, dentro del trazado combinado que devuelve el TSP real,
    esta la llegada a cada parada (el servicio no da limites explicitos
    entre tramos, solo la geometria completa)."""
    return min(
        range(len(geometry)),
        key=lambda i: haversine_km(LatLng(lat=geometry[i][1], lng=geometry[i][0]), punto),
    )


def _consultar_iserver_tsp(origen: LatLng, paradas: list[LatLng]) -> tuple[RutaMultiResultado, list[int]] | None:
    """Llama al servicio real de SuperMap iServer (Transportation Analyst ->
    FindTSPPaths, endpoint .../tsppath.json). Devuelve (resultado, orden) o
    None si no esta configurado, si falla, o si la respuesta no trae la
    forma esperada, para que el llamador use el fallback.

    `orden` son indices dentro de `paradas` en el orden real de visita,
    tomados de "stopIndexes" en la respuesta -- documentado en
    TransportationAnalystResult.StopIndexes (help.supermap.com /
    support.supermap.com): para FindTSPPath, stopIndexes[0] es siempre un
    array de un solo elemento con la secuencia optimizada como indices
    0-based sobre el `nodes` de entrada (ej. si se piden los nodos [1,3,5] y
    el resultado visita [3,5,1], stopIndexes da [1,2,0]). Se pide
    explicitamente con "isStopIndexesReturn" (propiedad de
    TransportationAnalystParameter) para no depender de que el default del
    servidor lo incluya. Confirmado ademas contra el servicio real de este
    proyecto (iserver.stargis.net): con endNodeAssigned=false, stopIndexes
    siempre trae el nodo 0 (nuestro origen) primero y reordena el resto por
    costo real de red, no por distancia recta -- prueba real: nodes en
    orden [origen, lejano, cercano, medio] -> stopIndexes [0, 2, 3, 1], es
    decir SI optimiza el orden (no solo devuelve el orden de entrada).
    """
    if not NETWORK_ANALYST_URL or not paradas:
        return None

    nodos = [origen, *paradas]
    nodes = [{"x": n.lng, "y": n.lat} for n in nodos]
    parameter = {
        "weightFieldName": NETWORK_ANALYST_WEIGHT_FIELD,
        "isStopIndexesReturn": True,
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
        # El primer nodo (origen) queda fijo como partida de todos modos;
        # esto solo controla si el ULTIMO nodo tambien queda fijo como
        # destino -- no es el caso aca, se optimiza el resto libremente.
        "endNodeAssigned": "false",
        "returnContent": "true",
    }

    url = f"{NETWORK_ANALYST_URL}/tsppath.json"
    logger.info("Consultando iServer (TSP): %s nodes=%s", url, nodes)

    try:
        resp = httpx.get(url, params=params, timeout=NETWORK_ANALYST_TIMEOUT_S)
    except httpx.HTTPError as e:
        logger.warning("iServer (TSP) no respondio (%s): %s -- usando fallback", type(e).__name__, e)
        return None

    if resp.status_code != 200:
        logger.warning(
            "iServer (TSP) devolvio HTTP %s -- usando fallback. Cuerpo: %s",
            resp.status_code, resp.text[:500],
        )
        return None

    try:
        data = resp.json()
    except ValueError:
        logger.warning("iServer (TSP) no devolvio JSON valido -- usando fallback. Cuerpo: %s", resp.text[:500])
        return None

    tsp_path_list = data.get("tspPathList") or []
    if not tsp_path_list:
        logger.warning("iServer (TSP) no encontro ninguna ruta -- usando fallback. Respuesta: %s", data)
        return None

    path = tsp_path_list[0]
    points = ((path.get("route") or {}).get("line") or {}).get("points")
    # La doc del modelo (.NET/Desktop) describe StopIndexes como int[][]
    # (para soportar FindMTSPPath, con una fila por centro de distribucion),
    # pero la serializacion REST de tsppath.json ya trae un solo array
    # plano (confirmado en pruebas reales) ya que FindTSPPath solo tiene
    # una fila.
    stop_indexes = path.get("stopIndexes") or []
    if not points or len(stop_indexes) != len(nodos) or stop_indexes[0] != 0:
        logger.warning(
            "iServer (TSP) devolvio una respuesta con forma inesperada -- usando fallback. "
            "puntos=%s stopIndexes=%s",
            len(points) if points else 0, stop_indexes,
        )
        return None

    logger.info("iServer (TSP) devolvio %d puntos, weight=%s, stopIndexes=%s", len(points), path.get("weight"), stop_indexes)
    geometry = [(p["x"], p["y"]) for p in points]
    distancia_km = sum(
        haversine_km(LatLng(lat=a["y"], lng=a["x"]), LatLng(lat=b["y"], lng=b["x"]))
        for a, b in zip(points, points[1:])
    )
    tiempo_min = max(1, round(path.get("weight") or 0))
    orden = [i - 1 for i in stop_indexes[1:]]  # indices dentro de `paradas` (nodos[1:])

    resultado = RutaMultiResultado(geometry=geometry, distancia_km=round(distancia_km, 1), tiempo_min=tiempo_min)
    return resultado, orden


def _ruta_multi_encadenada(
    origen: LatLng, paradas: list[LatLng]
) -> tuple[RutaMultiResultado, list[int], list[int]]:
    """Fallback cuando el TSP real no esta disponible: decide el orden con
    la heuristica de vecino mas cercano y encadena tramos de dos puntos
    (calcular_mejor_ruta, con su propio fallback sintetico si tampoco hay
    NETWORK_ANALYST_URL). Aca si se conocen los limites exactos entre
    tramos, asi que indices_parada se arma directo (sin necesidad de buscar
    el punto mas cercano)."""
    orden = orden_vecino_mas_cercano(origen, paradas)

    geometry: list[tuple[float, float]] = [(origen.lng, origen.lat)]
    distancia_km = 0.0
    tiempo_min = 0
    indices_parada: list[int] = []
    anterior = origen
    for indice in orden:
        parada = paradas[indice]
        tramo = calcular_mejor_ruta(None, anterior, parada)
        geometry.extend(tramo.geometry[1:])  # evita duplicar el punto de union
        indices_parada.append(len(geometry) - 1)  # posicion de llegada a esta parada
        distancia_km += tramo.distancia_km
        tiempo_min += tramo.tiempo_min
        anterior = parada

    resultado = RutaMultiResultado(geometry=geometry, distancia_km=round(distancia_km, 1), tiempo_min=tiempo_min)
    return resultado, orden, indices_parada


def _agrupar_paradas_por_ubicacion(paradas: list[LatLng]) -> tuple[list[LatLng], list[list[int]]]:
    """Varios despachos pueden ir al MISMO cliente (misma lat/lng): fisicamente
    es una sola parada. Devuelve las ubicaciones unicas y, por cada una, los
    indices de las paradas originales que le corresponden.

    Es imprescindible deduplicar antes de llamar al TSP: con nodos repetidos
    el servicio devuelve "tspPathList": None (no encuentra ruta) o menos
    stopIndexes de los nodos enviados, y terminabamos cayendo al fallback
    encadenado, que ademas mete tramos sinteticos para los saltos de
    distancia cero -- de ahi salian trazados absurdos.
    """
    ubicaciones: list[LatLng] = []
    indices_por_ubicacion: list[list[int]] = []
    clave_a_posicion: dict[tuple[float, float], int] = {}

    for i, parada in enumerate(paradas):
        # 6 decimales ~ 0.1 m: mismo cliente = misma ubicacion.
        clave = (round(parada.lat, 6), round(parada.lng, 6))
        posicion = clave_a_posicion.get(clave)
        if posicion is None:
            posicion = len(ubicaciones)
            clave_a_posicion[clave] = posicion
            ubicaciones.append(parada)
            indices_por_ubicacion.append([])
        indices_por_ubicacion[posicion].append(i)

    return ubicaciones, indices_por_ubicacion


def calcular_mejor_ruta_multi(
    origen: LatLng, paradas: list[LatLng]
) -> tuple[RutaMultiResultado, list[int], list[int]]:
    """Calcula el trazado de una Ruta multi-parada (Almacen Catia -> N
    clientes), el orden de visita, y en que posicion de la geometria queda
    cada parada (para marcar RutaPunto.paradaDespachoId).

    Primero intenta el servicio TSP real de iServer (orden optimizado por
    costo real de red); si no esta configurado o falla, cae a una
    heuristica propia (vecino mas cercano) encadenando tramos de dos puntos.

    Los despachos que van a la misma ubicacion se agrupan en una sola parada
    (ver _agrupar_paradas_por_ubicacion) y quedan consecutivos en el orden.
    """
    ubicaciones, indices_por_ubicacion = _agrupar_paradas_por_ubicacion(paradas)

    real = _consultar_iserver_tsp(origen, ubicaciones)
    if real:
        resultado, orden_ubicaciones = real
    else:
        resultado, orden_ubicaciones, _ = _ruta_multi_encadenada(origen, ubicaciones)

    # El trazado viene combinado, sin limites explicitos entre tramos: cada
    # parada se ubica por el punto de la geometria mas cercano a sus
    # coordenadas reales. Los despachos que comparten ubicacion comparten
    # tambien ese punto.
    orden: list[int] = []
    indices_parada: list[int] = []
    for posicion in orden_ubicaciones:
        indice_geometria = _indice_geometria_mas_cercano(resultado.geometry, ubicaciones[posicion])
        for indice_parada in indices_por_ubicacion[posicion]:
            orden.append(indice_parada)
            indices_parada.append(indice_geometria)

    return resultado, orden, indices_parada
