"""Pagos parciales de delivery (`POST /delivery/liquidaciones` con `paradas`):
seleccion de paradas, calculo de totales, saldo restante pendiente,
congelamiento de montos y prevencion de doble pago.
"""

from __future__ import annotations

import uuid
from datetime import timedelta

import pytest


@pytest.fixture()
def entorno_delivery(db, usuario, cliente_api):
    """Repartidor en moto con 3 paradas entregadas a distintas distancias y
    tabulador conocido."""
    from app.core.fechas import ahora_utc

    tag = uuid.uuid4().hex[:8]
    alm_id = f"alm-pp-{tag}"
    moto_id = f"veh-pp-{tag}"
    ruta_id = f"rut-pp-{tag}"

    adm = usuario("ADMIN")
    rep = usuario("REPARTIDOR")

    db.execute(
        'INSERT INTO "Almacen" ("id", "nombre", "tipo", "direccion", "ciudad", "lat", "lng") '
        "VALUES (%s, 'Almacen PP', 'Centro de Distribucion', 'Catia', 'Caracas', 10.5, -66.9)",
        (alm_id,),
    )
    db.execute(
        'INSERT INTO "Vehiculo" ("id", "placa", "tipo", "capacidadKg", "almacenBaseId") '
        "VALUES (%s, %s, 'MOTO', 35, %s)",
        (moto_id, f"MPP-{tag}", alm_id),
    )
    db.execute('UPDATE "Usuario" SET "vehiculoAsignadoId" = %s WHERE "id" = %s', (moto_id, rep["id"]))
    db.execute('DELETE FROM "TabuladorDelivery"')
    db.execute(
        'INSERT INTO "TabuladorDelivery" ("id", "orden", "hastaKm", "montoUsd") '
        "VALUES (%s, 1, 10, 3.00), (%s, 2, NULL, 5.50)",
        (f"tab1-{tag}", f"tab2-{tag}"),
    )

    ahora = ahora_utc()
    entregado_en = ahora - timedelta(hours=5)
    db.execute(
        'INSERT INTO "Ruta" ("id", "numero", "vehiculoId", "origenId", "creadoPorId", "estado", '
        '"salidaProgramada", "iniciadaEn", "completadaEn") '
        "VALUES (%s, %s, %s, %s, %s, 'COMPLETADA', %s, %s, %s)",
        (ruta_id, f"RPP-{tag}", moto_id, alm_id, adm["id"], ahora - timedelta(hours=7),
         ahora - timedelta(hours=6), entregado_en),
    )

    # 3 clientes: cli1 (5 km -> $3.00, con 2 despachos agrupados en 1 parada),
    # cli2 (8 km -> $3.00), cli3 (15 km -> $5.50). Total = $11.50.
    paradas_spec = [
        (1, "Cliente Uno", 5.0, 2),
        (2, "Cliente Dos", 8.0, 1),
        (3, "Cliente Tres", 15.0, 1),
    ]
    clientes = []
    for idx, nombre, km, num_desp in paradas_spec:
        cid = f"cli-pp-{tag}-{idx}"
        db.execute(
            'INSERT INTO "Cliente" ("id", "empresa", "codigo", "nombre", "tipo", "direccion", "ciudad", '
            '"lat", "lng", "telefono") '
            "VALUES (%s, 'TRALOG', %s, %s, 'Tienda', 'Av 1', 'Caracas', %s, %s, '04140000000')",
            (cid, f"CPP-{tag}-{idx}", nombre, 10.5 + idx * 0.01, -66.9 - idx * 0.01),
        )
        db.execute(
            'INSERT INTO "DistanciaCliente" ("id", "almacenId", "clienteId", "km", "fuente") '
            "VALUES (%s, %s, %s, %s, 'estimada')",
            (f"dist-pp-{tag}-{idx}", alm_id, cid, km),
        )
        for n in range(num_desp):
            db.execute(
                'INSERT INTO "Despacho" ("id", "numero", "numeroDocumento", "tipoDocumento", "origenId", '
                '"destinoClienteId", "creadoPorId", "estado", "rutaId", "ordenEnRuta", "llegadaEn", "entregadoEn") '
                "VALUES (%s, %s, %s, 'FA', %s, %s, %s, 'ENTREGADO', %s, %s, %s, %s)",
                (
                    f"desp-pp-{tag}-{idx}-{n}", f"DPP-{tag}-{idx}-{n}", f"FPP-{tag}-{idx}-{n}",
                    alm_id, cid, adm["id"], ruta_id, idx,
                    entregado_en - timedelta(minutes=10), entregado_en,
                ),
            )
        clientes.append(cid)
    db.commit()

    fecha = (entregado_en - timedelta(hours=4)).date().isoformat()
    return {
        "adm": adm,
        "rep": rep,
        "api_adm": cliente_api(adm),
        "api_rep": cliente_api(rep),
        "alm_id": alm_id,
        "moto_id": moto_id,
        "ruta_id": ruta_id,
        "clientes": clientes,
        "desde": fecha,
        "hasta": fecha,
    }


def _ref(p: dict) -> dict:
    return {"rutaId": p["rutaId"], "clienteId": p["clienteId"], "vehiculoId": p["vehiculoId"]}


def test_corte_parcial_calcula_total_deja_pendiente_y_congela_monto(entorno_delivery):
    api = entorno_delivery["api_adm"]
    api_rep = entorno_delivery["api_rep"]
    rep_id = entorno_delivery["rep"]["id"]
    desde, hasta = entorno_delivery["desde"], entorno_delivery["hasta"]

    res0 = api.get(f"/delivery/resumen?desde={desde}&hasta={hasta}&repartidor={rep_id}").json()
    paradas = res0["paradas"]
    assert len(paradas) == 3
    assert res0["totales"]["totalUsd"] == pytest.approx(11.50)
    assert res0["totales"]["pendienteUsd"] == pytest.approx(11.50)
    assert res0["totales"]["liquidadoUsd"] == 0.0

    p1 = next(p for p in paradas if p["km"] == 5.0)
    p2 = next(p for p in paradas if p["km"] == 8.0)
    p3 = next(p for p in paradas if p["km"] == 15.0)
    assert p1["despachos"] == 2 and p1["montoUsd"] == 3.00
    assert p2["montoUsd"] == 3.00
    assert p3["montoUsd"] == 5.50

    # Corte parcial: pagar solo p1 ($3.00) y p3 ($5.50) = $8.50
    r = api.post(
        "/delivery/liquidaciones",
        json={
            "repartidorId": rep_id,
            "desde": desde,
            "hasta": hasta,
            "nota": "Primer corte",
            "paradas": [_ref(p1), _ref(p3)],
        },
    )
    assert r.status_code == 200, r.text
    liq = r.json()
    assert liq["entregas"] == 2
    assert liq["totalUsd"] == pytest.approx(8.50)
    assert liq["nota"] == "Primer corte"

    det = api.get(f"/delivery/liquidaciones/{liq['id']}").json()
    assert len(det["paradas"]) == 2
    assert {p["clienteId"] for p in det["paradas"]} == {p1["clienteId"], p3["clienteId"]}

    # Resumen y estado de cuenta del repartidor reflejan pago parcial y pendiente
    res1 = api.get(f"/delivery/resumen?desde={desde}&hasta={hasta}&repartidor={rep_id}").json()
    assert res1["totales"]["totalUsd"] == pytest.approx(11.50)
    assert res1["totales"]["liquidadoUsd"] == pytest.approx(8.50)
    assert res1["totales"]["pendienteUsd"] == pytest.approx(3.00)
    m1 = res1["porMotorizado"][0]
    assert m1["liquidadoUsd"] == pytest.approx(8.50) and m1["pendienteUsd"] == pytest.approx(3.00)
    por_cli = {p["clienteId"]: p for p in res1["paradas"]}
    assert por_cli[p1["clienteId"]]["liquidada"] is True and por_cli[p1["clienteId"]]["liquidacionId"] == liq["id"]
    assert por_cli[p3["clienteId"]]["liquidada"] is True and por_cli[p3["clienteId"]]["liquidacionId"] == liq["id"]
    assert por_cli[p2["clienteId"]]["liquidada"] is False and por_cli[p2["clienteId"]]["liquidacionId"] is None

    cuenta = api_rep.get(f"/delivery/mi-cuenta?desde={desde}&hasta={hasta}").json()
    assert cuenta["totales"]["liquidadoUsd"] == pytest.approx(8.50)
    assert cuenta["totales"]["pendienteUsd"] == pytest.approx(3.00)
    assert len(cuenta["pagos"]) == 1 and cuenta["pagos"][0]["totalUsd"] == pytest.approx(8.50)

    # Cambiar el tabulador no altera lo ya pagado ($8.50); la parada pendiente toma la nueva tarifa ($4.00)
    r_tab = api.put(
        "/delivery/tabulador",
        json={"rangos": [{"hastaKm": 10, "montoUsd": 4.00}, {"hastaKm": None, "montoUsd": 7.00}]},
    )
    assert r_tab.status_code == 200, r_tab.text

    res2 = api.get(f"/delivery/resumen?desde={desde}&hasta={hasta}&repartidor={rep_id}").json()
    assert res2["totales"]["liquidadoUsd"] == pytest.approx(8.50)
    assert res2["totales"]["pendienteUsd"] == pytest.approx(4.00)

    # Liquidar el resto sin especificar `paradas` paga solo p2 (no vuelve a pagar p1 ni p3)
    r_rest = api.post(
        "/delivery/liquidaciones",
        json={"repartidorId": rep_id, "desde": desde, "hasta": hasta, "nota": "Saldo"},
    )
    assert r_rest.status_code == 200, r_rest.text
    liq2 = r_rest.json()
    assert liq2["entregas"] == 1 and liq2["totalUsd"] == pytest.approx(4.00)

    res3 = api.get(f"/delivery/resumen?desde={desde}&hasta={hasta}&repartidor={rep_id}").json()
    assert res3["totales"]["pendienteUsd"] == 0.0
    assert res3["totales"]["liquidadoUsd"] == pytest.approx(12.50)

    # Sin pendientes, volver a liquidar da 400
    r_vacio = api.post("/delivery/liquidaciones", json={"repartidorId": rep_id, "desde": desde, "hasta": hasta})
    assert r_vacio.status_code == 400


def test_pago_parcial_impide_doble_pago_y_valida_seleccion(entorno_delivery, cliente_api, usuario, db):
    api = entorno_delivery["api_adm"]
    api_rep = entorno_delivery["api_rep"]
    rep_id = entorno_delivery["rep"]["id"]
    desde, hasta = entorno_delivery["desde"], entorno_delivery["hasta"]

    paradas = api.get(f"/delivery/resumen?desde={desde}&hasta={hasta}&repartidor={rep_id}").json()["paradas"]
    p1, p2, p3 = paradas[0], paradas[1], paradas[2]

    # Permisos y validaciones basicas
    assert api_rep.post(
        "/delivery/liquidaciones",
        json={"repartidorId": rep_id, "desde": desde, "hasta": hasta, "paradas": [_ref(p1)]},
    ).status_code == 403
    assert cliente_api(usuario("DESPACHOS")).post(
        "/delivery/liquidaciones",
        json={"repartidorId": rep_id, "desde": desde, "hasta": hasta, "paradas": [_ref(p1)]},
    ).status_code == 403
    assert api.post(
        "/delivery/liquidaciones",
        json={"repartidorId": rep_id, "desde": "2026-12-31", "hasta": "2026-01-01"},
    ).status_code == 400
    assert api.post(
        "/delivery/liquidaciones",
        json={"repartidorId": rep_id, "desde": desde, "hasta": hasta, "paradas": []},
    ).status_code == 400

    # Referencia duplicada en la lista se deduplica y paga la parada una sola vez
    r_dup = api.post(
        "/delivery/liquidaciones",
        json={"repartidorId": rep_id, "desde": desde, "hasta": hasta, "paradas": [_ref(p1), _ref(p1)]},
    )
    assert r_dup.status_code == 200, r_dup.text
    assert r_dup.json()["entregas"] == 1 and r_dup.json()["totalUsd"] == pytest.approx(p1["montoUsd"])

    # Doble pago de p1 sola -> 409
    r_rep = api.post(
        "/delivery/liquidaciones",
        json={"repartidorId": rep_id, "desde": desde, "hasta": hasta, "paradas": [_ref(p1)]},
    )
    assert r_rep.status_code == 409

    # Todo o nada: mezclar p1 (ya pagada) + p2 (pendiente) -> 409 y p2 sigue pendiente
    antes_liqs = db.execute(
        'SELECT COUNT(*) AS n FROM "LiquidacionDelivery" WHERE "repartidorId" = %s', (rep_id,)
    ).fetchone()["n"]
    r_mix = api.post(
        "/delivery/liquidaciones",
        json={"repartidorId": rep_id, "desde": desde, "hasta": hasta, "paradas": [_ref(p1), _ref(p2)]},
    )
    assert r_mix.status_code == 409
    despues_liqs = db.execute(
        'SELECT COUNT(*) AS n FROM "LiquidacionDelivery" WHERE "repartidorId" = %s', (rep_id,)
    ).fetchone()["n"]
    assert despues_liqs == antes_liqs

    # Parada ajena / inexistente o fuera del periodo -> 409
    r_ajena = api.post(
        "/delivery/liquidaciones",
        json={"repartidorId": rep_id, "desde": desde, "hasta": hasta,
              "paradas": [_ref(p2), {**_ref(p3), "rutaId": "rut-inexistente"}]},
    )
    assert r_ajena.status_code == 409

    r_rango = api.post(
        "/delivery/liquidaciones",
        json={"repartidorId": rep_id, "desde": "2020-01-01", "hasta": "2020-01-31", "paradas": [_ref(p2)]},
    )
    assert r_rango.status_code == 409

    # Confirmar que p2 y p3 siguen intactas y pendientes
    res = api.get(f"/delivery/resumen?desde={desde}&hasta={hasta}&repartidor={rep_id}").json()
    pendientes = {p["clienteId"] for p in res["paradas"] if not p["liquidada"]}
    assert pendientes == {p2["clienteId"], p3["clienteId"]}


def test_morocho_paga_cada_moto_por_separado(db, usuario, cliente_api):
    from app.core.fechas import ahora_utc

    tag = uuid.uuid4().hex[:8]
    alm_id = f"alm-mor-{tag}"
    m1_id = f"veh-mor1-{tag}"
    m2_id = f"veh-mor2-{tag}"
    cli_id = f"cli-mor-{tag}"
    ruta_id = f"rut-mor-{tag}"

    adm = usuario("ADMIN")
    rep1 = usuario("REPARTIDOR")
    rep2 = usuario("REPARTIDOR")

    db.execute(
        'INSERT INTO "Almacen" ("id", "nombre", "tipo", "direccion", "ciudad", "lat", "lng") '
        "VALUES (%s, 'Almacen Morocho', 'Centro de Distribucion', 'Catia', 'Caracas', 10.5, -66.9)",
        (alm_id,),
    )
    db.execute(
        'INSERT INTO "Vehiculo" ("id", "placa", "tipo", "capacidadKg", "almacenBaseId") '
        "VALUES (%s, %s, 'MOTO', 35, %s), (%s, %s, 'MOTO', 35, %s)",
        (m1_id, f"MO1-{tag}", alm_id, m2_id, f"MO2-{tag}", alm_id),
    )
    db.execute('UPDATE "Usuario" SET "vehiculoAsignadoId" = %s WHERE "id" = %s', (m1_id, rep1["id"]))
    db.execute('UPDATE "Usuario" SET "vehiculoAsignadoId" = %s WHERE "id" = %s', (m2_id, rep2["id"]))
    db.execute(
        'INSERT INTO "TabuladorDelivery" ("id", "orden", "hastaKm", "montoUsd") '
        "VALUES (%s, 1, NULL, 4.50) ON CONFLICT (\"orden\") DO UPDATE SET \"hastaKm\" = NULL, \"montoUsd\" = 4.50",
        (f"tab-mor-{tag}",),
    )
    db.execute(
        'INSERT INTO "Cliente" ("id", "empresa", "codigo", "nombre", "tipo", "direccion", "ciudad", '
        '"lat", "lng", "telefono") '
        "VALUES (%s, 'TRALOG', %s, 'Cliente Morocho', 'Tienda', 'Av 1', 'Caracas', 10.52, -66.92, '04140000000')",
        (cli_id, f"CMO-{tag}"),
    )
    db.execute(
        'INSERT INTO "DistanciaCliente" ("id", "almacenId", "clienteId", "km", "fuente") '
        "VALUES (%s, %s, %s, 6.0, 'estimada')",
        (f"dist-mor-{tag}", alm_id, cli_id),
    )
    ahora = ahora_utc()
    entregado_en = ahora - timedelta(hours=5)
    db.execute(
        'INSERT INTO "Ruta" ("id", "numero", "vehiculoId", "vehiculoApoyoId", "origenId", "creadoPorId", '
        '"estado", "salidaProgramada", "iniciadaEn", "completadaEn") '
        "VALUES (%s, %s, %s, %s, %s, %s, 'COMPLETADA', %s, %s, %s)",
        (ruta_id, f"RMO-{tag}", m1_id, m2_id, alm_id, adm["id"],
         ahora - timedelta(hours=7), ahora - timedelta(hours=6), entregado_en),
    )
    db.execute(
        'INSERT INTO "Despacho" ("id", "numero", "numeroDocumento", "tipoDocumento", "origenId", '
        '"destinoClienteId", "creadoPorId", "estado", "rutaId", "ordenEnRuta", "llegadaEn", "entregadoEn") '
        "VALUES (%s, %s, %s, 'FA', %s, %s, %s, 'ENTREGADO', %s, 1, %s, %s)",
        (f"desp-mor-{tag}", f"DMO-{tag}", f"FMO-{tag}", alm_id, cli_id, adm["id"],
         ruta_id, entregado_en - timedelta(minutes=10), entregado_en),
    )
    db.commit()

    api = cliente_api(adm)
    fecha = (entregado_en - timedelta(hours=4)).date().isoformat()
    r1 = api.post(
        "/delivery/liquidaciones",
        json={"repartidorId": rep1["id"], "desde": fecha, "hasta": fecha,
              "paradas": [{"rutaId": ruta_id, "clienteId": cli_id, "vehiculoId": m1_id}]},
    )
    assert r1.status_code == 200 and r1.json()["totalUsd"] == pytest.approx(4.50)

    # La segunda moto del Morocho sigue pendiente y cobra independiente
    res2 = api.get(f"/delivery/resumen?desde={fecha}&hasta={fecha}&repartidor={rep2['id']}").json()
    assert len(res2["paradas"]) == 1 and res2["paradas"][0]["liquidada"] is False
    r2 = api.post(
        "/delivery/liquidaciones",
        json={"repartidorId": rep2["id"], "desde": fecha, "hasta": fecha,
              "paradas": [{"rutaId": ruta_id, "clienteId": cli_id, "vehiculoId": m2_id}]},
    )
    assert r2.status_code == 200 and r2.json()["totalUsd"] == pytest.approx(4.50)
