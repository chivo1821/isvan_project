import uuid

from fastapi import APIRouter, Depends, HTTPException

from app.core.auth import get_current_user, hash_password, requiere_rol, verify_password
from app.core.db import get_connection
from app.core.permisos import es_repartidor
from app.schemas import (
    AsignarVehiculoRequest,
    CambiarPasswordRequest,
    ResetPasswordRequest,
    Usuario,
    UsuarioCreate,
)

router = APIRouter(prefix="/usuarios", tags=["usuarios"])


@router.get("", response_model=list[Usuario])
def listar_usuarios(usuario: dict = Depends(get_current_user)):
    """Un REPARTIDOR no ve el directorio del equipo: solo su propia ficha
    (que es lo unico que su pantalla necesita)."""
    with get_connection() as conn, conn.cursor() as cur:
        if es_repartidor(usuario):
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
    dependencies=[Depends(requiere_rol("ADMIN"))],
)
def asignar_vehiculo(usuario_id: str, data: AsignarVehiculoRequest):
    """Asigna (o quita) el vehiculo que maneja un repartidor. Es lo que
    define que ruta puede ver: la de ese vehiculo y ninguna otra."""
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
            'UPDATE "Usuario" SET "vehiculoAsignadoId" = %s WHERE "id" = %s RETURNING *',
            (data.vehiculoAsignadoId, usuario_id),
        )
        actualizado = cur.fetchone()
        conn.commit()
        return actualizado
