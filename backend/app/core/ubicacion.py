"""Criterio unico de "cliente sin ubicacion", compartido por los
importadores, el armado de rutas y el motor de sugerencia.

Un cliente no tiene ubicacion usable si le faltan las coordenadas O si
estan en (0, 0). El punto (0, 0) cae en el golfo de Guinea, a miles de km
de Venezuela: cuando aparece es porque el dato venia vacio en el origen y
alguien lo cargo como cero, no porque el cliente este ahi. Tratarlo como
una coordenada valida metia paradas imposibles en las rutas, asi que vale
exactamente lo mismo que un NULL.
"""

from __future__ import annotations

# Margen para comparar contra 0 sin depender de la igualdad exacta de
# floats. ~0.11 m en el ecuador: cualquier cliente real queda muy por
# encima de esta distancia respecto del (0, 0).
TOLERANCIA_GRADOS = 1e-6

MOTIVO_SIN_UBICACION = "no tiene coordenadas validas (faltan o estan en 0,0)"


def sin_ubicacion(lat: float | None, lng: float | None) -> bool:
    if lat is None or lng is None:
        return True
    return abs(lat) < TOLERANCIA_GRADOS and abs(lng) < TOLERANCIA_GRADOS


# Recuadro que cubre Venezuela continental e insular, con holgura. No es un
# limite de negocio (no dice hasta donde reparten), es un filtro de datos:
# una coordenada afuera de aqui es un error de carga, no un cliente lejano.
# Casos que atrapa: lat y lng intercambiadas, un signo perdido, o un numero
# al que le falta la parte entera.
LAT_MIN, LAT_MAX = 0.5, 12.5
LNG_MIN, LNG_MAX = -73.5, -59.7


def fuera_de_venezuela(lat: float, lng: float) -> bool:
    return not (LAT_MIN <= lat <= LAT_MAX and LNG_MIN <= lng <= LNG_MAX)


def _decimales(valor: float) -> int:
    texto = repr(float(valor))
    return len(texto.split(".")[1]) if "." in texto else 0


# Minimo de decimales para considerar que una coordenada viene de un
# geocodificador (y no escrita a mano con poca precision).
_DECIMALES_DE_GEOCODIFICADOR = 4

# A partir de que proporcion de filas sospechosas se avisa. Por azar (un
# cero final que se pierde al leer el numero) se espera ~10%; 40% ya no es
# casualidad.
_UMBRAL_COLUMNA_TRUNCADA = 0.4


def filas_con_latitud_truncada(coordenadas: list[tuple[int, float, float]]) -> list[int]:
    """Detecta la firma de "a la columna de latitud le comieron un digito":
    la latitud tiene exactamente un decimal menos que la longitud de su
    misma fila, en buena parte del archivo.

    Paso de verdad: una carga real llego con `10.986017 / -66.9126373`
    cuando la latitud correcta era `10.4986017` — el 4 se perdio y el
    cliente quedo 45 km mar adentro. Numericamente es una coordenada
    valida, asi que solo se detecta mirando la columna completa.

    `coordenadas` son ternas (fila, lat, lng). Devuelve las filas
    sospechosas, o una lista vacia si el patron no alcanza el umbral (en
    cuyo caso es ruido y no hay nada que avisar).
    """
    comparables = [
        (fila, lat, lng)
        for fila, lat, lng in coordenadas
        if _decimales(lng) >= _DECIMALES_DE_GEOCODIFICADOR
    ]
    if not comparables:
        return []

    sospechosas = [fila for fila, lat, lng in comparables if _decimales(lng) - _decimales(lat) == 1]
    if len(sospechosas) / len(comparables) < _UMBRAL_COLUMNA_TRUNCADA:
        return []
    return sospechosas
