"""Quien maneja un vehiculo, como una sola expresion SQL que se puede usar en
cualquier consulta que tenga el vehiculo con alias `v`.

El chofer es el usuario REPARTIDOR activo que tiene ese vehiculo asignado
(Usuario.vehiculoAsignadoId): es el que ve la ruta y marca las entregas en
el despachador. Si no hay ninguno, se usa el nombre escrito a mano en la
ficha del vehiculo (conductorNombre), que queda solo como respaldo de los
datos cargados antes del modulo de choferes.

Es una subconsulta con LIMIT 1 y no un JOIN: con un JOIN, un vehiculo con
dos repartidores asignados duplicaba sus filas en los listados.
"""

from __future__ import annotations

_REPARTIDOR_ASIGNADO = (
    'SELECT u."%s" FROM "Usuario" u '
    "WHERE u.\"vehiculoAsignadoId\" = v.\"id\" AND u.\"rol\" = 'REPARTIDOR' AND u.\"activo\" "
    'ORDER BY u."nombre" LIMIT 1'
)

CONDUCTOR_DEL_VEHICULO = f'COALESCE(({_REPARTIDOR_ASIGNADO % "nombre"}), v."conductorNombre")'

# El usuario al que se le paga el delivery (ver app/services/delivery.py):
# sin repartidor asignado no hay a quien liquidarle, y el nombre suelto de la
# ficha del vehiculo no sirve para eso.
REPARTIDOR_DEL_VEHICULO = f'({_REPARTIDOR_ASIGNADO % "id"})' 
