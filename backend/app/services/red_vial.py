"""Calculo de rutas sobre la red vial guardada en la base (PostGIS + pgRouting).

Reemplaza al servicio externo de SuperMap iServer: los tramos de calle viven
en la tabla RedVialTramo (ver backend/scripts/cargar_red_vial.py) y las
rutas se resuelven con pgr_dijkstra.

Tres cosas hacen que una red nacional no vuelva lentas las consultas:

- **Recuadro**: la busqueda solo mira los tramos alrededor de los dos puntos,
  con margen. Un reparto en Caracas no necesita mirar Zulia.
- **Cache**: cada ruta calculada queda en RutaCalculada y no se vuelve a
  resolver.
- **Nodo mas cercano**: el punto se engancha al cruce mas cercano de la red;
  si esta demasiado lejos (cliente mal georreferenciado), se devuelve None y
  el llamador usa su respaldo.

Este modulo abre su propia conexion: lo llaman funciones que hoy no reciben
cursor (ver app/services/route_analysis.py).
"""

from __future__ import annotations

import json
import logging
import math

from app.core.db import get_connection
from app.services.route_analysis import LatLng, RutaResultado, haversine_km

logger = logging.getLogger(__name__)

# Coordenadas redondeadas para la cache: 5 decimales son ~1 m, suficiente
# para que dos pedidos al mismo cliente compartan el resultado.
DECIMALES_CACHE = 5
PERFIL = "vehiculo"

# Cuanto se agranda el recuadro de busqueda alrededor de los dos puntos.
FACTOR_MARGEN = 2.0
MARGEN_MINIMO_KM = 20.0
# Si el punto esta a mas de esto del cruce mas cercano, no se considera
# enganchado a la red.
RADIO_NODO_M = 3000

KM_POR_GRADO = 111.32


def _grados(km: float, lat: float) -> tuple[float, float]:
    """Cuantos grados son `km` de latitud y de longitud a esa latitud."""
    return km / KM_POR_GRADO, km / max(KM_POR_GRADO * math.cos(math.radians(lat)), 1e-6)


def _tramos_sql(puntos: list[LatLng]) -> str:
    """Los tramos que entran en la busqueda: solo los del recuadro que cubre
    los puntos, con margen. El indice GIST lo resuelve rapido."""
    lats = [p.lat for p in puntos]
    lngs = [p.lng for p in puntos]
    lado_km = max(
        haversine_km(LatLng(lat=min(lats), lng=min(lngs)), LatLng(lat=max(lats), lng=max(lngs))),
        MARGEN_MINIMO_KM,
    )
    margen_lat, margen_lng = _grados(lado_km * FACTOR_MARGEN, sum(lats) / len(lats))
    return (
        'SELECT "id"::bigint AS id, "source", "target", "costoMin" AS cost, '
        '"costoMinInverso" AS reverse_cost FROM "RedVialTramo" WHERE "geom" && '
        f"ST_MakeEnvelope({min(lngs) - margen_lng}, {min(lats) - margen_lat}, "
        f"{max(lngs) + margen_lng}, {max(lats) + margen_lat}, 4326)"
    )


def disponible() -> bool:
    """Si hay red cargada. Si no la hay, los llamadores siguen con el
    servicio externo o con la estimacion en linea recta."""
    try:
        with get_connection() as conn, conn.cursor() as cur:
            cur.execute('SELECT EXISTS (SELECT 1 FROM "RedVialTramo" LIMIT 1) AS hay')
            return bool(cur.fetchone()["hay"])
    except Exception as e:  # tabla inexistente, base caida...
        logger.warning("No se pudo consultar la red vial (%s): %s", type(e).__name__, e)
        return False


def _nodo_mas_cercano(cur, punto: LatLng) -> int | None:
    cur.execute(
        'SELECT "id", ST_Distance("geom"::geography, ST_SetSRID(ST_MakePoint(%(lng)s, %(lat)s), 4326)::geography) AS m '
        'FROM "RedVialNodo" ORDER BY "geom" <-> ST_SetSRID(ST_MakePoint(%(lng)s, %(lat)s), 4326) LIMIT 1',
        {"lat": punto.lat, "lng": punto.lng},
    )
    fila = cur.fetchone()
    if not fila or fila["m"] > RADIO_NODO_M:
        return None
    return fila["id"]


def _leer_cache(cur, origen: LatLng, destino: LatLng) -> RutaResultado | None:
    cur.execute(
        'SELECT "distanciaKm", "tiempoMin", "geometria" FROM "RutaCalculada" '
        'WHERE "perfil" = %s AND "origenLat" = %s AND "origenLng" = %s '
        '  AND "destinoLat" = %s AND "destinoLng" = %s',
        (PERFIL, *_redondear(origen), *_redondear(destino)),
    )
    fila = cur.fetchone()
    if not fila:
        return None
    return RutaResultado(
        geometry=[tuple(p) for p in fila["geometria"]],
        distancia_km=fila["distanciaKm"],
        tiempo_min=fila["tiempoMin"],
        fuente="red_vial",
    )


def _redondear(punto: LatLng) -> tuple[float, float]:
    return round(punto.lat, DECIMALES_CACHE), round(punto.lng, DECIMALES_CACHE)


def _guardar_cache(cur, origen: LatLng, destino: LatLng, ruta: RutaResultado) -> None:
    cur.execute(
        'INSERT INTO "RutaCalculada" ("id", "perfil", "origenLat", "origenLng", "destinoLat", "destinoLng", '
        '"distanciaKm", "tiempoMin", "geometria") VALUES (gen_random_uuid()::text, %s, %s, %s, %s, %s, %s, %s, %s) '
        'ON CONFLICT ("perfil", "origenLat", "origenLng", "destinoLat", "destinoLng") DO NOTHING',
        (
            PERFIL,
            *_redondear(origen),
            *_redondear(destino),
            ruta.distancia_km,
            ruta.tiempo_min,
            json.dumps([list(p) for p in ruta.geometry]),
        ),
    )


def _dijkstra(cur, origen: LatLng, destino: LatLng, nodo_origen: int, nodo_destino: int) -> RutaResultado | None:
    """Camino mas rapido entre dos cruces, con su trazado. Cada tramo se
    orienta segun por donde se entra, para que la linea salga continua."""
    cur.execute(
        f"""
        WITH ruta AS (
            SELECT * FROM pgr_dijkstra($tramos${_tramos_sql([origen, destino])}$tramos$, %(origen)s, %(destino)s, true)
        )
        SELECT r."seq", r."cost", t."longitudM",
               ST_AsGeoJSON(CASE WHEN t."source" = r."node" THEN t."geom" ELSE ST_Reverse(t."geom") END) AS geom
        FROM ruta r JOIN "RedVialTramo" t ON t."id" = r."edge"
        WHERE r."edge" <> -1
        ORDER BY r."seq"
        """,
        {"origen": nodo_origen, "destino": nodo_destino},
    )
    tramos = cur.fetchall()
    if not tramos:
        return None

    geometry: list[tuple[float, float]] = []
    metros = 0.0
    minutos = 0.0
    for tramo in tramos:
        coords = json.loads(tramo["geom"])["coordinates"]
        # El primer punto de cada tramo es el ultimo del anterior.
        geometry.extend(tuple(c) for c in (coords if not geometry else coords[1:]))
        metros += tramo["longitudM"]
        minutos += tramo["cost"]

    return RutaResultado(
        geometry=geometry,
        distancia_km=round(metros / 1000, 1),
        tiempo_min=max(1, round(minutos)),
        fuente="red_vial",
    )


def ruta_entre(origen: LatLng, destino: LatLng) -> RutaResultado | None:
    """El trazado real entre dos puntos, o None si la red no los cubre."""
    try:
        with get_connection() as conn, conn.cursor() as cur:
            en_cache = _leer_cache(cur, origen, destino)
            if en_cache:
                return en_cache

            nodo_origen = _nodo_mas_cercano(cur, origen)
            nodo_destino = _nodo_mas_cercano(cur, destino)
            if nodo_origen is None or nodo_destino is None:
                logger.info("Punto fuera de la red vial: no se calcula la ruta en base")
                return None
            if nodo_origen == nodo_destino:
                # Mismo cruce: la ruta es el propio punto.
                return RutaResultado(
                    geometry=[(origen.lng, origen.lat), (destino.lng, destino.lat)],
                    distancia_km=0.0,
                    tiempo_min=1,
                    fuente="red_vial",
                )

            ruta = _dijkstra(cur, origen, destino, nodo_origen, nodo_destino)
            if ruta:
                _guardar_cache(cur, origen, destino, ruta)
                conn.commit()
            return ruta
    except Exception as e:
        logger.warning("Fallo el calculo de ruta en la base (%s): %s", type(e).__name__, e)
        return None


def orden_por_costo(origen: LatLng, paradas: list[LatLng]) -> list[int] | None:
    """Orden de visita por tiempo real de red, con vecino mas cercano sobre
    la matriz de costos. None si la red no cubre alguno de los puntos: el
    llamador se queda con el orden por distancia en linea recta."""
    if not paradas:
        return []
    puntos = [origen, *paradas]
    try:
        with get_connection() as conn, conn.cursor() as cur:
            nodos = [_nodo_mas_cercano(cur, p) for p in puntos]
            if any(n is None for n in nodos):
                return None
            cur.execute(
                f"SELECT * FROM pgr_dijkstraCostMatrix($tramos${_tramos_sql(puntos)}$tramos$, %(nodos)s::bigint[], true)",
                {"nodos": list(dict.fromkeys(nodos))},
            )
            costo = {(f["start_vid"], f["end_vid"]): f["agg_cost"] for f in cur.fetchall()}
    except Exception as e:
        logger.warning("Fallo la matriz de costos (%s): %s", type(e).__name__, e)
        return None

    def minutos(desde: int, hasta: int) -> float:
        if nodos[desde] == nodos[hasta]:
            return 0.0
        valor = costo.get((nodos[desde], nodos[hasta]))
        # Sin camino entre esos dos cruces: se manda al final del recorrido.
        return valor if valor is not None else float("inf")

    restantes = list(range(1, len(puntos)))
    orden: list[int] = []
    actual = 0
    while restantes:
        siguiente = min(restantes, key=lambda i: minutos(actual, i))
        orden.append(siguiente - 1)  # -1: el 0 es el origen, no una parada
        actual = siguiente
        restantes.remove(siguiente)
    return orden
