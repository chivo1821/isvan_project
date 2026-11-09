"""Gastos por empresa (cargados desde Excel) y el resultado de las
operaciones: lo vendido menos su costo y menos los gastos. Solo ADMIN."""

from __future__ import annotations

import io
import uuid
from datetime import date

import openpyxl
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse

from app.core.auth import requiere_rol
from app.core.db import get_connection
from app.schemas import en_utc
from app.services import gastos as servicio

router = APIRouter(prefix="/gastos", tags=["gastos"], dependencies=[Depends(requiere_rol("ADMIN"))])

# El mismo limite del cuerpo de Vercel que el extracto de ventas.
TAMANO_MAXIMO_BYTES = 4_500_000
LIMITE_LISTA = 1000


def _empresas(empresa: str | None) -> list[str]:
    if empresa in (None, "", "TODAS"):
        return list(servicio.EMPRESAS)
    if empresa not in servicio.EMPRESAS:
        raise HTTPException(400, "Empresa invalida")
    return [empresa]


def _leer(cur, archivo: UploadFile, empresa: str | None, moneda: str) -> servicio.Lectura:
    if empresa and empresa not in servicio.EMPRESAS:
        raise HTTPException(400, "Empresa invalida")
    if moneda not in ("USD", "BS"):
        raise HTTPException(400, "Moneda invalida")
    contenido = archivo.file.read()
    if len(contenido) > TAMANO_MAXIMO_BYTES:
        raise HTTPException(413, f"El archivo pesa {len(contenido) / 1_000_000:.1f} MB y el maximo es 4.5 MB")
    try:
        return servicio.leer_excel(contenido, empresa or None, moneda, servicio.Tasas(cur))
    except ValueError as e:
        raise HTTPException(400, str(e)) from e


@router.post("/cargas/preview")
def analizar(
    archivo: UploadFile = File(...),
    empresa: str | None = Form(None),
    moneda: str = Form("USD"),
):
    """Lee el archivo y muestra lo que se cargaria, sin guardar nada. Los
    gastos son pocos: para confirmar se vuelve a mandar el mismo archivo."""
    with get_connection() as conn, conn.cursor() as cur:
        lectura = _leer(cur, archivo, empresa, moneda)
        return servicio.resumen_lectura(cur, lectura)


@router.post("/cargas")
def cargar(
    archivo: UploadFile = File(...),
    empresa: str | None = Form(None),
    moneda: str = Form("USD"),
    omitirDuplicados: bool = Form(False),
    usuario: dict = Depends(requiere_rol("ADMIN")),
):
    """Guarda los gastos: una carga por empresa del archivo."""
    with get_connection() as conn, conn.cursor() as cur:
        lectura = _leer(cur, archivo, empresa, moneda)
        resumen = servicio.resumen_lectura(cur, lectura)
        duplicados = set(resumen["duplicados"]) if omitirDuplicados else set()
        filas = [f for f in lectura.filas if f.fila not in duplicados]
        if not filas:
            raise HTTPException(400, "El archivo no trae ningun gasto para cargar")
        cargas = []
        for empresa_carga in sorted({f.empresa for f in filas}):
            propias = [f for f in filas if f.empresa == empresa_carga]
            carga_id = f"gcarga-{uuid.uuid4().hex[:10]}"
            cur.execute(
                'INSERT INTO "GastoCarga" ("id", "empresa", "archivo", "periodoDesde", "periodoHasta", "filas", '
                '"totalUsd", "subidaPorId") VALUES (%s, %s, %s, %s, %s, %s, %s, %s)',
                (
                    carga_id, empresa_carga, (archivo.filename or "gastos.xlsx")[:200],
                    min(f.fecha for f in propias), max(f.fecha for f in propias), len(propias),
                    sum(f.montoUsd for f in propias), usuario["id"],
                ),
            )
            with cur.copy(
                'COPY "Gasto" ("id", "cargaId", "empresa", "fecha", "categoria", "descripcion", "proveedor", '
                '"referencia", "montoUsd", "montoBs", "moneda", "tasa") FROM STDIN'
            ) as copy:
                for f in propias:
                    copy.write_row((
                        f"gasto-{uuid.uuid4().hex[:16]}", carga_id, f.empresa, f.fecha, f.categoria, f.descripcion,
                        f.proveedor, f.referencia, f.montoUsd, f.montoBs, f.moneda, f.tasa,
                    ))
            cargas.append(carga_id)
        conn.commit()
        return {"cargas": [_carga(cur, c) for c in cargas], "omitidos": len(lectura.filas) - len(filas),
                "problemas": len(lectura.problemas)}


def _carga(cur, carga_id: str) -> dict:
    cur.execute(
        'SELECT c."id", c."empresa"::text AS "empresa", c."archivo", c."periodoDesde", c."periodoHasta", c."filas", '
        'c."totalUsd", c."estado"::text AS "estado", c."subidaEn", c."revertidaEn", u."nombre" AS "subidaPor" '
        'FROM "GastoCarga" c LEFT JOIN "Usuario" u ON u."id" = c."subidaPorId" WHERE c."id" = %s',
        (carga_id,),
    )
    fila = cur.fetchone()
    if not fila:
        raise HTTPException(404, "Carga no encontrada")
    return _salida_carga(fila)


def _salida_carga(fila: dict) -> dict:
    return {**fila, "totalUsd": float(fila["totalUsd"]), "subidaEn": en_utc(fila["subidaEn"]),
            "revertidaEn": en_utc(fila["revertidaEn"]) if fila["revertidaEn"] else None}


@router.get("/cargas")
def cargas(empresa: str | None = Query(None)):
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            'SELECT c."id", c."empresa"::text AS "empresa", c."archivo", c."periodoDesde", c."periodoHasta", '
            'c."filas", c."totalUsd", c."estado"::text AS "estado", c."subidaEn", c."revertidaEn", '
            'u."nombre" AS "subidaPor" FROM "GastoCarga" c LEFT JOIN "Usuario" u ON u."id" = c."subidaPorId" '
            'WHERE c."empresa"::text = ANY(%s) ORDER BY c."subidaEn" DESC LIMIT 200',
            (_empresas(empresa),),
        )
        return [_salida_carga(f) for f in cur.fetchall()]


@router.post("/cargas/{carga_id}/revertir")
def revertir(carga_id: str):
    """La carga deja de contar; sus gastos se conservan por si hay que
    revisarla."""
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute('SELECT "estado"::text AS "estado" FROM "GastoCarga" WHERE "id" = %s FOR UPDATE', (carga_id,))
        fila = cur.fetchone()
        if not fila:
            raise HTTPException(404, "Carga no encontrada")
        if fila["estado"] != "CONFIRMADA":
            raise HTTPException(409, "Esta carga ya fue revertida")
        cur.execute(
            'UPDATE "GastoCarga" SET "estado" = \'REVERTIDA\', "revertidaEn" = now() WHERE "id" = %s', (carga_id,)
        )
        conn.commit()
        return _carga(cur, carga_id)


@router.get("")
def listar(
    desde: date = Query(...),
    hasta: date = Query(...),
    empresa: str | None = Query(None),
    categoria: str | None = Query(None),
):
    condiciones = ['g."empresa"::text = ANY(%(empresas)s)', 'g."fecha" BETWEEN %(desde)s AND %(hasta)s']
    params: dict = {"empresas": _empresas(empresa), "desde": desde, "hasta": hasta}
    if categoria:
        condiciones.append('g."categoria" = %(categoria)s')
        params["categoria"] = categoria
    donde = " AND ".join(condiciones)
    fuente = (
        'FROM "Gasto" g JOIN "GastoCarga" c ON c."id" = g."cargaId" AND c."estado" = \'CONFIRMADA\' '
        f"WHERE {donde}"
    )
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(f'SELECT COUNT(*) AS "n", COALESCE(SUM(g."montoUsd"), 0) AS "total" {fuente}', params)
        totales = cur.fetchone()
        cur.execute(
            'SELECT g."id", g."empresa"::text AS "empresa", g."fecha", g."categoria", g."descripcion", g."proveedor", '
            'g."referencia", g."montoUsd", g."montoBs", g."moneda", g."tasa", g."cargaId" '
            f'{fuente} ORDER BY g."fecha" DESC, g."montoUsd" DESC LIMIT {LIMITE_LISTA}',
            params,
        )
        filas = [
            {**f, "montoUsd": float(f["montoUsd"]),
             "montoBs": float(f["montoBs"]) if f["montoBs"] is not None else None,
             "tasa": float(f["tasa"]) if f["tasa"] is not None else None}
            for f in cur.fetchall()
        ]
        cur.execute(
            'SELECT DISTINCT g."categoria" FROM "Gasto" g JOIN "GastoCarga" c ON c."id" = g."cargaId" '
            'AND c."estado" = \'CONFIRMADA\' WHERE g."empresa"::text = ANY(%s) ORDER BY 1',
            (params["empresas"],),
        )
        categorias = [f["categoria"] for f in cur.fetchall()]
    return {"total": int(totales["n"]), "totalUsd": float(totales["total"]), "gastos": filas,
            "categorias": categorias, "limite": LIMITE_LISTA}


@router.get("/resultados")
def resultados(
    desde: date = Query(...),
    hasta: date = Query(...),
    empresa: str | None = Query(None),
):
    if hasta < desde:
        raise HTTPException(400, "El periodo esta al reves")
    with get_connection() as conn, conn.cursor() as cur:
        return servicio.resultados(cur, _empresas(empresa), desde, hasta)


@router.get("/plantilla")
def plantilla():
    """Un Excel de ejemplo con las columnas que reconoce el lector."""
    libro = openpyxl.Workbook()
    hoja = libro.active
    hoja.title = "gastos"
    hoja.append(["Fecha", "Empresa", "Categoría", "Descripción", "Proveedor", "Referencia", "Monto USD", "Monto Bs",
                 "Tasa"])
    hoja.append([date(2026, 11, 3), "ISVAN", "Nómina", "Quincena 1 de noviembre", "", "", 1250.00, None, None])
    hoja.append([date(2026, 11, 5), "ISVAN", "Combustible", "Gasoil camión 2", "Estación Las Mercedes", "F-1022",
                 None, 18500.00, None])
    hoja.append([date(2026, 11, 6), "TRALOG", "Alquiler", "Galpón", "Inversiones XYZ", "", 900.00, None, None])
    for columna, ancho in zip("ABCDEFGHI", (12, 10, 16, 32, 24, 12, 12, 12, 10)):
        hoja.column_dimensions[columna].width = ancho
    salida = io.BytesIO()
    libro.save(salida)
    salida.seek(0)
    return StreamingResponse(
        salida,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="plantilla_gastos.xlsx"'},
    )
