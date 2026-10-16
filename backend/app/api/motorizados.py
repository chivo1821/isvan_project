"""Administracion de los motorizados autogestionados (solo ADMIN). El
registro y la entrada son publicos y viven en auth.py; la logica, en
app/services/motorizados.py."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from app.core.auth import requiere_rol
from app.core.db import get_connection
from app.schemas import CodigoRegistro, CodigoRegistroUpdate, Motorizado, PinRestablecido
from app.services import configuracion as cfg
from app.services import motorizados as mt

router = APIRouter(prefix="/motorizados", tags=["motorizados"], dependencies=[Depends(requiere_rol("ADMIN"))])

CLAVE_CODIGO = "motorizadoCodigoRegistro"


@router.get("", response_model=list[Motorizado])
def listar_motorizados():
    """Los activos primero; dentro de cada grupo, los registrados mas
    recientemente arriba."""
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            'SELECT u."id", u."nombre", u."telefono", u."activo", u."createdAt" AS "registradoEn", '
            # Solo si el bloqueo sigue vigente: lo decide la base, no el reloj de cada pantalla.
            """CASE WHEN u."bloqueadoHasta" > now() AT TIME ZONE 'UTC' THEN u."bloqueadoHasta" END AS "bloqueadoHasta", """
            'v."id" AS "vehiculoId", v."placa", v."estado" AS "estadoVehiculo", v."capacidadKg", '
            '(SELECT count(*) FROM "Ruta" r WHERE r."vehiculoId" = v."id")::int AS "rutas", '
            '(SELECT max(r."salidaProgramada") FROM "Ruta" r WHERE r."vehiculoId" = v."id") AS "ultimaRuta" '
            'FROM "Usuario" u LEFT JOIN "Vehiculo" v ON v."id" = u."vehiculoAsignadoId" '
            'WHERE u."autogestionado" ORDER BY u."activo" DESC, u."createdAt" DESC'
        )
        return cur.fetchall()


@router.get("/codigo-registro", response_model=CodigoRegistro)
def leer_codigo_registro():
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            'SELECT c."valor", c."actualizadoEn", u."nombre" AS "actualizadoPor" FROM "Configuracion" c '
            'LEFT JOIN "Usuario" u ON u."id" = c."actualizadoPorId" WHERE c."clave" = %s',
            (CLAVE_CODIGO,),
        )
        fila = cur.fetchone()
    if not fila or not isinstance(fila["valor"], str):
        return {"codigo": None}
    return {"codigo": fila["valor"], "actualizadoEn": fila["actualizadoEn"], "actualizadoPor": fila["actualizadoPor"]}


@router.put("/codigo-registro", response_model=CodigoRegistro)
def cambiar_codigo_registro(data: CodigoRegistroUpdate, usuario: dict = Depends(requiere_rol("ADMIN"))):
    """Cambiarlo no afecta a los ya registrados: el codigo solo sirve para
    crear la cuenta."""
    with get_connection() as conn, conn.cursor() as cur:
        try:
            cfg.guardar_texto(cur, CLAVE_CODIGO, data.codigo, usuario["id"])
        except ValueError as e:
            raise HTTPException(422, str(e)) from e
        conn.commit()
    return leer_codigo_registro()


@router.post("/{usuario_id}/baja", status_code=204)
def dar_de_baja(usuario_id: str):
    with get_connection() as conn, conn.cursor() as cur:
        mt.dar_de_baja(cur, mt.obtener(cur, usuario_id))
        conn.commit()


@router.post("/{usuario_id}/reactivar", status_code=204)
def reactivar(usuario_id: str):
    with get_connection() as conn, conn.cursor() as cur:
        mt.reactivar(cur, mt.obtener(cur, usuario_id))
        conn.commit()


@router.post("/{usuario_id}/restablecer-pin", response_model=PinRestablecido)
def restablecer_pin(usuario_id: str):
    """Devuelve el PIN nuevo una sola vez, para dictarselo al motorizado."""
    with get_connection() as conn, conn.cursor() as cur:
        pin = mt.restablecer_pin(cur, mt.obtener(cur, usuario_id))
        conn.commit()
    return {"pin": pin}


@router.delete("/{usuario_id}", status_code=204)
def eliminar(usuario_id: str):
    """Solo sin historial (un registro de prueba o duplicado); con rutas o
    pagos se da de baja."""
    with get_connection() as conn, conn.cursor() as cur:
        mt.eliminar(cur, mt.obtener(cur, usuario_id))
        conn.commit()
