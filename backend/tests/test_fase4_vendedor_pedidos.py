"""Fase 4.4: Catalogo de vendedor con lista de precios del cliente, stock real
por lote (proximo vencimiento), captura automatica/explicita de DemandaNoAtendida
al crear pedidos y consulta del reporte de demanda no atendida."""

from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

import pytest


@pytest.fixture()
def escenario_vendedor(db, usuario, cliente_api):
    tag = uuid.uuid4().hex[:6]
    clave = "ClaveVendedor123"
    adm = usuario("ADMIN", clave=clave)
    sup = usuario("SUPERVISOR", clave=clave)
    rep = usuario("REPARTIDOR", clave=clave)
    ven1 = usuario("VENDEDOR", clave=clave)
    ven2 = usuario("VENDEDOR", clave=clave)

    api_adm = cliente_api(adm)
    assert api_adm.put(
        "/empresas/emp-tralog",
        json={
            "rif": "J-12345678-9",
            "razonSocial": "TRALOG C.A.",
            "domicilioFiscal": "Caracas",
            "agenteRetencionIva": False,
            "contribuyenteEspecial": False,
        },
    ).status_code == 200
    for mod in ("ventas", "inventario"):
        assert api_adm.put(f"/empresas/emp-tralog/modulos/{mod}", json={"activo": True}).status_code == 200

    db.execute(
        'INSERT INTO "TasaCambio" ("fecha", "tasa", "fuente") VALUES '
        "((now() AT TIME ZONE 'America/Caracas')::date, 100, 'MANUAL') "
        'ON CONFLICT ("fecha") DO UPDATE SET "tasa" = 100'
    )
    db.execute(
        'INSERT INTO "Almacen" ("id", "nombre", "tipo", "direccion", "ciudad", "lat", "lng") '
        "VALUES ('alm-catia', 'Almacen Catia', 'Centro de Distribucion', 'Catia', 'Caracas', 10.5, -66.9) "
        "ON CONFLICT DO NOTHING"
    )
    alm_sec_id = f"alm-sec-{tag}"
    db.execute(
        'INSERT INTO "Almacen" ("id", "nombre", "tipo", "direccion", "ciudad", "lat", "lng") '
        "VALUES (%s, 'Almacen Secundario', 'Tienda', 'Este', 'Caracas', 10.49, -66.85)",
        (alm_sec_id,),
    )

    db.execute(
        'INSERT INTO "VendedorRuta" ("id", "usuarioId", "empresa", "ruta") VALUES '
        "(%s, %s, 'TRALOG', 'R3'), (%s, %s, 'TRALOG', 'R5')",
        (f"vr1-{tag}", ven1["id"], f"vr2-{tag}", ven2["id"]),
    )

    cli_r3 = f"cli-r3-{tag}"
    cli_r5 = f"cli-r5-{tag}"
    db.execute(
        'INSERT INTO "Cliente" ("id", "empresa", "codigo", "nombre", "tipo", "direccion", "ciudad", "telefono", '
        '"rifCedula", "razonSocial", "rutaVenta", "listaPrecioCodigo", "diasCredito") VALUES '
        "(%s, 'TRALOG', %s, 'Bodega R3', 'Tienda', 'Calle 3', 'Caracas', '0212', 'J-33333333-1', 'Bodega R3 C.A.', 'R3', 'L1', 15), "
        "(%s, 'TRALOG', %s, 'Bodega R5', 'Tienda', 'Calle 5', 'Caracas', '0212', 'J-55555555-1', 'Bodega R5 C.A.', 'R5', 'L2', 15)",
        (cli_r3, f"CR3-{tag}", cli_r5, f"CR5-{tag}"),
    )
    db.commit()

    def crear_prod(codigo: int, nombre: str, **extra):
        r = api_adm.post(
            "/catalogo/productos?empresaId=emp-tralog",
            json={
                "codigo": codigo,
                "nombre": nombre,
                "grupo": "HELADOS",
                "unidadesPorCaja": 6,
                "impuestoCodigo": "IVA_GENERAL",
                **extra,
            },
        )
        assert r.status_code == 201, r.text
        return r.json()

    base_cod = int(tag[:4], 16) * 10 + 900000
    prod_lotes = crear_prod(base_cod + 1, f"HELADO LOTES {tag}")
    prod_parcial = crear_prod(base_cod + 2, f"HELADO PARCIAL {tag}")
    prod_cero = crear_prod(base_cod + 3, f"HELADO CERO {tag}")
    prod_inactivo = crear_prod(base_cod + 4, f"HELADO INACTIVO {tag}", activo=False)

    l1 = api_adm.post("/catalogo/listas?empresaId=emp-tralog", json={"codigo": "L1", "nombre": "Lista 1"})
    l1_id = l1.json()["id"] if l1.status_code == 201 else next(
        x["id"] for x in api_adm.get("/catalogo/listas?empresaId=emp-tralog").json() if x["codigo"] == "L1"
    )
    l2 = api_adm.post("/catalogo/listas?empresaId=emp-tralog", json={"codigo": "L2", "nombre": "Lista 2"})
    l2_id = l2.json()["id"] if l2.status_code == 201 else next(
        x["id"] for x in api_adm.get("/catalogo/listas?empresaId=emp-tralog").json() if x["codigo"] == "L2"
    )
    assert api_adm.put(
        f"/catalogo/listas/{l1_id}/precios",
        json={
            "precios": [
                {"productoId": prod_lotes["id"], "precioCajaUsd": 12.5},
                {"productoId": prod_parcial["id"], "precioCajaUsd": 8.0},
                {"productoId": prod_cero["id"], "precioCajaUsd": 15.0},
            ]
        },
    ).status_code == 200
    assert api_adm.put(
        f"/catalogo/listas/{l2_id}/precios",
        json={
            "precios": [
                {"productoId": prod_lotes["id"], "precioCajaUsd": 14.0},
                {"productoId": prod_parcial["id"], "precioCajaUsd": 9.5},
                {"productoId": prod_cero["id"], "precioCajaUsd": 16.0},
            ]
        },
    ).status_code == 200

    # Entradas en alm-catia: prod_lotes con dos lotes + prod_parcial con 4 cajas
    assert api_adm.post(
        "/inventario/entradas",
        json={
            "empresaId": "emp-tralog",
            "almacenId": "alm-catia",
            "referencia": "inicial",
            "items": [
                {"productoId": prod_lotes["id"], "lote": f"L-TARDE-{tag}", "vencimiento": "2027-12-31", "cajas": 10},
                {"productoId": prod_lotes["id"], "lote": f"L-PRONTO-{tag}", "vencimiento": "2027-02-15", "cajas": 5},
                {"productoId": prod_parcial["id"], "lote": f"L-PARC-{tag}", "vencimiento": "2027-06-01", "cajas": 4},
            ],
        },
    ).status_code == 201

    # Reserva de 3 cajas en pedido CONFIRMADO para prod_lotes
    ped_res = api_adm.post(
        "/ventas/pedidos",
        json={
            "empresaId": "emp-tralog",
            "clienteId": cli_r3,
            "almacenId": "alm-catia",
            "items": [{"productoId": prod_lotes["id"], "cajas": 3}],
        },
    )
    assert ped_res.status_code == 201, ped_res.text
    assert api_adm.post(f"/ventas/pedidos/{ped_res.json()['id']}/confirmar").status_code == 200

    # Login movil Bearer para ven1
    anon = cliente_api()
    login1 = anon.post("/auth/movil/login", json={"email": ven1["email"], "password": clave, "dispositivo": "Android"})
    assert login1.status_code == 200, login1.text
    headers_ven1 = {"Authorization": f"Bearer {login1.json()['token']}"}

    login2 = anon.post("/auth/movil/login", json={"email": ven2["email"], "password": clave, "dispositivo": "Android"})
    assert login2.status_code == 200, login2.text
    headers_ven2 = {"Authorization": f"Bearer {login2.json()['token']}"}

    return {
        "tag": tag,
        "adm": adm,
        "sup": sup,
        "rep": rep,
        "ven1": ven1,
        "ven2": ven2,
        "api_adm": api_adm,
        "api_sup": cliente_api(sup),
        "api_rep": cliente_api(rep),
        "anon": anon,
        "headers_ven1": headers_ven1,
        "headers_ven2": headers_ven2,
        "cli_r3": cli_r3,
        "cli_r5": cli_r5,
        "alm_sec": alm_sec_id,
        "prod_lotes": prod_lotes,
        "prod_parcial": prod_parcial,
        "prod_cero": prod_cero,
        "prod_inactivo": prod_inactivo,
    }


def test_vendedor_movil_bearer_catalogo_precios_stock_y_lotes(escenario_vendedor):
    e = escenario_vendedor
    anon, h1 = e["anon"], e["headers_ven1"]

    # Sin almacenId debe usar el almacen principal (alm-catia)
    r = anon.get(f"/vendedor/catalogo?empresaId=emp-tralog&clienteId={e['cli_r3']}", headers=h1)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["almacenId"] == "alm-catia"
    assert data["listaPrecioCodigo"] == "L1"

    por_id = {p["productoId"]: p for p in data["productos"]}
    assert e["prod_inactivo"]["id"] not in por_id

    pl = por_id[e["prod_lotes"]["id"]]
    assert pl["precioUsd"] == 12.5
    assert pl["precioPorCaja"] == 12.5
    assert pl["listaPrecioCodigo"] == "L1"
    assert pl["cajasFisicas"] == 15.0
    assert pl["reservado"] == 3.0
    assert pl["disponible"] == 12.0
    assert pl["proximoVencimiento"] == "2027-02-15"
    assert [l["vencimiento"] for l in pl["lotes"]] == ["2027-02-15", "2027-12-31"]

    pc = por_id[e["prod_cero"]["id"]]
    assert pc["precioUsd"] == 15.0
    assert pc["cajasFisicas"] == 0.0
    assert pc["reservado"] == 0.0
    assert pc["disponible"] == 0.0
    assert pc["proximoVencimiento"] is None
    assert pc["lotes"] == []

    # Busqueda por texto
    rb = anon.get(f"/vendedor/catalogo?empresaId=emp-tralog&buscar={e['prod_parcial']['codigo']}", headers=h1)
    assert rb.status_code == 200
    assert [p["productoId"] for p in rb.json()["productos"]] == [e["prod_parcial"]["id"]]

    # Vendedor no puede ver catalogo para cliente de otra ruta
    ra = anon.get(f"/vendedor/catalogo?empresaId=emp-tralog&clienteId={e['cli_r5']}", headers=h1)
    assert ra.status_code == 403

    # Repartidor no tiene acceso
    assert e["api_rep"].get("/vendedor/catalogo?empresaId=emp-tralog").status_code == 403

    # Supervisor y Admin si tienen acceso y resuelven lista L2 de cli_r5
    rs = e["api_sup"].get(f"/vendedor/catalogo?empresaId=emp-tralog&clienteId={e['cli_r5']}")
    assert rs.status_code == 200, rs.text
    por_id_s = {p["productoId"]: p for p in rs.json()["productos"]}
    assert por_id_s[e["prod_lotes"]["id"]]["precioUsd"] == 14.0
    assert e["api_adm"].get("/vendedor/catalogo?empresaId=emp-tralog").status_code == 200


def test_crear_pedido_demanda_automatica_sin_romper_borrador(escenario_vendedor, db):
    e = escenario_vendedor
    anon, h1 = e["anon"], e["headers_ven1"]

    r = anon.post(
        "/ventas/pedidos",
        headers=h1,
        json={
            "empresaId": "emp-tralog",
            "clienteId": e["cli_r3"],
            "almacenId": "alm-catia",
            "origen": "APP",
            "items": [
                {"productoId": e["prod_parcial"]["id"], "cajas": 10},
                {"productoId": e["prod_cero"]["id"], "cajas": 6},
            ],
        },
    )
    assert r.status_code == 201, r.text
    ped = r.json()
    assert ped["estado"] == "BORRADOR"
    assert ped["demandaNoAtendidaTotal"] == 2

    # El pedido sigue con sus renglones solicitados (sin ajustarStock) y falla al confirmar (409)
    cant_items = {i["productoId"]: i["cajas"] for i in ped["items"]}
    assert cant_items[e["prod_parcial"]["id"]] == 10.0
    assert cant_items[e["prod_cero"]["id"]] == 6.0
    conf = anon.post(f"/ventas/pedidos/{ped['id']}/confirmar", headers=h1)
    assert conf.status_code == 409

    filas = db.execute(
        'SELECT * FROM "DemandaNoAtendida" WHERE "pedidoId" = %s',
        (ped["id"],),
    ).fetchall()
    por_prod = {f["productoId"]: f for f in filas}
    assert set(por_prod) == {e["prod_parcial"]["id"], e["prod_cero"]["id"]}

    dp = por_prod[e["prod_parcial"]["id"]]
    assert dp["vendedorId"] == e["ven1"]["id"]
    assert dp["motivo"] == "STOCK_PARCIAL"
    assert dp["cajasSolicitadas"] == Decimal("10.000")
    assert dp["cajasDisponibles"] == Decimal("4.000")
    assert dp["cajasFaltantes"] == Decimal("6.000")

    dc = por_prod[e["prod_cero"]["id"]]
    assert dc["motivo"] == "SIN_STOCK"
    assert dc["cajasSolicitadas"] == Decimal("6.000")
    assert dc["cajasDisponibles"] == Decimal("0.000")
    assert dc["cajasFaltantes"] == Decimal("6.000")


def test_crear_pedido_demanda_explicita_deduplicada_y_ajustar_stock(escenario_vendedor, db):
    e = escenario_vendedor
    anon, h1 = e["anon"], e["headers_ven1"]

    r = anon.post(
        "/ventas/pedidos",
        headers=h1,
        json={
            "id": f"ped-adj-{e['tag']}",
            "empresaId": "emp-tralog",
            "clienteId": e["cli_r3"],
            "almacenId": "alm-catia",
            "origen": "APP",
            "ajustarStock": True,
            "items": [
                {"productoId": e["prod_parcial"]["id"], "cajas": 10},
                {"productoId": e["prod_cero"]["id"], "cajas": 3},
            ],
            "demandaNoAtendida": [
                {"productoId": e["prod_parcial"]["id"], "cajasSolicitadas": 10},
                {"productoId": e["prod_lotes"]["id"], "cajasSolicitadas": 20},
            ],
        },
    )
    assert r.status_code == 201, r.text
    ped = r.json()
    assert ped["demandaNoAtendidaTotal"] == 3

    # prod_cero se omitio del PedidoItem y prod_parcial se ajusto a 4 cajas -> confirma OK
    assert [(i["productoId"], i["cajas"]) for i in ped["items"]] == [(e["prod_parcial"]["id"], 4.0)]
    assert anon.post(f"/ventas/pedidos/{ped['id']}/confirmar", headers=h1).status_code == 200

    # Reenvio idempotente no duplica pedido ni DemandaNoAtendida
    dup = anon.post(
        "/ventas/pedidos",
        headers=h1,
        json={
            "id": f"ped-adj-{e['tag']}",
            "empresaId": "emp-tralog",
            "clienteId": e["cli_r3"],
            "almacenId": "alm-catia",
            "items": [{"productoId": e["prod_parcial"]["id"], "cajas": 1}],
        },
    )
    assert dup.status_code == 201
    assert dup.json()["demandaNoAtendidaTotal"] == 3

    filas = db.execute(
        'SELECT * FROM "DemandaNoAtendida" WHERE "pedidoId" = %s',
        (ped["id"],),
    ).fetchall()
    assert len(filas) == 3
    por_prod = {f["productoId"]: f for f in filas}
    assert por_prod[e["prod_parcial"]["id"]]["motivo"] == "STOCK_PARCIAL"
    assert por_prod[e["prod_parcial"]["id"]]["cajasFaltantes"] == Decimal("6.000")
    assert por_prod[e["prod_cero"]["id"]]["motivo"] == "SIN_STOCK"
    assert por_prod[e["prod_cero"]["id"]]["cajasFaltantes"] == Decimal("3.000")
    assert por_prod[e["prod_lotes"]["id"]]["motivo"] == "STOCK_PARCIAL"
    assert por_prod[e["prod_lotes"]["id"]]["cajasDisponibles"] == Decimal("12.000")
    assert por_prod[e["prod_lotes"]["id"]]["cajasFaltantes"] == Decimal("8.000")


def test_consultar_demanda_no_atendida_filtros_y_roles(escenario_vendedor):
    e = escenario_vendedor
    anon = e["anon"]

    # Pedido de ven1 (faltante: 6 de prod_parcial)
    r1 = anon.post(
        "/ventas/pedidos",
        headers=e["headers_ven1"],
        json={
            "empresaId": "emp-tralog",
            "clienteId": e["cli_r3"],
            "almacenId": "alm-catia",
            "items": [{"productoId": e["prod_parcial"]["id"], "cajas": 10}],
        },
    )
    assert r1.status_code == 201

    # Pedido de ven2 en su ruta R5 (faltante: 5 de prod_cero)
    r2 = anon.post(
        "/ventas/pedidos",
        headers=e["headers_ven2"],
        json={
            "empresaId": "emp-tralog",
            "clienteId": e["cli_r5"],
            "almacenId": "alm-catia",
            "items": [{"productoId": e["prod_cero"]["id"], "cajas": 5}],
        },
    )
    assert r2.status_code == 201

    # ven1 solo ve los suyos incluso si intenta pasar vendedorId=ven2
    q_v1 = anon.get(f"/ventas/demanda-no-atendida?vendedorId={e['ven2']['id']}", headers=e["headers_ven1"])
    assert q_v1.status_code == 200, q_v1.text
    d1 = q_v1.json()
    assert len(d1["items"]) == 1
    assert d1["items"][0]["vendedorId"] == e["ven1"]["id"]
    assert d1["items"][0]["productoId"] == e["prod_parcial"]["id"]
    assert d1["items"][0]["almacenNombre"] == "Almacen Catia"
    assert d1["resumen"]["totalCajasFaltantes"] == 6.0
    assert d1["resumen"]["stockParcial"] == 1
    assert d1["resumen"]["sinStock"] == 0

    # Alias /vendedor/demanda-no-atendida
    q_alias = anon.get("/vendedor/demanda-no-atendida", headers=e["headers_ven1"])
    assert q_alias.status_code == 200
    assert len(q_alias.json()["items"]) == 1

    # ADMIN ve ambos y puede filtrar por vendedorId y productoId
    q_adm = e["api_adm"].get("/ventas/demanda-no-atendida?empresaId=emp-tralog")
    assert q_adm.status_code == 200
    adm_data = q_adm.json()
    assert adm_data["resumen"]["totalRegistros"] >= 2
    assert adm_data["resumen"]["totalCajasFaltantes"] >= 11.0

    q_filt = e["api_adm"].get(
        f"/ventas/demanda-no-atendida?empresaId=emp-tralog&vendedorId={e['ven2']['id']}&productoId={e['prod_cero']['id']}"
    )
    assert q_filt.status_code == 200
    f_data = q_filt.json()
    assert len(f_data["items"]) == 1
    assert f_data["items"][0]["motivo"] == "SIN_STOCK"
    assert f_data["items"][0]["cajasFaltantes"] == 5.0

    # Filtro de fecha futura devuelve vacio
    q_vacio = e["api_adm"].get(
        f"/ventas/demanda-no-atendida?empresaId=emp-tralog&desde={date(2099, 1, 1)}&hasta={date(2099, 1, 2)}"
    )
    assert q_vacio.status_code == 200
    assert q_vacio.json()["items"] == []
    assert q_vacio.json()["resumen"]["totalRegistros"] == 0

    # Repartidor rechazado
    assert e["api_rep"].get("/ventas/demanda-no-atendida?empresaId=emp-tralog").status_code == 403


def test_confirmar_pedido_sin_renglones_rechaza_409(escenario_vendedor):
    e = escenario_vendedor
    anon, h1 = e["anon"], e["headers_ven1"]
    r = anon.post(
        "/ventas/pedidos",
        headers=h1,
        json={
            "empresaId": "emp-tralog",
            "clienteId": e["cli_r3"],
            "almacenId": "alm-catia",
            "origen": "APP",
            "items": [],
            "demandaNoAtendida": [
                {"productoId": e["prod_cero"]["id"], "cajasSolicitadas": 5},
            ],
        },
    )
    assert r.status_code == 201, r.text
    ped = r.json()
    assert ped["items"] == []
    assert ped["demandaNoAtendidaTotal"] == 1
    conf = anon.post(f"/ventas/pedidos/{ped['id']}/confirmar", headers=h1)
    assert conf.status_code == 409
    assert "solo registra demanda no atendida" in conf.json()["detail"]

