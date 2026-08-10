import uuid

from fastapi import APIRouter, HTTPException

from app.core.db import get_connection
from app.schemas import Vehiculo, VehiculoCreate, VehiculoEstadoUpdate

router = APIRouter(prefix="/vehiculos", tags=["vehiculos"])

# Unico almacen de la empresa — ver src/lib/mock-data/almacenes.ts.
ALMACEN_BASE_ID = "alm-catia"


@router.get("", response_model=list[Vehiculo])
def listar_vehiculos():
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute('SELECT * FROM "Vehiculo" ORDER BY "placa"')
        return cur.fetchall()


@router.get("/{vehiculo_id}", response_model=Vehiculo)
def obtener_vehiculo(vehiculo_id: str):
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute('SELECT * FROM "Vehiculo" WHERE "id" = %s', (vehiculo_id,))
        row = cur.fetchone()
    if not row:
        raise HTTPException(404, "Vehiculo no encontrado")
    return row


@router.post("", response_model=Vehiculo, status_code=201)
def crear_vehiculo(data: VehiculoCreate):
    with get_connection() as conn, conn.cursor() as cur:
        vehiculo_id = f"veh-{uuid.uuid4().hex[:10]}"
        cur.execute(
            'INSERT INTO "Vehiculo" '
            '("id", "placa", "tipo", "capacidadKg", "tieneRefrigeracion", "estado", "almacenBaseId", "conductorNombre") '
            "VALUES (%s, %s, %s, %s, %s, 'FUNCIONAL', %s, %s) RETURNING *",
            (
                vehiculo_id,
                data.placa.upper(),
                data.tipo,
                data.capacidadKg,
                data.tieneRefrigeracion,
                ALMACEN_BASE_ID,
                data.conductorNombre,
            ),
        )
        row = cur.fetchone()
        conn.commit()
        return row


@router.patch("/{vehiculo_id}/estado", response_model=Vehiculo)
def cambiar_estado_vehiculo(vehiculo_id: str, data: VehiculoEstadoUpdate):
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            'UPDATE "Vehiculo" SET "estado" = %s WHERE "id" = %s RETURNING *',
            (data.estado, vehiculo_id),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Vehiculo no encontrado")
        conn.commit()
        return row
