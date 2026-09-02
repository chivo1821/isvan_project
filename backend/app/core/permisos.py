"""Reglas de visibilidad por rol que no son un simple "puede / no puede",
sino "solo puede ver lo suyo".

Hoy aplica a un solo caso, el del REPARTIDOR: un chofer entra a la app para
hacer su viaje del dia, no para ver la operacion completa. Solo tiene acceso
a la ruta activa del vehiculo que se le asigno (Usuario.vehiculoAsignadoId)
— ni las rutas de otros vehiculos, ni la cartera de clientes, ni la cola de
despachos, ni la flota.

Se aplica en la API, no solo escondiendo cosas en la interfaz: la UI puede
ocultar un modulo, pero cualquiera con la sesion abierta puede llamar el
endpoint a mano. Cada listado que un repartidor podria alcanzar filtra por
su vehiculo con los helpers de aca.
"""

from __future__ import annotations

ROL_REPARTIDOR = "REPARTIDOR"


def es_repartidor(usuario: dict) -> bool:
    return usuario["rol"] == ROL_REPARTIDOR


def vehiculo_asignado(usuario: dict) -> str | None:
    """Vehiculo del repartidor, o None si no tiene ninguno asignado (en ese
    caso no ve ninguna ruta: no hay nada que manejar)."""
    return usuario.get("vehiculoAsignadoId")


def ids_rutas_visibles(cur, usuario: dict) -> list[str] | None:
    """Ids de las rutas que este usuario puede ver, o None si puede verlas
    todas (cualquier rol que no sea REPARTIDOR).

    Una lista vacia significa "ninguna": es distinto de None y hay que
    respetarlo, porque un repartidor sin vehiculo asignado no ve nada.
    """
    if not es_repartidor(usuario):
        return None

    vehiculo_id = vehiculo_asignado(usuario)
    if not vehiculo_id:
        return []

    cur.execute('SELECT "id" FROM "Ruta" WHERE "vehiculoId" = %s', (vehiculo_id,))
    return [r["id"] for r in cur.fetchall()]
