import uuid

from fastapi import APIRouter, Depends, HTTPException

from app.core.auth import get_current_user, requiere_rol
from app.core.conductor import CONDUCTOR_DEL_VEHICULO
from app.core.db import get_connection
from app.core.permisos import es_repartidor, vehiculo_asignado
from app.schemas import Vehiculo, VehiculoCreate, VehiculoEstadoUpdate

router = APIRouter(prefix="/vehiculos", tags=["vehiculos"])

# Unico almacen de la empresa — ver src/lib/mock-data/almacenes.ts.
ALMACEN_BASE_ID = "alm-catia"

# Cada vehiculo con quien lo maneja hoy (ver app/core/conductor.py).
_CON_CONDUCTOR = f'SELECT v.*, {CONDUCTOR_DEL_VEHICULO} AS "conductor" FROM "Vehiculo" v '


@router.get("", response_model=list[Vehiculo])
def listar_vehiculos(usuario: dict = Depends(get_current_user)):
    """Un REPARTIDOR solo ve su propio vehiculo — no la flota completa."""
    with get_connection() as conn, conn.cursor() as cur:
        if es_repartidor(usuario):
            vehiculo_id = vehiculo_asignado(usuario)
            if not vehiculo_id:
                return []
            cur.execute(_CON_CONDUCTOR + 'WHERE v."id" = %s', (vehiculo_id,))
        else:
            cur.execute(_CON_CONDUCTOR + 'ORDER BY v."placa"')
        return cur.fetchall()


@router.get("/{vehiculo_id}", response_model=Vehiculo)
def obtener_vehiculo(vehiculo_id: str, usuario: dict = Depends(get_current_user)):
    if es_repartidor(usuario) and vehiculo_id != vehiculo_asignado(usuario):
        raise HTTPException(404, "Vehiculo no encontrado")
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(_CON_CONDUCTOR + 'WHERE v."id" = %s', (vehiculo_id,))
        row = cur.fetchone()
    if not row:
        raise HTTPException(404, "Vehiculo no encontrado")
    return row


@router.post("", response_model=Vehiculo, status_code=201, dependencies=[Depends(requiere_rol("DESPACHOS"))])
def crear_vehiculo(data: VehiculoCreate):
    with get_connection() as conn, conn.cursor() as cur:
        vehiculo_id = f"veh-{uuid.uuid4().hex[:10]}"
        cur.execute(
            'INSERT INTO "Vehiculo" '
            '("id", "placa", "tipo", "capacidadKg", "tieneRefrigeracion", "estado", "almacenBaseId", '
            '"conductorNombre", "costoPorKm") '
            "VALUES (%s, %s, %s, %s, %s, 'FUNCIONAL', %s, %s, %s) RETURNING *",
            (
                vehiculo_id,
                data.placa.upper(),
                data.tipo,
                data.capacidadKg,
                data.tieneRefrigeracion,
                ALMACEN_BASE_ID,
                data.conductorNombre,
                data.costoPorKm,
            ),
        )
        row = cur.fetchone()
        conn.commit()
        return row


@router.patch(
    "/{vehiculo_id}/estado",
    response_model=Vehiculo,
    dependencies=[Depends(requiere_rol("DESPACHOS"))],
)
def cambiar_estado_vehiculo(vehiculo_id: str, data: VehiculoEstadoUpdate):
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            'UPDATE "Vehiculo" SET "estado" = %s WHERE "id" = %s RETURNING "id"',
            (data.estado, vehiculo_id),
        )
        if not cur.fetchone():
            raise HTTPException(404, "Vehiculo no encontrado")
        conn.commit()
        # Se relee con el chofer: la tabla de flota reemplaza la fila con esta
        # respuesta y sin el chofer lo mostraria como "sin asignar".
        cur.execute(_CON_CONDUCTOR + 'WHERE v."id" = %s', (vehiculo_id,))
        return cur.fetchone()
