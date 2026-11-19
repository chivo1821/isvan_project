"""Costo historico por fila de venta (opcion A).

Cubre las tres piezas de la funcionalidad:

1. confirmar_carga sella en cada fila el costo que rige en ese momento.
2. Las consultas (SUMAS de indicadores_venta) usan el sello y solo caen al
   costo vigente del producto cuando la fila no lo tiene.
3. El backfill (scripts/sellar_costos_historicos.py) reproduce la linea de
   tiempo de cargas y listas y sella las ventas viejas.

Ojo: la base de pruebas es una por sesion y compartida entre tests, y una
carga confirmada REEMPLAZA a las anteriores en los dias que trae. Por eso
cada prueba usa fechas que ninguna otra toca.
"""

from __future__ import annotations

import importlib.util
import uuid
from datetime import date, datetime
from pathlib import Path

import pytest
from psycopg.types.json import Jsonb

from app.services import indicadores_venta as iv

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "sellar_costos_historicos.py"


def _modulo_backfill():
    espec = importlib.util.spec_from_file_location("sellar_costos_historicos", SCRIPT)
    modulo = importlib.util.module_from_spec(espec)
    espec.loader.exec_module(modulo)
    return modulo


def _crear_carga(db, usuario_id: str, *, estado: str = "PENDIENTE", confirmada_en: datetime | None = None,
                 productos: list[dict] | None = None) -> str:
    carga_id = f"vcar-{uuid.uuid4().hex[:10]}"
    db.execute(
        'INSERT INTO "VentaCarga" ("id", "empresa", "archivo", "periodoDesde", "periodoHasta", "filas", '
        '"estado", "subidaPorId", "confirmadaEn", "resumen", "dimensiones") '
        "VALUES (%s, 'TRALOG', 'extracto.xlsx', %s, %s, 0, %s, %s, %s, %s, %s)",
        (
            carga_id, date(2026, 9, 1), date(2026, 9, 30), estado, usuario_id, confirmada_en,
            Jsonb({}), Jsonb({"clientes": [], "productos": productos or []}),
        ),
    )
    return carga_id


def _crear_venta(db, carga_id: str, producto: int, *, cajas: str, monto: str = "100",
                 costo: float | None = None, fecha: date) -> int:
    cur = db.execute(
        'INSERT INTO "Venta" ("empresa", "cargaId", "fecha", "numDoc", "codTipoDoc", "tipoMovimiento", '
        '"codigoCliente", "codigoProducto", "cajas", "unidades", "litros", "montoBs", "montoUsd", '
        '"costoCajaUsd") '
        "VALUES ('TRALOG', %s, %s, %s, 'FA', 'VENTA', 'CLI-1', %s, %s, 10, 5, 1000, %s, %s) RETURNING id",
        (carga_id, fecha, f"F-{uuid.uuid4().hex[:6]}", producto, cajas, monto, costo),
    )
    return cur.fetchone()["id"]


def _crear_producto(db, codigo: int, costo: float | None) -> None:
    db.execute(
        'INSERT INTO "VentaProducto" ("id", "empresa", "codigo", "nombre", "grupo", "costoCajaUsd") '
        "VALUES (%s, 'TRALOG', %s, %s, 'HELADOS', %s) "
        'ON CONFLICT ("empresa", "codigo") DO UPDATE SET "costoCajaUsd" = EXCLUDED."costoCajaUsd"',
        (f"vprod-{uuid.uuid4().hex[:10]}", codigo, f"Producto {codigo}", costo),
    )


def _sello(db, venta_id: int) -> float | None:
    cur = db.execute('SELECT "costoCajaUsd" FROM "Venta" WHERE id = %s', (venta_id,))
    valor = cur.fetchone()["costoCajaUsd"]
    return float(valor) if valor is not None else None


# ---------- 1. El sello al confirmar ----------


def test_confirmar_sella_el_costo_que_trae_la_carga(cliente_api, usuario, db):
    admin = usuario()
    producto = 910001
    carga_id = _crear_carga(db, admin["id"], productos=[{
        "codigo": producto, "nombre": "Pote 1L", "grupo": "HELADOS", "codigoProveedor": None,
        "unidadesPorCaja": 12, "litrosPorUnidad": 1, "costoCajaUsd": 12.5,
    }])
    con_costo = _crear_venta(db, carga_id, producto, cajas="10", fecha=date(2026, 9, 10))
    sin_costo = _crear_venta(db, carga_id, 919999, cajas="5", fecha=date(2026, 9, 10))
    db.commit()

    r = cliente_api(admin).post(f"/indicadores/cargas/{carga_id}/confirmar")
    assert r.status_code == 200, r.text

    assert _sello(db, con_costo) == 12.5
    assert _sello(db, sin_costo) is None  # sin costo conocido: queda NULL y se reporta aparte
    cur = db.execute('SELECT "costoCajaUsd" FROM "VentaProducto" WHERE "empresa" = \'TRALOG\' AND "codigo" = %s',
                     (producto,))
    assert float(cur.fetchone()["costoCajaUsd"]) == 12.5


def test_confirmar_conserva_el_costo_previo_si_el_archivo_no_trae(cliente_api, usuario, db):
    admin = usuario()
    producto = 910002
    _crear_producto(db, producto, 8.25)
    # Extracto diario sin hoja de costos: costoCajaUsd None en la dimension.
    carga_id = _crear_carga(db, admin["id"], productos=[{
        "codigo": producto, "nombre": "Pote 1L", "grupo": "HELADOS", "codigoProveedor": None,
        "unidadesPorCaja": None, "litrosPorUnidad": None, "costoCajaUsd": None,
    }])
    venta_id = _crear_venta(db, carga_id, producto, cajas="4", fecha=date(2026, 9, 11))
    db.commit()

    r = cliente_api(admin).post(f"/indicadores/cargas/{carga_id}/confirmar")
    assert r.status_code == 200, r.text

    assert _sello(db, venta_id) == 8.25
    cur = db.execute('SELECT "costoCajaUsd" FROM "VentaProducto" WHERE "empresa" = \'TRALOG\' AND "codigo" = %s',
                     (producto,))
    assert float(cur.fetchone()["costoCajaUsd"]) == 8.25  # no se borro el vigente


# ---------- 2. Las consultas respetan el sello ----------


def test_calcular_usa_el_sello_y_cae_al_vigente_sin_el(usuario, db):
    admin = usuario()
    producto = 910003
    _crear_producto(db, producto, 99)
    carga_id = _crear_carga(db, admin["id"], estado="CONFIRMADA", confirmada_en=datetime(2026, 10, 31, 12))
    _crear_venta(db, carga_id, producto, cajas="5", costo=10, fecha=date(2026, 10, 15))  # 5 x 10 = 50
    _crear_venta(db, carga_id, producto, cajas="5", fecha=date(2026, 10, 15))            # 5 x 99 = 495
    db.commit()

    f = iv.Filtros(empresa="TRALOG", desde=date(2026, 10, 1), hasta=date(2026, 10, 31))
    with db.cursor() as cur:
        res = iv.calcular(cur, f)
    assert res is not None
    assert res["costo"] == pytest.approx(545)
    assert res["ventaSinCosto"] == 0  # el producto tiene costo vigente

    # Si el producto deja de tener costo vigente, la fila sellada sigue
    # contando y la otra pasa a reportarse como venta sin costo.
    _crear_producto(db, producto, None)
    db.commit()
    with db.cursor() as cur:
        res = iv.calcular(cur, f)
    assert res["costo"] == pytest.approx(50)
    assert res["ventaSinCosto"] == pytest.approx(100)


# ---------- 3. El backfill reproduce la linea de tiempo ----------


def test_backfill_sella_con_el_costo_de_cada_epoca(usuario, db):
    admin = usuario()
    producto = 910004
    desconocido = 920000
    _crear_producto(db, producto, 20)  # asi quedo el vigente despues de todo

    # Septiembre: la carga trae el costo 10.
    carga1 = _crear_carga(db, admin["id"], estado="CONFIRMADA", confirmada_en=datetime(2026, 9, 30, 12),
                          productos=[{"codigo": producto, "nombre": "Pote 1L", "grupo": "HELADOS",
                                      "codigoProveedor": None, "unidadesPorCaja": None,
                                      "litrosPorUnidad": None, "costoCajaUsd": 10}])
    venta1 = _crear_venta(db, carga1, producto, cajas="2", fecha=date(2026, 9, 20))
    # Octubre: sube una lista sola con el costo 20.
    db.execute(
        'INSERT INTO "ListaPrecioCarga" ("id", "empresa", "archivo", "productos", "subidaEn") '
        "VALUES (%s, 'TRALOG', 'lista_octubre.xlsx', %s, %s)",
        (f"vlist-{uuid.uuid4().hex[:10]}", Jsonb([{"codigo": producto, "nombre": "Pote 1L",
                                                   "grupo": "HELADOS", "costoCajaUsd": 20}]),
         datetime(2026, 10, 5, 12)),
    )
    # Noviembre: extracto sin hoja de costos; rige el de la lista de octubre.
    carga2 = _crear_carga(db, admin["id"], estado="CONFIRMADA", confirmada_en=datetime(2026, 11, 2, 12),
                          productos=[{"codigo": producto, "nombre": "Pote 1L", "grupo": "HELADOS",
                                      "codigoProveedor": None, "unidadesPorCaja": None,
                                      "litrosPorUnidad": None, "costoCajaUsd": None}])
    venta2 = _crear_venta(db, carga2, producto, cajas="3", fecha=date(2026, 11, 10))
    # Y un producto que nunca tuvo costo: debe quedar en NULL.
    venta3 = _crear_venta(db, carga2, desconocido, cajas="1", fecha=date(2026, 11, 10))
    db.commit()

    modulo = _modulo_backfill()
    with db.cursor() as cur:
        modulo.sellar_empresa(cur, "TRALOG")
    db.commit()

    assert _sello(db, venta1) == 10  # el de septiembre, aunque hoy el vigente es 20
    assert _sello(db, venta2) == 20  # el de la lista de octubre
    assert _sello(db, venta3) is None

    # Idempotente: correrlo otra vez deja los mismos sellos.
    with db.cursor() as cur:
        modulo.sellar_empresa(cur, "TRALOG")
    db.commit()
    assert _sello(db, venta1) == 10
    assert _sello(db, venta2) == 20
    assert _sello(db, venta3) is None


# ---------- 4. El parser acepta la lista oficial del proveedor ----------


def test_leer_lista_oficial_tio_rico_usa_columna_distribuidores():
    """La lista de Tio Rico tiene el costo en "Precio Caja Distribuidores";
    la columna "Precio Caja $. Cliente" (precio al cliente final) no debe
    tocarse. Los encabezados traen saltos de linea y hay filas de grupo."""
    import io

    import openpyxl

    from app.services.ventas_import import leer_lista_precios

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Tralog"
    ws.append(['"Industrias Tío Rico, C.A.'] + [None] * 10)
    ws.append([None, None, "LISTA DE PRECIOS TRALOG"])
    ws.append([None, "Código SAP", "Código de Barra\n(EAN 13)", "Código de Barra \n(DUN 14)",
               "Descripción SAP ", "Tamaño", "Unidad\nVenta ", "Precio \nCaja $.\nCliente",
               "Precio\nUnidad $.\nCliente", "Precio Caja\nDistribuidores\nS/", "Precio Neto + I.V.A. 16% "])
    ws.append([None] * 8 + ["Caja", "Unidad"])  # sub-encabezado
    ws.append([None, None, None, None, "MAGNUM"])  # fila de grupo
    ws.append(["MAGNUM", "64360805", "7591107151830", "37591107151831",
               "TIO RICO MAGNUM WHITE ALMOND", "90ml", "18", 43.74, 2.43, 32.805, 50.7384])
    ws.append(["MAGNUM", "64400919", "7591107151999", "37591107151999",
               "TIO RICO MAGNUM CLASICO", "110ml", "12", 83.25, 6.9375, 62.4375, 96.57])
    buffer = io.BytesIO()
    wb.save(buffer)

    lista = leer_lista_precios(buffer.getvalue())

    assert lista.hoja == "Tralog"
    assert len(lista.productos) == 2
    assert lista.productos[64360805]["costoCajaUsd"] == 32.805   # Distribuidores
    assert lista.productos[64400919]["costoCajaUsd"] == 62.4375  # no 83.25 (Cliente)
    assert lista.descartadas == []


# ---------- 5. La exportacion con precio por UNIDAD se convierte a por caja ----------


def test_lista_con_precio_por_unidad_se_convierte_a_costo_por_caja(cliente_api, usuario, db):
    """La exportacion "Precio Un Distribuidor" trae el precio por UNIDAD: la
    API lo multiplica por las unidadesPorCaja conocidas en ventas. Lo que no
    tiene conversion conocida va a descartadas, no se inventa un factor."""
    import io

    import openpyxl

    admin = usuario()
    db.execute(
        'INSERT INTO "VentaProducto" ("id", "empresa", "codigo", "nombre", "grupo", "unidadesPorCaja", '
        '"costoCajaUsd") VALUES (%s, \'TRALOG\', 930001, \'Producto con caja\', \'HELADOS\', 6, 25) '
        'ON CONFLICT ("empresa", "codigo") DO UPDATE SET "unidadesPorCaja" = 6, "costoCajaUsd" = 25',
        (f"vprod-{uuid.uuid4().hex[:10]}",),
    )
    db.commit()

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(["Código SAP", "Descripción SAP", "Precio Un Distribuidor"])
    ws.append([930001, "PRODUCTO CON CAJA", 5.0])
    ws.append([930002, "PRODUCTO SIN CAJA", 7.5])
    buffer = io.BytesIO()
    wb.save(buffer)

    r = cliente_api(admin).post(
        "/indicadores/costos/preview",
        data={"empresa": "TRALOG"},
        files={"archivo": ("lista.xlsx", buffer.getvalue(),
                            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["productos"] == 1  # solo el que tiene conversion conocida
    assert body["cambian"][0]["codigo"] == "930001"
    assert body["cambian"][0]["costoNuevo"] == 30.0   # 5.0 x 6 und/caja
    assert body["cambian"][0]["variacion"] == 0.2     # venia de 25
    assert body["descartadas"] == [{
        "fila": 3, "codigo": "930002",
        "motivo": "precio por unidad y no se sabe cuantas unidades trae la caja",
    }]


# ---------- 6. Re-subir un periodo sin costos no le cambia el costo ----------


def _producto_sin_costo(codigo: int) -> dict:
    return {"codigo": codigo, "nombre": "Pote 1L", "grupo": "HELADOS", "codigoProveedor": None,
            "unidadesPorCaja": None, "litrosPorUnidad": None, "costoCajaUsd": None}


def test_reconfirmar_sin_costo_hereda_el_sello_de_lo_que_reemplaza(cliente_api, usuario, db):
    """El extracto diario repite los dias anteriores: si entre medio subio una
    lista nueva, los dias ya vendidos conservan su costo y solo los nuevos
    toman el vigente. Si el archivo SI trae costo, manda el archivo."""
    admin = usuario()
    api = cliente_api(admin)
    producto = 910010
    _crear_producto(db, producto, 10)

    carga_a = _crear_carga(db, admin["id"], productos=[_producto_sin_costo(producto)])
    venta_a = _crear_venta(db, carga_a, producto, cajas="1", fecha=date(2026, 8, 5))
    db.commit()
    assert api.post(f"/indicadores/cargas/{carga_a}/confirmar").status_code == 200
    assert _sello(db, venta_a) == 10

    _crear_producto(db, producto, 20)  # sube una lista nueva
    db.commit()

    carga_b = _crear_carga(db, admin["id"], productos=[_producto_sin_costo(producto)])
    repetida = _crear_venta(db, carga_b, producto, cajas="1", fecha=date(2026, 8, 5))
    nueva = _crear_venta(db, carga_b, producto, cajas="1", fecha=date(2026, 8, 6))
    db.commit()
    assert api.post(f"/indicadores/cargas/{carga_b}/confirmar").status_code == 200
    assert _sello(db, repetida) == 10  # el dia ya vendido conserva su costo
    assert _sello(db, nueva) == 20     # el dia nuevo toma el vigente

    carga_c = _crear_carga(db, admin["id"], productos=[{**_producto_sin_costo(producto), "costoCajaUsd": 15}])
    con_costo = _crear_venta(db, carga_c, producto, cajas="1", fecha=date(2026, 8, 5))
    db.commit()
    assert api.post(f"/indicadores/cargas/{carga_c}/confirmar").status_code == 200
    assert _sello(db, con_costo) == 15  # el archivo trae costo: manda el archivo


def test_backfill_hereda_y_no_pisa_sellos_existentes(usuario, db):
    admin = usuario()
    producto = 910011
    _crear_producto(db, producto, 20)

    carga1 = _crear_carga(db, admin["id"], estado="CONFIRMADA", confirmada_en=datetime(2026, 7, 31, 12),
                          productos=[{**_producto_sin_costo(producto), "costoCajaUsd": 10}])
    julio = _crear_venta(db, carga1, producto, cajas="1", fecha=date(2026, 7, 10))
    db.execute(
        'INSERT INTO "ListaPrecioCarga" ("id", "empresa", "archivo", "productos", "subidaEn") '
        "VALUES (%s, 'TRALOG', 'lista_agosto.xlsx', %s, %s)",
        (f"vlist-{uuid.uuid4().hex[:10]}", Jsonb([{"codigo": producto, "nombre": "Pote 1L",
                                                   "grupo": "HELADOS", "costoCajaUsd": 20}]),
         datetime(2026, 8, 5, 12)),
    )
    # Agosto re-sube el 10 de julio (sin costos) y trae dias nuevos.
    carga2 = _crear_carga(db, admin["id"], estado="CONFIRMADA", confirmada_en=datetime(2026, 8, 10, 12),
                          productos=[_producto_sin_costo(producto)])
    julio_resubido = _crear_venta(db, carga2, producto, cajas="1", fecha=date(2026, 7, 10))
    db.execute('UPDATE "Venta" SET "reemplazadaPorCargaId" = %s WHERE id = %s', (carga2, julio))
    agosto = _crear_venta(db, carga2, producto, cajas="1", fecha=date(2026, 8, 3))
    ya_sellada = _crear_venta(db, carga2, producto, cajas="1", costo=7, fecha=date(2026, 8, 4))
    db.commit()

    modulo = _modulo_backfill()
    with db.cursor() as cur:
        resumen = modulo.sellar_empresa(cur, "TRALOG")
    db.commit()

    assert _sello(db, julio) == 10
    assert _sello(db, julio_resubido) == 10  # heredado, no el 20 de la lista
    assert _sello(db, agosto) == 20
    assert _sello(db, ya_sellada) == 7       # un sello existente no se pisa
    assert resumen["filasSelladas"] >= 3

    # Idempotente: la segunda corrida no sella nada nuevo.
    with db.cursor() as cur:
        assert modulo.sellar_empresa(cur, "TRALOG")["filasSelladas"] == 0
    db.rollback()


# ---------- 7. Casos del parser ----------


def _libro(*hojas: tuple[str, list[list]]) -> bytes:
    import io

    import openpyxl

    wb = openpyxl.Workbook()
    wb.remove(wb.active)
    for titulo, filas in hojas:
        ws = wb.create_sheet(titulo)
        for fila in filas:
            ws.append(fila)
    buffer = io.BytesIO()
    wb.save(buffer)
    return buffer.getvalue()


def test_extracto_con_hoja_de_precio_por_unidad_no_revienta():
    """Dentro de un extracto no hay conversion a caja: una hoja con solo
    precio por unidad se ignora (antes daba TypeError)."""
    import io

    import openpyxl

    from app.services.ventas_import import _leer_costos

    contenido = _libro(
        ("data", [["Fecha", "Divisas"]]),
        ("lista", [["Codigo SAP", "Descripcion", "Precio Un Distribuidores S/IVA"], [123, "X", 1.5]]),
    )
    libro = openpyxl.load_workbook(io.BytesIO(contenido), read_only=True, data_only=True)
    try:
        assert _leer_costos(libro, libro["data"]) == {}
    finally:
        libro.close()


def test_precio_por_unidad_se_redondea_una_sola_vez():
    from app.api.indicadores import _normalizar_a_costo_por_caja
    from app.services.ventas_import import leer_lista_precios

    lista = leer_lista_precios(_libro(("lista", [["Codigo", "Precio Un Distribuidor"], [1, 2.7333333]])))
    assert lista.precio_por_unidad
    assert lista.productos[1]["costoCajaUsd"] == 2.7333333  # sin redondear todavia

    class Cursor:
        def execute(self, *_):
            pass

        def fetchall(self):
            return [{"codigo": 1, "und": 24}]

    _normalizar_a_costo_por_caja(Cursor(), "TRALOG", lista)
    assert lista.productos[1]["costoCajaUsd"] == 65.6  # y no 2.7333 x 24 = 65.5992


def test_codigo_de_barra_no_se_toma_como_codigo_de_producto():
    from app.services.ventas_import import leer_lista_precios

    lista = leer_lista_precios(_libro(("Tralog", [
        ["Código de Barra (EAN 13)", "Código SAP", "Descripción SAP", "Precio Caja Distribuidores"],
        ["7591107151830", "64360805", "MAGNUM WHITE ALMOND", 32.805],
    ])))
    assert list(lista.productos) == [64360805]
