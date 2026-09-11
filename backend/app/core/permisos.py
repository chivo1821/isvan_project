"""Reglas de visibilidad por rol que no son un simple "puede / no puede",
sino "solo puede ver lo suyo".

Hay dos roles de campo, cada uno con su unica puerta de entrada:

- REPARTIDOR: un chofer entra a la app para hacer su viaje del dia, no para
  ver la operacion completa. Solo tiene acceso a la ruta activa del vehiculo
  que se le asigno (Usuario.vehiculoAsignadoId) — ni las rutas de otros
  vehiculos, ni la cartera de clientes, ni la cola de despachos, ni la flota.
- VENDEDOR: ve el estatus de los despachos de sus rutas de venta
  (VendedorRuta) y registra sus visitas, todo desde app/api/vendedor.py. Al
  resto de la operacion no entra: sin_acceso_vendedor se lo cierra a nivel de
  router (ver app/main.py).

Se aplica en la API, no solo escondiendo cosas en la interfaz: la UI puede
ocultar un modulo, pero cualquiera con la sesion abierta puede llamar el
endpoint a mano. Cada listado que un repartidor podria alcanzar filtra por
su vehiculo con los helpers de aca.
"""

from __future__ import annotations

from fastapi import Depends, HTTPException

from app.core.auth import get_current_user

ROL_REPARTIDOR = "REPARTIDOR"
ROL_VENDEDOR = "VENDEDOR"


def es_repartidor(usuario: dict) -> bool:
    return usuario["rol"] == ROL_REPARTIDOR


def es_vendedor(usuario: dict) -> bool:
    return usuario["rol"] == ROL_VENDEDOR


def sin_acceso_vendedor(usuario: dict = Depends(get_current_user)) -> None:
    """Dependencia de router: un VENDEDOR no entra a la operacion
    (despachos, rutas, clientes, flota, reportes...). Lo que le corresponde
    lo recibe ya filtrado a sus rutas desde app/api/vendedor.py."""
    if es_vendedor(usuario):
        raise HTTPException(403, "No tienes permiso para realizar esta accion")


def vehiculo_asignado(usuario: dict) -> str | None:
    """Vehiculo del repartidor, o None si no tiene ninguno asignado (en ese
    caso no ve ninguna ruta: no hay nada que manejar)."""
    return usuario.get("vehiculoAsignadoId")


def rutas_del_vendedor(cur, usuario_id: str) -> list[tuple[str, str]]:
    """Rutas de venta del vendedor como (empresa, ruta). Vacia si todavia no
    se le asigno ninguna: en ese caso no ve despachos ni clientes."""
    cur.execute('SELECT "empresa", "ruta" FROM "VendedorRuta" WHERE "usuarioId" = %s', (usuario_id,))
    return [(r["empresa"], r["ruta"]) for r in cur.fetchall()]


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
