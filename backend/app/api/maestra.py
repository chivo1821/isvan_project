"""Carga de la maestra de clientes por empresa (solo ADMIN).

Dos pasos, como la carga de ventas: primero se analiza el archivo (resumen y
contraste contra lo facturado) y solo despues se guarda. La maestra es una
FOTO: al guardarla, la carga nueva pasa a ser la vigente de su empresa y las
consultas (por censar, contraste con el censo) miran siempre la ultima.

Va bajo /censo/maestra pero en su propio router, que no esta abierto al
VENDEDOR (ver ROUTERS_POR_ROL en app/main.py). Se registra antes que el del
censo para que /censo/{censo_id} no se quede con /censo/maestra.

El lector esta en app/services/maestra_import.py.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from psycopg.types.json import Jsonb

from app.core.auth import requiere_rol
from app.core.db import get_connection
from app.core.fechas import ahora_utc
from app.schemas import en_utc
from app.services import maestra_import as mi

router = APIRouter(prefix="/censo/maestra", tags=["censo"])

# El limite de Vercel por request; el archivo real pesa ~0,1 MB.
TAMANO_MAXIMO_BYTES = 4_500_000

_COLUMNAS = (
    '"id", "cargaId", "empresa", "codigo", "razonSocial", "ruta", "diaVisita", "frecuencia", "secuencia", '
    '"direccion", "condicion", "tipoCliente", "listaPrecio", "zona", "observacion", '
    '"activoCodigo", "activoTipo", "activoMarca"'
)


def _validar_empresa(empresa: str) -> None:
    if empresa not in mi.EMPRESAS:
        raise HTTPException(400, "La empresa tiene que ser ISVAN o TRALOG")


def _leer(empresa: str, archivo: UploadFile) -> mi.Maestra:
    _validar_empresa(empresa)
    contenido = archivo.file.read()
    if len(contenido) > TAMANO_MAXIMO_BYTES:
        raise HTTPException(413, "El archivo pesa más de 4,5 MB")
    return mi.leer_maestra(contenido, archivo.filename or "", empresa)


def carga_vigente(cur, empresa: str) -> dict | None:
    """La ultima maestra cargada de esa empresa: es la que vale."""
    cur.execute(
        'SELECT c."id", c."archivo", c."filas", c."resumen", c."subidaEn", u."nombre" AS "subidaPor" '
        'FROM "MaestraCarga" c LEFT JOIN "Usuario" u ON u."id" = c."subidaPorId" '
        'WHERE c."empresa" = %s ORDER BY c."subidaEn" DESC LIMIT 1',
        (empresa,),
    )
    carga = cur.fetchone()
    if carga:
        carga["subidaEn"] = en_utc(carga["subidaEn"])
    return carga


def recalcular_en_maestra(cur, empresa: str) -> int:
    """Al cambiar la maestra, cada cliente censado vuelve a mirar si esta en
    la vigente. Devuelve cuantos cambiaron."""
    cur.execute(
        """
        UPDATE "CensoCliente" cc SET "enMaestra" = n."esta"
        FROM (
            SELECT cc2."id", EXISTS (
                SELECT 1 FROM "MaestraCliente" mc
                WHERE mc."cargaId" = (
                    SELECT "id" FROM "MaestraCarga" WHERE "empresa" = %(e)s ORDER BY "subidaEn" DESC LIMIT 1
                ) AND mc."codigo" = cc2."codigo"
            ) AS "esta"
            FROM "CensoCliente" cc2 WHERE cc2."empresa" = %(e)s
        ) n
        WHERE cc."id" = n."id" AND cc."enMaestra" IS DISTINCT FROM n."esta"
        """,
        {"e": empresa},
    )
    return cur.rowcount


@router.get("", dependencies=[Depends(requiere_rol("ADMIN"))])
def maestras_vigentes():
    """La maestra vigente de cada empresa (null si nunca se cargo)."""
    with get_connection() as conn, conn.cursor() as cur:
        return {e: carga_vigente(cur, e) for e in mi.EMPRESAS}


@router.post("/preview", dependencies=[Depends(requiere_rol("ADMIN"))])
def analizar(empresa: str = Form(...), archivo: UploadFile = File(...)):
    """Analiza el archivo sin guardar nada: resumen del padron y contraste
    contra los clientes que facturaron."""
    maestra = _leer(empresa, archivo)
    with get_connection() as conn, conn.cursor() as cur:
        return {
            "resumen": mi.resumen_de(maestra),
            "contraste": mi.contraste_con_ventas(cur, empresa, maestra),
            "vigente": carga_vigente(cur, empresa),
        }


@router.post("", status_code=201)
def guardar(
    empresa: str = Form(...),
    archivo: UploadFile = File(...),
    usuario: dict = Depends(requiere_rol("ADMIN")),
):
    """Guarda la maestra: pasa a ser la vigente de su empresa. Las anteriores
    quedan como historico (ocupan poco: ~900 filas por carga)."""
    maestra = _leer(empresa, archivo)
    resumen = mi.resumen_de(maestra)
    carga_id = f"maes-{uuid.uuid4().hex[:12]}"

    with get_connection() as conn, conn.cursor() as cur:
        contraste = mi.contraste_con_ventas(cur, empresa, maestra)
        cur.execute(
            'INSERT INTO "MaestraCarga" ("id", "empresa", "archivo", "filas", "resumen", "subidaEn", "subidaPorId") '
            "VALUES (%s, %s, %s, %s, %s, %s, %s)",
            (
                carga_id, empresa, archivo.filename or "maestra.xlsx", len(maestra.filas),
                Jsonb({**resumen, "contraste": contraste}), ahora_utc(), usuario["id"],
            ),
        )
        # Una sola sentencia para todas las filas: con la base en otra region
        # (Neon), una por fila serian cientos de idas y vueltas.
        with cur.copy(f'COPY "MaestraCliente" ({_COLUMNAS}) FROM STDIN') as copia:
            for f in maestra.filas:
                copia.write_row((
                    f"mcl-{uuid.uuid4().hex[:16]}", carga_id, empresa, f.codigo, f.razonSocial, f.ruta,
                    f.diaVisita, f.frecuencia, f.secuencia, f.direccion, f.condicion, f.tipoCliente,
                    f.listaPrecio, f.zona, f.observacion, f.activoCodigo, f.activoTipo, f.activoMarca,
                ))
        censos_actualizados = recalcular_en_maestra(cur, empresa)
        conn.commit()
        vigente = carga_vigente(cur, empresa)

    return {"carga": vigente, "resumen": resumen, "contraste": contraste, "censosActualizados": censos_actualizados}
