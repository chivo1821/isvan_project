"""Calculo de rutas sobre la red vial guardada en la base (PostGIS +
pgRouting, ver app/services/red_vial.py).

- Tramo simple (origen -> destino): calcular_mejor_ruta().
- Multi-parada (origen -> N clientes): calcular_mejor_ruta_multi(), que
  ordena las paradas por tiempo real de red y encadena tramos.

Si la red no resuelve un tramo (cliente lejos de la red, sin camino), se
estima en linea recta por un factor y queda marcado como "estimada".

No se usa ningun servicio externo de rutas: el iServer de SuperMap quedo
fuera a proposito y no debe volver a llamarse.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

EARTH_RADIUS_KM = 6371
FACTOR_VIALIDAD = 1.3
VELOCIDAD_PROMEDIO_KMH = 45

# Minutos que el vehiculo pasa detenido en cada cliente: bajar la mercancia,
# entregarla y que la reciban. El servicio de rutas solo devuelve tiempo de
# manejo, que no es la naturaleza del reparto — sin esto, la duracion
# estimada de un viaje de 10 paradas se quedaba corta por mas de dos horas.
MINUTOS_POR_PARADA = 15

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
    # De donde salio: "red_vial" (pgRouting sobre la red en la base) o
    # "estimada" (linea recta por un factor). Lo usa
    # el pago de delivery para avisar cuando una distancia no es real.
    fuente: str = "estimada"


# Mismas rutas "de ejemplo" que src/lib/mock-data/rutas-optimizadas.ts —
# fallback si la red vial no resuelve estos despachos sembrados en la demo
# (desp-2, desp-7).
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


def _red_vial():
    """Import perezoso: red_vial importa de este modulo (LatLng, haversine),
    asi que traerlo arriba seria un import circular."""
    from app.services import red_vial

    return red_vial


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
        fuente="estimada",
    )


def calcular_mejor_ruta(despacho_id: str, origen: LatLng, destino: LatLng) -> RutaResultado:
    en_base = _red_vial().ruta_entre(origen, destino)
    if en_base:
        return en_base

    precalculada = RUTAS_PRECALCULADAS.get(despacho_id)
    if precalculada:
        return precalculada
    return _generar_ruta_sintetica(origen, destino)


# ---------- Rutas multi-parada ----------


@dataclass
class RutaMultiResultado:
    geometry: list[tuple[float, float]]  # [(lng, lat), ...] trazado completo
    distancia_km: float
    tiempo_min: int


def orden_vecino_mas_cercano(origen: LatLng, paradas: list[LatLng]) -> list[int]:
    """Heuristica de vecino mas cercano (Haversine): partiendo de `origen`,
    en cada paso elige la parada no visitada mas cercana a la posicion
    actual. Solo se usa si la red vial no puede ordenar las paradas —ver
    calcular_mejor_ruta_multi()— y como estimacion de distancia al sugerir
    agrupaciones (ver app/services/plan_rutas.py)."""
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
    ubicar donde, dentro del trazado combinado, esta la llegada a cada
    parada."""
    return min(
        range(len(geometry)),
        key=lambda i: haversine_km(LatLng(lat=geometry[i][1], lng=geometry[i][0]), punto),
    )


def _ruta_multi_encadenada(
    origen: LatLng, paradas: list[LatLng], orden: list[int] | None = None
) -> tuple[RutaMultiResultado, list[int], list[int]]:
    """Encadena tramos de dos puntos con calcular_mejor_ruta (que resuelve
    cada tramo con la red vial de la base o, si no, con la estimacion). El orden de visita puede venir dado —por tiempo real de red, ver
    red_vial.orden_por_costo—; si no, se decide por distancia en linea recta.
    Aca si se conocen los limites exactos entre tramos, asi que
    indices_parada se arma directo."""
    orden = orden if orden is not None else orden_vecino_mas_cercano(origen, paradas)

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

    Sin deduplicar, el encadenado mete tramos sinteticos para los saltos de
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

    El orden lo decide la red vial por tiempo real; si no puede, la
    heuristica de vecino mas cercano. En los dos casos se encadenan tramos
    de dos puntos.

    Los despachos que van a la misma ubicacion se agrupan en una sola parada
    (ver _agrupar_paradas_por_ubicacion) y quedan consecutivos en el orden.
    """
    ubicaciones, indices_por_ubicacion = _agrupar_paradas_por_ubicacion(paradas)

    # None si la red no puede ordenarlas: el encadenado usa entonces el
    # vecino mas cercano.
    orden_por_red = _red_vial().orden_por_costo(origen, ubicaciones)
    resultado, orden_ubicaciones, _ = _ruta_multi_encadenada(origen, ubicaciones, orden_por_red)

    # Cada parada se ubica por el punto de la geometria mas cercano a sus
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
