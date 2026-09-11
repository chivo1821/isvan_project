import uuid

from fastapi import APIRouter, Depends, HTTPException

from app.core.auth import get_current_user, hash_password, requiere_rol, verify_password
from app.core.db import get_connection
from app.core.permisos import es_repartidor, es_vendedor
from app.schemas import (
    AsignarRutasVentaRequest,
    AsignarVehiculoRequest,
    CambiarPasswordRequest,
    ResetPasswordRequest,
    RutaVenta,
    Usuario,
    UsuarioCreate,
)

router = APIRouter(prefix="/usuarios", tags=["usuarios"])


@router.get("", response_model=list[Usuario])
def listar_usuarios(usuario: dict = Depends(get_current_user)):
    """Un REPARTIDOR o un VENDEDOR no ve el directorio del equipo: solo su
    propia ficha (que es lo unico que su pantalla necesita)."""
    with get_connection() as conn, conn.cursor() as cur:
        if es_repartidor(usuario) or es_vendedor(usuario):
            cur.execute('SELECT * FROM "Usuario" WHERE "id" = %s', (usuario["id"],))
        else:
            cur.execute('SELECT * FROM "Usuario" ORDER BY "nombre"')
        return cur.fetchall()


@router.post("", response_model=Usuario, status_code=201, dependencies=[Depends(requiere_rol("ADMIN"))])
def crear_usuario(data: UsuarioCreate):
    with get_connection() as conn, conn.cursor() as cur:
        usuario_id = f"usr-{uuid.uuid4().hex[:10]}"
        # El vehiculo solo tiene sentido para un repartidor; para cualquier
        # otro rol se ignora aunque venga en el request.
        vehiculo_id = data.vehiculoAsignadoId if data.rol == "REPARTIDOR" else None
        cur.execute(
            'INSERT INTO "Usuario" ("id", "nombre", "email", "passwordHash", "rol", "activo", "vehiculoAsignadoId") '
            "VALUES (%s, %s, %s, %s, %s, true, %s) RETURNING *",
            (usuario_id, data.nombre, data.email, hash_password(data.password), data.rol, vehiculo_id),
        )
        row = cur.fetchone()
        conn.commit()
        return row


@router.patch("/{usuario_id}/password", status_code=204)
def cambiar_password(
    usuario_id: str,
    data: CambiarPasswordRequest,
    usuario_actual: dict = Depends(get_current_user),
):
    """Autoservicio: cada quien cambia solo su propia contraseña, y debe
    confirmar la actual."""
    if usuario_actual["id"] != usuario_id:
        raise HTTPException(403, "Solo puedes cambiar tu propia contraseña")

    with get_connection() as conn, conn.cursor() as cur:
        cur.execute('SELECT "passwordHash" FROM "Usuario" WHERE "id" = %s', (usuario_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Usuario no encontrado")
        if not verify_password(data.passwordActual, row["passwordHash"]):
            raise HTTPException(401, "La contraseña actual no es correcta")

        cur.execute(
            'UPDATE "Usuario" SET "passwordHash" = %s WHERE "id" = %s',
            (hash_password(data.passwordNueva), usuario_id),
        )
        conn.commit()


@router.post(
    "/{usuario_id}/reset-password",
    status_code=204,
    dependencies=[Depends(requiere_rol("ADMIN"))],
)
def resetear_password(usuario_id: str, data: ResetPasswordRequest):
    """Solo ADMIN: sustituye a un flujo de "olvidé mi contraseña" por
    correo — un administrador resetea a un colega bloqueado directamente."""
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            'UPDATE "Usuario" SET "passwordHash" = %s WHERE "id" = %s RETURNING "id"',
            (hash_password(data.passwordNueva), usuario_id),
        )
        if not cur.fetchone():
            raise HTTPException(404, "Usuario no encontrado")
        conn.commit()


@router.patch(
    "/{usuario_id}/vehiculo",
    response_model=Usuario,
    # ADMIN y DESPACHOS: los choferes cambian de vehiculo en el dia a dia y
    # quien coordina los despachos es quien lo resuelve (ver Vehiculos >
    # Choferes). Solo afecta a usuarios REPARTIDOR, validado abajo.
    dependencies=[Depends(requiere_rol("DESPACHOS"))],
)
def asignar_vehiculo(usuario_id: str, data: AsignarVehiculoRequest):
    """Asigna (o quita) el vehiculo que maneja un repartidor. Es lo que
    define que ruta puede ver: la de ese vehiculo y ninguna otra.

    Un chofer por vehiculo: si ese vehiculo ya lo tenia otro repartidor, ese
    queda sin vehiculo. Con dos, los dos verian la misma ruta y no se sabria
    quien la maneja."""
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute('SELECT "rol" FROM "Usuario" WHERE "id" = %s', (usuario_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Usuario no encontrado")
        if row["rol"] != "REPARTIDOR":
            raise HTTPException(400, "Solo un usuario con rol REPARTIDOR puede tener un vehiculo asignado")

        if data.vehiculoAsignadoId:
            cur.execute('SELECT 1 FROM "Vehiculo" WHERE "id" = %s', (data.vehiculoAsignadoId,))
            if not cur.fetchone():
                raise HTTPException(404, "Vehiculo no encontrado")
            cur.execute(
                'UPDATE "Usuario" SET "vehiculoAsignadoId" = NULL '
                'WHERE "vehiculoAsignadoId" = %s AND "id" <> %s AND "rol" = \'REPARTIDOR\'',
                (data.vehiculoAsignadoId, usuario_id),
            )

        cur.execute(
            'UPDATE "Usuario" SET "vehiculoAsignadoId" = %s WHERE "id" = %s RETURNING *',
            (data.vehiculoAsignadoId, usuario_id),
        )
        actualizado = cur.fetchone()
        conn.commit()
        return actualizado


@router.get(
    "/{usuario_id}/rutas-venta",
    response_model=list[RutaVenta],
    dependencies=[Depends(requiere_rol("ADMIN"))],
)
def listar_rutas_venta(usuario_id: str):
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            'SELECT "empresa", "ruta" FROM "VendedorRuta" WHERE "usuarioId" = %s ORDER BY "empresa", "ruta"',
            (usuario_id,),
        )
        return cur.fetchall()


@router.put(
    "/{usuario_id}/rutas-venta",
    response_model=list[RutaVenta],
    dependencies=[Depends(requiere_rol("ADMIN"))],
)
def asignar_rutas_venta(usuario_id: str, data: AsignarRutasVentaRequest):
    """Reemplaza las rutas de venta de un VENDEDOR. Son las del sistema de
    ventas (R1..R8, 10, 11...): de ahi salen los clientes que tiene que
    visitar y los despachos que puede ver (ver app/api/vendedor.py)."""
    pedidas = sorted({(r.empresa, r.ruta.strip().upper()) for r in data.rutas if r.ruta.strip()})
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute('SELECT "rol" FROM "Usuario" WHERE "id" = %s', (usuario_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Usuario no encontrado")
        if row["rol"] != "VENDEDOR":
            raise HTTPException(400, "Solo un usuario con rol VENDEDOR puede tener rutas de venta")

        cur.execute('SELECT DISTINCT "empresa", "ruta" FROM "VentaCliente"')
        existentes = {(r["empresa"], r["ruta"]) for r in cur.fetchall()}
        desconocidas = [f"{ruta} ({empresa})" for empresa, ruta in pedidas if (empresa, ruta) not in existentes]
        if desconocidas:
            raise HTTPException(
                400,
                f'Estas rutas no aparecen en las ventas cargadas: {", ".join(desconocidas)}. '
                "Las rutas salen de la carga de ventas del modulo de indicadores.",
            )

        cur.execute('DELETE FROM "VendedorRuta" WHERE "usuarioId" = %s', (usuario_id,))
        cur.executemany(
            'INSERT INTO "VendedorRuta" ("id", "usuarioId", "empresa", "ruta") VALUES (%s, %s, %s, %s)',
            [(f"vr-{uuid.uuid4().hex[:10]}", usuario_id, empresa, ruta) for empresa, ruta in pedidas],
        )
        conn.commit()
    return [{"empresa": empresa, "ruta": ruta} for empresa, ruta in pedidas]
