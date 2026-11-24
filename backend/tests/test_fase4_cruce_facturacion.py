"""Fase 4.1: Freno cruce Excel vs Facturacion (SISTEMA).

Verifica:
1. _validar() y /indicadores/cargas/preview detectan fechas con ventas
   vigentes de VentaCarga.origen = 'SISTEMA' y reportan fechasFacturadasEnSistema.
2. confirmar_carga() rechaza con HTTP 409 si alguna fecha de la carga Excel
   solapa con ventas de origen = 'SISTEMA', dejando intactas tanto las filas
   SISTEMA como la carga pendiente.
3. confirmar_carga() confirma normalmente en fechas sin solape y conserva
   intactas las ventas SISTEMA de otras fechas.
4. El UPDATE "Venta" SET "reemplazadaPorCargaId" blinda c."origen" <> 'SISTEMA'.
"""

from __future__ import annotations

import contextlib
import io
import uuid
from datetime import date

import openpyxl
from psycopg.types.json import Jsonb

from app.api import indicadores
from app.services.ventas_import import ExtractoVentas, FilaVenta


def _excel_extracto(filas: list[tuple[date, str, str, str, int, float, float]]) -> bytes:
    """Construye un .xlsx valido con el formato de extracto de ventas.

    Cada tupla: (fecha, cod_cliente, num_doc, cod_tipo_doc, cod_producto, monto_bs, monto_usd)
    """
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "data"
    ws.append([
        "Ruta", "Cod Cte", "Cliente", "Cod Producto", "Producto", "Grupo",
        "Num Doc", "Fecha", "Cajas", "Und", "Litros", "Bolivares", "Divisas",
        "Tp Doc", "Tipo de Cliente",
    ])
    for fecha, cod_cte, num_doc, tp_doc, cod_prod, bs, usd in filas:
        ws.append([
            "R1", cod_cte, f"Cliente {cod_cte}", cod_prod, f"Producto {cod_prod}",
            "HELADOS", num_doc, fecha.isoformat(), 2.0, 24, 12.0, bs, usd,
            tp_doc, "TRADICIONAL",
        ])
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _asegurar_carga_sistema(db, empresa: str, usuario_id: str, desde: date, hasta: date) -> str:
    carga_id = f"carga-sistema-{empresa.lower()}"
    db.execute(
        'INSERT INTO "VentaCarga" ("id", "empresa", "archivo", "periodoDesde", "periodoHasta", '
        '"filas", "estado", "subidaPorId", "confirmadaEn", "resumen", "dimensiones", "origen") '
        "VALUES (%s, %s, 'Sistema administrativo', %s, %s, 0, 'CONFIRMADA', %s, now(), '{}', '{}', 'SISTEMA') "
        'ON CONFLICT ("id") DO UPDATE SET '
        '"periodoDesde" = LEAST("VentaCarga"."periodoDesde", EXCLUDED."periodoDesde"), '
        '"periodoHasta" = GREATEST("VentaCarga"."periodoHasta", EXCLUDED."periodoHasta")',
        (carga_id, empresa, desde, hasta, usuario_id),
    )
    return carga_id


def _crear_carga_extracto(
    db,
    empresa: str,
    usuario_id: str,
    *,
    estado: str = "PENDIENTE",
    desde: date,
    hasta: date,
) -> str:
    carga_id = f"vcarga-{uuid.uuid4().hex[:10]}"
    db.execute(
        'INSERT INTO "VentaCarga" ("id", "empresa", "archivo", "periodoDesde", "periodoHasta", '
        '"filas", "estado", "subidaPorId", "confirmadaEn", "resumen", "dimensiones", "origen") '
        "VALUES (%s, %s, 'extracto.xlsx', %s, %s, 0, %s, %s, "
        "CASE WHEN %s = 'CONFIRMADA' THEN now() ELSE NULL END, "
        "'{}', %s, 'EXTRACTO')",
        (
            carga_id, empresa, desde, hasta, estado, usuario_id, estado,
            Jsonb({"clientes": [], "productos": []}),
        ),
    )
    return carga_id


def _insertar_venta(
    db,
    *,
    empresa: str,
    carga_id: str,
    fecha: date,
    num_doc: str | None = None,
    cod_tipo_doc: str = "FA",
    codigo_cliente: str = "CLI-CRUCE-1",
    codigo_producto: int = 940001,
    monto_usd: float = 50.0,
) -> int:
    doc = num_doc or f"D-{uuid.uuid4().hex[:6]}"
    cur = db.execute(
        'INSERT INTO "Venta" ("empresa", "cargaId", "fecha", "numDoc", "codTipoDoc", "tipoMovimiento", '
        '"codigoCliente", "codigoProducto", "cajas", "unidades", "litros", "montoBs", "montoUsd") '
        "VALUES (%s, %s, %s, %s, %s, 'VENTA', %s, %s, 2, 24, 12, 2500, %s) RETURNING id",
        (empresa, carga_id, fecha, doc, cod_tipo_doc, codigo_cliente, codigo_producto, monto_usd),
    )
    return cur.fetchone()["id"]


def test_preview_y_validar_detectan_fechas_facturadas_en_sistema(cliente_api, usuario, db):
    admin = usuario()
    carga_sis = _asegurar_carga_sistema(db, "TRALOG", admin["id"], date(2027, 1, 10), date(2027, 1, 12))
    _insertar_venta(db, empresa="TRALOG", carga_id=carga_sis, fecha=date(2027, 1, 10), num_doc="000101", cod_tipo_doc="FA")
    _insertar_venta(db, empresa="TRALOG", carga_id=carga_sis, fecha=date(2027, 1, 10), num_doc="000102", cod_tipo_doc="NE")
    _insertar_venta(db, empresa="TRALOG", carga_id=carga_sis, fecha=date(2027, 1, 12), num_doc="000103", cod_tipo_doc="FA")
    db.commit()

    api = cliente_api(admin)
    xlsx_solapa = _excel_extracto([
        (date(2027, 1, 10), "CLI-C1", "9001", "FA", 940001, 2000.0, 40.0),
        (date(2027, 1, 11), "CLI-C1", "9002", "FA", 940001, 2000.0, 40.0),
        (date(2027, 1, 12), "CLI-C1", "9003", "FA", 940001, 2000.0, 40.0),
    ])
    r = api.post(
        "/indicadores/cargas/preview",
        data={"empresa": "TRALOG"},
        files={
            "archivo": (
                "enero_solapa.xlsx",
                xlsx_solapa,
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        },
    )
    assert r.status_code == 200, r.text
    resumen = r.json()["resumen"]
    assert resumen["fechasFacturadasEnSistema"] == {
        "fechas": ["2027-01-10", "2027-01-12"],
        "desde": "2027-01-10",
        "hasta": "2027-01-12",
        "documentos": 3,
        "filas": 3,
    }

    xlsx_limpio = _excel_extracto([
        (date(2027, 1, 15), "CLI-C1", "9004", "FA", 940001, 2000.0, 40.0),
    ])
    r2 = api.post(
        "/indicadores/cargas/preview",
        data={"empresa": "TRALOG"},
        files={
            "archivo": (
                "enero_limpio.xlsx",
                xlsx_limpio,
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        },
    )
    assert r2.status_code == 200, r2.text
    assert r2.json()["resumen"]["fechasFacturadasEnSistema"] is None


def test_validar_filtra_por_empresa_y_vigencia_sistema(usuario, db):
    admin = usuario()
    carga_isvan = _asegurar_carga_sistema(db, "ISVAN", admin["id"], date(2027, 1, 18), date(2027, 1, 18))
    _insertar_venta(db, empresa="ISVAN", carga_id=carga_isvan, fecha=date(2027, 1, 18), num_doc="ISV-1")
    db.commit()

    extracto = ExtractoVentas(
        hoja="data",
        otras_hojas_con_formato=[],
        filas=[
            FilaVenta(
                fila=2,
                fecha=date(2027, 1, 18),
                num_doc="EXT-1",
                cod_tipo_doc="FA",
                tipo_movimiento="VENTA",
                codigo_cliente="CLI-C2",
                codigo_producto=940002,
                cajas=1.0,
                unidades=12,
                litros=6.0,
                monto_bs=1000.0,
                monto_usd=20.0,
            )
        ],
        errores=[],
        clientes={"CLI-C2": {"nombre": "Cliente C2", "tipo": "TRADICIONAL", "ruta": "R1", "listaPrecio": None}},
        productos={
            940002: {
                "nombre": "Producto 2",
                "grupo": "HELADOS",
                "codigoProveedor": None,
                "unidadesPorCaja": 12,
                "litrosPorUnidad": 0.5,
                "costoCajaUsd": 10.0,
            }
        },
        fuente_costo=None,
        con_encabezado=True,
        columnas=[],
    )
    with db.cursor() as cur:
        res_tralog = indicadores._validar(cur, "TRALOG", extracto)
        res_isvan = indicadores._validar(cur, "ISVAN", extracto)

    assert res_tralog["fechasFacturadasEnSistema"] is None
    assert res_isvan["fechasFacturadasEnSistema"] == {
        "fechas": ["2027-01-18"],
        "desde": "2027-01-18",
        "hasta": "2027-01-18",
        "documentos": 1,
        "filas": 1,
    }


def test_confirmar_carga_rechaza_409_con_solape_sistema_sin_modificar_bd(cliente_api, usuario, db):
    admin = usuario()
    carga_sis = _asegurar_carga_sistema(db, "TRALOG", admin["id"], date(2027, 1, 20), date(2027, 1, 21))
    sis_v1 = _insertar_venta(db, empresa="TRALOG", carga_id=carga_sis, fecha=date(2027, 1, 20), num_doc="SIS-20")
    sis_v2 = _insertar_venta(db, empresa="TRALOG", carga_id=carga_sis, fecha=date(2027, 1, 21), num_doc="SIS-21")

    carga_previa = _crear_carga_extracto(
        db, "TRALOG", admin["id"], estado="CONFIRMADA", desde=date(2027, 1, 22), hasta=date(2027, 1, 22)
    )
    prev_v = _insertar_venta(db, empresa="TRALOG", carga_id=carga_previa, fecha=date(2027, 1, 22), num_doc="EXT-22")

    carga_pendiente = _crear_carga_extracto(
        db, "TRALOG", admin["id"], estado="PENDIENTE", desde=date(2027, 1, 20), hasta=date(2027, 1, 22)
    )
    _insertar_venta(db, empresa="TRALOG", carga_id=carga_pendiente, fecha=date(2027, 1, 20), num_doc="P-20")
    _insertar_venta(db, empresa="TRALOG", carga_id=carga_pendiente, fecha=date(2027, 1, 21), num_doc="P-21")
    _insertar_venta(db, empresa="TRALOG", carga_id=carga_pendiente, fecha=date(2027, 1, 22), num_doc="P-22")
    db.commit()

    r = cliente_api(admin).post(f"/indicadores/cargas/{carga_pendiente}/confirmar")
    assert r.status_code == 409, r.text
    detail = r.json()["detail"]
    assert "2027-01-20" in detail
    assert "2027-01-21" in detail

    filas_sis = db.execute(
        'SELECT "id", "reemplazadaPorCargaId" FROM "Venta" WHERE "id" = ANY(%s)',
        ([sis_v1, sis_v2],),
    ).fetchall()
    assert all(f["reemplazadaPorCargaId"] is None for f in filas_sis)

    fila_prev = db.execute(
        'SELECT "reemplazadaPorCargaId" FROM "Venta" WHERE "id" = %s', (prev_v,)
    ).fetchone()
    assert fila_prev["reemplazadaPorCargaId"] is None

    carga_row = db.execute(
        'SELECT "estado", "confirmadaEn" FROM "VentaCarga" WHERE "id" = %s', (carga_pendiente,)
    ).fetchone()
    assert carga_row["estado"] == "PENDIENTE"
    assert carga_row["confirmadaEn"] is None


def test_confirmar_carga_sin_solape_confirma_y_no_toca_sistema_de_otras_fechas(cliente_api, usuario, db):
    admin = usuario()
    carga_sis = _asegurar_carga_sistema(db, "ISVAN", admin["id"], date(2027, 2, 1), date(2027, 2, 1))
    sis_v = _insertar_venta(db, empresa="ISVAN", carga_id=carga_sis, fecha=date(2027, 2, 1), num_doc="SIS-FEB1")

    carga_previa = _crear_carga_extracto(
        db, "ISVAN", admin["id"], estado="CONFIRMADA", desde=date(2027, 2, 2), hasta=date(2027, 2, 2)
    )
    prev_v = _insertar_venta(db, empresa="ISVAN", carga_id=carga_previa, fecha=date(2027, 2, 2), num_doc="EXT-FEB2")

    carga_nueva = _crear_carga_extracto(
        db, "ISVAN", admin["id"], estado="PENDIENTE", desde=date(2027, 2, 2), hasta=date(2027, 2, 3)
    )
    _insertar_venta(db, empresa="ISVAN", carga_id=carga_nueva, fecha=date(2027, 2, 2), num_doc="NEW-FEB2")
    _insertar_venta(db, empresa="ISVAN", carga_id=carga_nueva, fecha=date(2027, 2, 3), num_doc="NEW-FEB3")
    db.commit()

    r = cliente_api(admin).post(f"/indicadores/cargas/{carga_nueva}/confirmar")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["estado"] == "CONFIRMADA"
    assert body["filasReemplazadas"] == 1

    assert db.execute('SELECT "reemplazadaPorCargaId" FROM "Venta" WHERE "id" = %s', (prev_v,)).fetchone()[
        "reemplazadaPorCargaId"
    ] == carga_nueva
    assert db.execute('SELECT "reemplazadaPorCargaId" FROM "Venta" WHERE "id" = %s', (sis_v,)).fetchone()[
        "reemplazadaPorCargaId"
    ] is None


def test_update_reemplazo_blinda_origen_distinto_sistema(cliente_api, usuario, db, monkeypatch):
    """Verifica que la sentencia UPDATE en confirmar_carga incluye c."origen" <> 'SISTEMA'
    y que dicha clausula impide marcar filas SISTEMA incluso en la misma fecha."""
    admin = usuario()
    carga_previa = _crear_carga_extracto(
        db, "TRALOG", admin["id"], estado="CONFIRMADA", desde=date(2027, 2, 10), hasta=date(2027, 2, 10)
    )
    prev_v = _insertar_venta(db, empresa="TRALOG", carga_id=carga_previa, fecha=date(2027, 2, 10), num_doc="EXT-F10")

    carga_nueva = _crear_carga_extracto(
        db, "TRALOG", admin["id"], estado="PENDIENTE", desde=date(2027, 2, 10), hasta=date(2027, 2, 10)
    )
    _insertar_venta(db, empresa="TRALOG", carga_id=carga_nueva, fecha=date(2027, 2, 10), num_doc="NEW-F10")
    db.commit()

    sentencias: list[str] = []
    get_conn_real = indicadores.get_connection

    class _CursorEspia:
        def __init__(self, cur):
            self._cur = cur

        def execute(self, query, params=None):
            if isinstance(query, str):
                sentencias.append(query)
            return self._cur.execute(query, params)

        def __getattr__(self, name):
            return getattr(self._cur, name)

        def __enter__(self):
            self._cur.__enter__()
            return self

        def __exit__(self, *args):
            return self._cur.__exit__(*args)

    class _ConnEspia:
        def __init__(self, conn):
            self._conn = conn

        def cursor(self, *args, **kwargs):
            return _CursorEspia(self._conn.cursor(*args, **kwargs))

        def __getattr__(self, name):
            return getattr(self._conn, name)

    @contextlib.contextmanager
    def _get_connection_espia():
        with get_conn_real() as conn:
            yield _ConnEspia(conn)

    monkeypatch.setattr(indicadores, "get_connection", _get_connection_espia)

    r = cliente_api(admin).post(f"/indicadores/cargas/{carga_nueva}/confirmar")
    assert r.status_code == 200, r.text

    updates = [s for s in sentencias if 'UPDATE "Venta" v SET "reemplazadaPorCargaId"' in s]
    assert len(updates) == 1
    update_sql = updates[0]
    assert "c.\"origen\" <> 'SISTEMA'" in update_sql
    assert db.execute('SELECT "reemplazadaPorCargaId" FROM "Venta" WHERE "id" = %s', (prev_v,)).fetchone()[
        "reemplazadaPorCargaId"
    ] == carga_nueva

    # Prueba directa de la clausula SQL sobre una fila SISTEMA en la misma fecha:
    # aunque existiera una fila SISTEMA en esa fecha, el UPDATE con origen <> 'SISTEMA'
    # no la marca como reemplazada.
    carga_sis = _asegurar_carga_sistema(db, "TRALOG", admin["id"], date(2027, 2, 15), date(2027, 2, 15))
    sis_v = _insertar_venta(db, empresa="TRALOG", carga_id=carga_sis, fecha=date(2027, 2, 15), num_doc="SIS-F15")
    carga_ext_15 = _crear_carga_extracto(
        db, "TRALOG", admin["id"], estado="PENDIENTE", desde=date(2027, 2, 15), hasta=date(2027, 2, 15)
    )
    _insertar_venta(db, empresa="TRALOG", carga_id=carga_ext_15, fecha=date(2027, 2, 15), num_doc="EXT-F15")
    db.commit()

    res_cur = db.execute(update_sql, {"id": carga_ext_15, "empresa": "TRALOG"})
    assert res_cur.rowcount == 0
    assert db.execute('SELECT "reemplazadaPorCargaId" FROM "Venta" WHERE "id" = %s', (sis_v,)).fetchone()[
        "reemplazadaPorCargaId"
    ] is None
    db.rollback()
