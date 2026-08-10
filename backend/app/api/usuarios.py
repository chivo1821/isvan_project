import uuid

from fastapi import APIRouter

from app.core.db import get_connection
from app.schemas import Usuario, UsuarioCreate

router = APIRouter(prefix="/usuarios", tags=["usuarios"])


@router.get("", response_model=list[Usuario])
def listar_usuarios():
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute('SELECT * FROM "Usuario" ORDER BY "nombre"')
        return cur.fetchall()


@router.post("", response_model=Usuario, status_code=201)
def crear_usuario(data: UsuarioCreate):
    with get_connection() as conn, conn.cursor() as cur:
        usuario_id = f"usr-{uuid.uuid4().hex[:10]}"
        cur.execute(
            'INSERT INTO "Usuario" ("id", "nombre", "email", "rol", "activo") '
            "VALUES (%s, %s, %s, %s, true) RETURNING *",
            (usuario_id, data.nombre, data.email, data.rol),
        )
        row = cur.fetchone()
        conn.commit()
        return row
