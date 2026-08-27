import uuid

from fastapi import APIRouter, Depends, HTTPException

from app.core.auth import get_current_user, hash_password, requiere_rol, verify_password
from app.core.db import get_connection
from app.schemas import CambiarPasswordRequest, ResetPasswordRequest, Usuario, UsuarioCreate

router = APIRouter(prefix="/usuarios", tags=["usuarios"])


@router.get("", response_model=list[Usuario])
def listar_usuarios():
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute('SELECT * FROM "Usuario" ORDER BY "nombre"')
        return cur.fetchall()


@router.post("", response_model=Usuario, status_code=201, dependencies=[Depends(requiere_rol("ADMIN"))])
def crear_usuario(data: UsuarioCreate):
    with get_connection() as conn, conn.cursor() as cur:
        usuario_id = f"usr-{uuid.uuid4().hex[:10]}"
        cur.execute(
            'INSERT INTO "Usuario" ("id", "nombre", "email", "passwordHash", "rol", "activo") '
            "VALUES (%s, %s, %s, %s, %s, true) RETURNING *",
            (usuario_id, data.nombre, data.email, hash_password(data.password), data.rol),
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
