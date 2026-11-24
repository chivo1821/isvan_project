"""Fase 1: pedido -> factura (emitida con el emisor simulado) -> cobranzas,
indicadores, despacho e inventario; nota de credito; libro de ventas."""

import io
from decimal import Decimal

import openpyxl
import pytest

from app.services import tareas, ventas


@pytest.fixture()
def tienda(db, cliente_api, usuario):
    """TRALOG lista para facturar: datos fiscales, modulos encendidos, tasa de
    hoy, almacen, un producto con precio y existencia en dos lotes, y un
    cliente con ficha fiscal."""
    admin = usuario()
    api = cliente_api(admin)
    r = api.put("/empresas/emp-tralog", json={
        "rif": "J-12345678-9", "razonSocial": "TRALOG C.A.", "domicilioFiscal": "Caracas",
        "agenteRetencionIva": False, "contribuyenteEspecial": False,
    })
    assert r.status_code == 200, r.text
    for modulo in ("ventas", "inventario"):
        assert api.put(f"/empresas/emp-tralog/modulos/{modulo}", json={"activo": True}).status_code == 200
    db.execute(
        "INSERT INTO \"TasaCambio\" (\"fecha\", \"tasa\", \"fuente\") VALUES "
        "((now() AT TIME ZONE 'America/Caracas')::date, 100, 'MANUAL') ON CONFLICT (\"fecha\") DO UPDATE SET \"tasa\" = 100"
    )
    db.execute(
        'INSERT INTO "Almacen" ("id", "nombre", "tipo", "direccion", "ciudad", "lat", "lng") '
        "VALUES ('alm-catia', 'Almacen Catia', 'Centro de Distribucion', 'Catia', 'Caracas', 10.5, -66.9) "
        "ON CONFLICT DO NOTHING"
    )
    db.execute(
        'INSERT INTO "Cliente" ("id", "empresa", "codigo", "nombre", "tipo", "direccion", "ciudad", "telefono", '
        '"rifCedula", "razonSocial", "rutaVenta", "listaPrecioCodigo", "contribuyenteEspecial", "porcentajeRetencionIva", '
        '"diasCredito") VALUES (\'cli-f1\', \'TRALOG\', \'C501\', \'BODEGA F1\', \'Tienda\', \'Calle 2\', \'Caracas\', '
        "'0212', 'J-11111111-1', 'BODEGA F1 C.A.', 'R3', 'L1', true, 75, 15) ON CONFLICT DO NOTHING"
    )
    db.commit()
    def producto_de_prueba(datos):
        r = api.post("/catalogo/productos?empresaId=emp-tralog", json=datos)
        if r.status_code == 409:  # ya lo creo otra prueba de esta sesion
            return next(x for x in api.get("/catalogo/productos?empresaId=emp-tralog").json() if x["codigo"] == datos["codigo"])
        assert r.status_code == 201, r.text
        return r.json()

    p = producto_de_prueba({
        "codigo": 777001, "nombre": "HELADO F1 2L", "grupo": "TIO RICO", "unidadesPorCaja": 4,
        "litrosPorUnidad": 2, "pesoCajaKg": 8, "impuestoCodigo": "IVA_GENERAL",
    })
    exento = producto_de_prueba({
        "codigo": 777002, "nombre": "PRODUCTO EXENTO F1", "impuestoCodigo": "EXENTO", "manejaLote": False,
    })
    lista = api.post("/catalogo/listas?empresaId=emp-tralog", json={"codigo": "L1", "nombre": "Lista 1"})
    lista = lista.json() if lista.status_code == 201 else next(
        l for l in api.get("/catalogo/listas?empresaId=emp-tralog").json() if l["codigo"] == "L1")
    api.put(f"/catalogo/listas/{lista['id']}/precios", json={"precios": [
        {"productoId": p["id"], "precioCajaUsd": 10}, {"productoId": exento["id"], "precioCajaUsd": 5}]})
    r = api.post("/inventario/entradas", json={"empresaId": "emp-tralog", "almacenId": "alm-catia", "referencia": "inicial",
        "items": [
            {"productoId": p["id"], "lote": "L-TARDE", "vencimiento": "2027-12-31", "cajas": 10},
            {"productoId": p["id"], "lote": "L-PRONTO", "vencimiento": "2027-01-31", "cajas": 5},
            {"productoId": exento["id"], "cajas": 20},
        ]})
    assert r.status_code == 201, r.text
    return {"api": api, "admin": admin, "producto": p, "exento": exento}


def _emitir_cola():
    while tareas.procesar()["hechas"]:
        pass


def test_calculo_de_totales_por_alicuota():
    items = [
        {"subtotalUsd": Decimal("10.00"), "impuestoCodigo": "IVA_GENERAL", "porcentajeImpuesto": Decimal("16")},
        {"subtotalUsd": Decimal("0.05"), "impuestoCodigo": "IVA_GENERAL", "porcentajeImpuesto": Decimal("16")},
        {"subtotalUsd": Decimal("5.00"), "impuestoCodigo": "EXENTO", "porcentajeImpuesto": Decimal("0")},
    ]
    t = ventas.calcular_totales(items, Decimal("100"), pago_en_divisas=True)
    assert t["baseImponibleUsd"] == Decimal("10.05")
    assert t["ivaUsd"] == Decimal("1.61")  # 16 % de 10.05, redondeado una vez
    assert t["exentoUsd"] == Decimal("5.00")
    assert t["baseImponibleBs"] == Decimal("1005.00") and t["ivaBs"] == Decimal("160.80")
    assert t["igtfUsd"] == Decimal("0.50")  # 3 % de 16.66
    assert t["totalUsd"] == Decimal("17.16")
    assert ventas.subtotal_item(3, Decimal("9.99"), Decimal("10")) == Decimal("26.97")


def test_modulo_apagado_no_deja_vender(cliente_api, usuario):
    r = cliente_api(usuario()).get("/ventas/pedidos?empresaId=emp-isvan")
    assert r.status_code == 409


def test_flujo_completo_de_venta(tienda, db):
    api, p, exento = tienda["api"], tienda["producto"], tienda["exento"]
    pedido = api.post("/ventas/pedidos", json={
        "id": "ped-app-0001", "empresaId": "emp-tralog", "clienteId": "cli-f1", "almacenId": "alm-catia",
        "origen": "APP", "items": [{"productoId": p["id"], "cajas": 6}, {"productoId": exento["id"], "cajas": 2}],
    })
    assert pedido.status_code == 201, pedido.text
    assert pedido.json()["subtotalUsd"] == 70.0  # 6 x 10 + 2 x 5 (precios de la lista del cliente)
    # Reenviar el mismo pedido (app sin senal) no lo duplica
    otra_vez = api.post("/ventas/pedidos", json={
        "id": "ped-app-0001", "empresaId": "emp-tralog", "clienteId": "cli-f1", "almacenId": "alm-catia",
        "items": [{"productoId": p["id"], "cajas": 99}],
    })
    assert otra_vez.json()["numero"] == pedido.json()["numero"]

    r = api.post("/ventas/pedidos/ped-app-0001/confirmar")
    assert r.status_code == 200, r.text
    existencias = {e["productoId"]: e for e in api.get("/inventario/existencias?empresaId=emp-tralog").json()}
    assert existencias[p["id"]]["reservado"] == 6 and existencias[p["id"]]["disponible"] == 9

    r = api.post("/ventas/pedidos/ped-app-0001/facturar", json={"tipo": "FA", "pagoEnDivisas": True})
    assert r.status_code == 200, r.text
    doc_id = r.json()["documentoId"]
    _emitir_cola()
    doc = api.get(f"/ventas/documentos/{doc_id}").json()
    assert doc["estado"] == "EMITIDA", doc.get("errorEmision")
    assert doc["numero"] == "FA-00000001" and doc["numeroControl"] == "SIM-FA-00000001"
    assert doc["baseImponibleUsd"] == 60.0 and doc["exentoUsd"] == 10.0 and doc["ivaUsd"] == 9.6
    assert doc["igtfUsd"] == pytest.approx(2.39)  # 3 % de 79.60
    # El IGTF en Bs sale de los montos en Bs (3 % de 7.960 = 238,80), no de convertir el de USD.
    assert doc["totalUsd"] == pytest.approx(81.99) and doc["totalBs"] == pytest.approx(8198.8)
    assert doc["retencionIvaEsperadaBs"] == 720.0  # 75 % de 960 Bs de IVA
    assert doc["clienteRif"] == "J-11111111-1"

    # Inventario: salio primero el lote que vence antes (5 de L-PRONTO + 1 de L-TARDE)
    lotes = {l["lote"]: l["cajas"] for l in next(
        e for e in api.get("/inventario/existencias?empresaId=emp-tralog").json() if e["productoId"] == p["id"])["lotes"]}
    assert lotes == {"L-TARDE": 9.0}
    # Cobranzas, indicadores, despacho y pedido
    cobro = db.execute('SELECT * FROM "DocumentoCobro" WHERE "numero" = \'FA-00000001\'').fetchone()
    assert cobro["origen"] == "SISTEMA" and cobro["montoUsd"] == Decimal("81.99") and cobro["vencimiento"] is not None
    venta = db.execute('SELECT SUM("montoUsd") AS m, SUM("litros") AS l FROM "Venta" WHERE "numDoc" = \'FA-00000001\'').fetchone()
    assert venta["m"] == Decimal("70") and venta["l"] == Decimal("48")  # 6 cajas x 4 unidades x 2 L
    despacho = db.execute('SELECT * FROM "Despacho" WHERE "numeroDocumento" = \'FA-00000001\' AND "tipoDocumento" = \'FA\'').fetchone()
    assert despacho is not None
    assert db.execute('SELECT "estado" FROM "Pedido" WHERE "id" = \'ped-app-0001\'').fetchone()["estado"] == "FACTURADO"

    # Nota de credito por 2 cajas, con devolucion al inventario (vuelven a sus lotes)
    nc = api.post(f"/ventas/documentos/{doc_id}/notas", json={
        "tipo": "NC", "motivo": "Devolucion por mercancia danada", "devuelveInventario": True,
        "items": [{"productoId": p["id"], "cajas": 2}],
    })
    assert nc.status_code == 201, nc.text
    _emitir_cola()
    nota = api.get(f"/ventas/documentos/{nc.json()['documentoId']}").json()
    assert nota["estado"] == "EMITIDA" and nota["numero"] == "NC-00000001"
    assert nota["totalUsd"] == pytest.approx(23.90)  # 20 + 3.20 de IVA + 0.70 de IGTF (3 % de 23.20)
    cobro_nc = db.execute('SELECT "montoUsd" FROM "DocumentoCobro" WHERE "tipoDoc" = \'NC\' AND "numero" = \'NC-00000001\'').fetchone()
    assert cobro_nc["montoUsd"] < 0
    total = next(e for e in api.get("/inventario/existencias?empresaId=emp-tralog").json() if e["productoId"] == p["id"])
    assert total["cajas"] == 11.0
    # No se acredita mas de lo vendido
    mucho = api.post(f"/ventas/documentos/{doc_id}/notas", json={
        "tipo": "NC", "motivo": "otra", "items": [{"productoId": p["id"], "cajas": 5}]})
    assert mucho.status_code == 409

    # Libro de ventas del mes
    mes = doc["fechaEmision"][:7] + "-01"
    libro = api.get(f"/ventas/libro?empresaId=emp-tralog&mes={mes}").json()
    assert [f["numero"] for f in libro] == ["FA-00000001", "NC-00000001"]
    assert libro[0]["baseGeneral"] == 6000.0 and libro[0]["ivaGeneral"] == 960.0 and libro[1]["totalBs"] < 0
    xlsx = api.get(f"/ventas/libro.xlsx?empresaId=emp-tralog&mes={mes}")
    assert xlsx.status_code == 200
    hoja = openpyxl.load_workbook(io.BytesIO(xlsx.content)).active
    assert hoja.cell(3, 3).value == "FA-00000001"


def test_sin_existencia_no_confirma(tienda):
    api, p = tienda["api"], tienda["producto"]
    pedido = api.post("/ventas/pedidos", json={"empresaId": "emp-tralog", "clienteId": "cli-f1", "almacenId": "alm-catia",
                                               "items": [{"productoId": p["id"], "cajas": 500}]}).json()
    r = api.post(f"/ventas/pedidos/{pedido['id']}/confirmar")
    assert r.status_code == 409 and "existencia" in r.json()["detail"]


def test_emisor_que_rechaza_no_deja_numero_saltado(tienda, db, monkeypatch):
    from app.services import emision

    api, p = tienda["api"], tienda["producto"]

    class Rechaza:
        nombre = "PRUEBA"

        def emitir(self, documento):
            raise emision.EmisionRechazada("RIF del cliente invalido")

    pedido = api.post("/ventas/pedidos", json={"empresaId": "emp-tralog", "clienteId": "cli-f1", "almacenId": "alm-catia",
                                               "items": [{"productoId": p["id"], "cajas": 1}]}).json()
    api.post(f"/ventas/pedidos/{pedido['id']}/confirmar")
    monkeypatch.setattr(emision, "obtener_emisor", lambda: Rechaza())
    doc_id = api.post(f"/ventas/pedidos/{pedido['id']}/facturar", json={"tipo": "FA"}).json()["documentoId"]
    _emitir_cola()
    doc = api.get(f"/ventas/documentos/{doc_id}").json()
    assert doc["estado"] == "RECHAZADA" and "RIF" in doc["errorEmision"] and doc["numero"] is None
    antes = db.execute(
        'SELECT COALESCE(MAX("siguiente"), 1) AS s FROM "Correlativo" WHERE "tipo" = \'FA\' AND "empresaId" = \'emp-tralog\''
    ).fetchone()["s"]
    monkeypatch.undo()
    assert api.post(f"/ventas/documentos/{doc_id}/reintentar").status_code == 200
    _emitir_cola()
    doc = api.get(f"/ventas/documentos/{doc_id}").json()
    assert doc["estado"] == "EMITIDA"
    numero = int(doc["numero"].split("-")[1])
    assert numero == antes  # tomo el numero que seguia: el rechazo no lo gasto


def test_ajuste_con_aprobacion(tienda, cliente_api, usuario):
    api, p = tienda["api"], tienda["producto"]
    existencia = next(e for e in api.get("/inventario/existencias?empresaId=emp-tralog").json() if e["productoId"] == p["id"])
    lote_id = existencia["lotes"][0]["loteId"]
    ajuste = api.post("/inventario/ajustes", json={"empresaId": "emp-tralog", "almacenId": "alm-catia",
                                                   "motivo": "Conteo fisico", "items": [{"productoId": p["id"], "loteId": lote_id, "cajas": -1}]})
    assert ajuste.status_code == 201
    sin_permiso = cliente_api(usuario("DESPACHOS")).post(f"/inventario/ajustes/{ajuste.json()['id']}/aprobar")
    assert sin_permiso.status_code == 403
    assert api.post(f"/inventario/ajustes/{ajuste.json()['id']}/aprobar").json()["estado"] == "APROBADO"
    despues = next(e for e in api.get("/inventario/existencias?empresaId=emp-tralog").json() if e["productoId"] == p["id"])
    assert despues["cajas"] == existencia["cajas"] - 1


def test_enlazar_sella_costo_historico_desde_venta_producto(tienda, db):
    """Al emitir un DocumentoVenta del sistema, ventas.py:_enlazar sella en
    Venta.costoCajaUsd el costo vigente en VentaProducto (y deja NULL si no
    tiene costo), sin verse afectado por cambios posteriores del costo."""
    api, p, exento = tienda["api"], tienda["producto"], tienda["exento"]

    db.execute(
        'INSERT INTO "VentaProducto" ("id", "empresa", "codigo", "nombre", "grupo", "costoCajaUsd") '
        "VALUES ('vp-f1-sellado', 'TRALOG', %s, %s, 'TIO RICO', 6.7500) "
        'ON CONFLICT ("empresa", "codigo") DO UPDATE SET "costoCajaUsd" = EXCLUDED."costoCajaUsd"',
        (p["codigo"], p["nombre"]),
    )
    db.execute(
        'INSERT INTO "VentaProducto" ("id", "empresa", "codigo", "nombre", "grupo", "costoCajaUsd") '
        "VALUES ('vp-f1-sincosto', 'TRALOG', %s, %s, 'SIN GRUPO', NULL) "
        'ON CONFLICT ("empresa", "codigo") DO UPDATE SET "costoCajaUsd" = NULL',
        (exento["codigo"], exento["nombre"]),
    )
    db.commit()

    pedido = api.post("/ventas/pedidos", json={
        "empresaId": "emp-tralog", "clienteId": "cli-f1", "almacenId": "alm-catia",
        "items": [{"productoId": p["id"], "cajas": 2}, {"productoId": exento["id"], "cajas": 1}],
    })
    assert pedido.status_code == 201, pedido.text
    ped_id = pedido.json()["id"]
    assert api.post(f"/ventas/pedidos/{ped_id}/confirmar").status_code == 200
    doc_id = api.post(f"/ventas/pedidos/{ped_id}/facturar", json={"tipo": "FA"}).json()["documentoId"]
    _emitir_cola()

    doc = api.get(f"/ventas/documentos/{doc_id}").json()
    assert doc["estado"] == "EMITIDA", doc.get("errorEmision")

    filas = db.execute(
        'SELECT v."codigoProducto", v."costoCajaUsd", c."origen" '
        'FROM "Venta" v JOIN "VentaCarga" c ON c."id" = v."cargaId" '
        'WHERE v."empresa" = \'TRALOG\' AND v."numDoc" = %s',
        (doc["numero"],),
    ).fetchall()
    por_codigo = {f["codigoProducto"]: f for f in filas}
    assert por_codigo[p["codigo"]]["origen"] == "SISTEMA"
    assert por_codigo[p["codigo"]]["costoCajaUsd"] == Decimal("6.7500")
    assert por_codigo[exento["codigo"]]["origen"] == "SISTEMA"
    assert por_codigo[exento["codigo"]]["costoCajaUsd"] is None

    # Cambiar el costo vigente en VentaProducto despues de emitir no altera la venta ya sellada
    db.execute(
        'UPDATE "VentaProducto" SET "costoCajaUsd" = 12.0000 WHERE "empresa" = \'TRALOG\' AND "codigo" = %s',
        (p["codigo"],),
    )
    db.commit()
    sellada = db.execute(
        'SELECT "costoCajaUsd" FROM "Venta" WHERE "empresa" = \'TRALOG\' AND "numDoc" = %s AND "codigoProducto" = %s',
        (doc["numero"], p["codigo"]),
    ).fetchone()
    assert sellada["costoCajaUsd"] == Decimal("6.7500")
