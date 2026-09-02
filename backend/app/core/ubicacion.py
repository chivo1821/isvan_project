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
