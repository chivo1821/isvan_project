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

CONDUCTOR_DEL_VEHICULO = (
    'COALESCE((SELECT u."nombre" FROM "Usuario" u '
    "WHERE u.\"vehiculoAsignadoId\" = v.\"id\" AND u.\"rol\" = 'REPARTIDOR' AND u.\"activo\" "
    'ORDER BY u."nombre" LIMIT 1), v."conductorNombre")'
)
