"""Anular pagos y «no se paga» de delivery: exclusiones con motivo,
liquidacion excluyendo marcadas, anulacion con historial, rehabilitacion
de entregas, Excel y permisos del repartidor.
"""

from __future__ import annotations

import io
import uuid
from datetime import timedelta

import openpyxl


def test_anular_y_excluir_delivery(db, usuario, cliente_api):
    from app.core.fechas import ahora_utc

    tag = uuid.uuid4().hex[:8]
    alm_id = f"alm-ae-{tag}"
    moto_id = f"veh-ae-{tag}"
    ruta_id = f"rut-ae-{tag}"

    adm = usuario("ADMIN")
    rep_user = usuario("REPARTIDOR")
    rep = rep_user["id"]

    db.execute(
        'INSERT INTO "Almacen" ("id", "nombre", "tipo", "direccion", "ciudad", "lat", "lng") '
        "VALUES (%s, 'Almacen AE', 'Centro de Distribucion', 'Catia', 'Caracas', 10.5, -66.9)",
        (alm_id,),
    )
    db.execute(
        'INSERT INTO "Vehiculo" ("id", "placa", "tipo", "capacidadKg", "almacenBaseId") '
        "VALUES (%s, %s, 'MOTO', 35, %s)",
        (moto_id, f"MAE-{tag}", alm_id),
    )
    db.execute('UPDATE "Usuario" SET "vehiculoAsignadoId" = %s WHERE "id" = %s', (moto_id, rep))
    db.execute(
        'INSERT INTO "TabuladorDelivery" ("id", "orden", "hastaKm", "montoUsd") '
        "VALUES (%s, 1, 10, 2.50) ON CONFLICT (\"orden\") DO UPDATE SET \"hastaKm\" = 10, \"montoUsd\" = 2.50",
        (f"tab1-{tag}",),
    )
    db.execute(
        'INSERT INTO "TabuladorDelivery" ("id", "orden", "hastaKm", "montoUsd") '
        "VALUES (%s, 2, NULL, 4.00) ON CONFLICT (\"orden\") DO UPDATE SET \"hastaKm\" = NULL, \"montoUsd\" = 4.00",
        (f"tab2-{tag}",),
    )

    ahora = ahora_utc()
    entregado_en = ahora - timedelta(hours=5)
    db.execute(
        'INSERT INTO "Ruta" ("id", "numero", "vehiculoId", "origenId", "creadoPorId", "estado", '
        '"salidaProgramada", "iniciadaEn", "completadaEn") '
        "VALUES (%s, %s, %s, %s, %s, 'COMPLETADA', %s, %s, %s)",
        (ruta_id, f"RAE-{tag}", moto_id, alm_id, adm["id"], ahora - timedelta(hours=7),
         ahora - timedelta(hours=6), entregado_en),
    )

    for i in range(1, 4):
        cid = f"cli-ae-{tag}-{i}"
        db.execute(
            'INSERT INTO "Cliente" ("id", "empresa", "codigo", "nombre", "tipo", "direccion", "ciudad", '
            '"lat", "lng", "telefono") '
            "VALUES (%s, 'TRALOG', %s, %s, 'Tienda', 'Av 1', 'Caracas', %s, %s, '04140000000')",
            (cid, f"CAE-{tag}-{i}", f"Cliente AE {i}", 10.5 + i * 0.01, -66.9 - i * 0.01),
        )
        db.execute(
            'INSERT INTO "DistanciaCliente" ("id", "almacenId", "clienteId", "km", "fuente") '
            "VALUES (%s, %s, %s, 5.0, 'estimada')",
            (f"dist-ae-{tag}-{i}", alm_id, cid),
        )
        db.execute(
            'INSERT INTO "Despacho" ("id", "numero", "numeroDocumento", "tipoDocumento", "origenId", '
            '"destinoClienteId", "creadoPorId", "estado", "rutaId", "ordenEnRuta", "llegadaEn", "entregadoEn") '
            "VALUES (%s, %s, %s, 'FA', %s, %s, %s, 'ENTREGADO', %s, %s, %s, %s)",
            (
                f"desp-ae-{tag}-{i}", f"DAE-{tag}-{i}", f"FAE-{tag}-{i}", alm_id, cid, adm["id"],
                ruta_id, i, entregado_en - timedelta(minutes=10), entregado_en,
            ),
        )
    db.commit()

    api = cliente_api(adm)
    desde, hasta = "2025-01-01", "2027-12-31"

    def resumen(repartidor_id=None):
        q = f"desde={desde}&hasta={hasta}" + (f"&repartidor={repartidor_id}" if repartidor_id else "")
        r = api.get(f"/delivery/resumen?{q}")
        assert r.status_code == 200, r.text
        return r.json()

    todo = resumen()
    pend = {}
    for p in todo["paradas"]:
        if p["repartidorId"] and not p["liquidada"] and not p["excluida"] and p["montoUsd"] is not None:
            pend.setdefault(p["repartidorId"], []).append(p)
    mias = pend[rep]
    assert len(mias) >= 3

    def ref(p):
        return {"rutaId": p["rutaId"], "clienteId": p["clienteId"], "vehiculoId": p["vehiculoId"]}

    def clave(p):
        return (p["rutaId"], p["clienteId"], p["vehiculoId"])

    antes = resumen(rep)
    fuera = mias[0]

    # --- No se paga ---
    r = api.post("/delivery/exclusiones", json={"paradas": [ref(fuera)], "motivo": "   "})
    assert r.status_code == 400, r.text
    r = api.post("/delivery/exclusiones", json={"paradas": [ref(fuera)], "motivo": ""})
    assert r.status_code == 422, r.text
    r = api.post(
        "/delivery/exclusiones",
        json={"paradas": [{**ref(fuera), "clienteId": "no-existe"}], "motivo": "prueba"},
    )
    assert r.status_code == 400, r.text
    r = api.post("/delivery/exclusiones", json={"paradas": [ref(fuera)], "motivo": "Ruta vieja de septiembre"})
    assert r.status_code == 200 and r.json()["excluidas"] == 1, r.text

    despues = resumen(rep)
    fila = next(p for p in despues["paradas"] if clave(p) == clave(fuera))
    assert fila["excluida"] and fila["motivoExclusion"] == "Ruta vieja de septiembre" and fila["excluidaPor"]
    t0, t1 = antes["totales"], despues["totales"]
    assert t1["entregas"] == t0["entregas"] - 1
    assert abs(t1["pendienteUsd"] - (t0["pendienteUsd"] - fuera["montoUsd"])) < 0.01
    assert t1["excluidas"] == 1 and abs(t1["excluidoUsd"] - fuera["montoUsd"]) < 0.01
    m1 = next(x for x in despues["porMotorizado"] if x["repartidorId"] == rep)
    assert m1["excluidas"] == 1

    r = api.post(
        "/delivery/liquidaciones",
        json={"repartidorId": rep, "desde": desde, "hasta": hasta, "paradas": [ref(fuera)]},
    )
    assert r.status_code == 409, r.text

    # --- Pagar todo lo demas ---
    r = api.post(
        "/delivery/liquidaciones",
        json={"repartidorId": rep, "desde": desde, "hasta": hasta, "nota": "corte"},
    )
    assert r.status_code == 200 and r.json()["entregas"] == len(mias) - 1, r.text
    liq = r.json()
    pagada = mias[1]
    r = api.post("/delivery/exclusiones", json={"paradas": [ref(pagada)], "motivo": "prueba"})
    assert r.status_code == 409, r.text

    # --- Anular el pago ---
    r = api.post(f"/delivery/liquidaciones/{liq['id']}/anular", json={"motivo": "    "})
    assert r.status_code == 400, r.text
    r = api.post(f"/delivery/liquidaciones/{liq['id']}/anular", json={"motivo": "Se registró de más"})
    assert r.status_code == 200 and r.json()["anuladaEn"] and r.json()["anuladaPor"], r.text
    r = api.post(f"/delivery/liquidaciones/{liq['id']}/anular", json={"motivo": "otra vez"})
    assert r.status_code == 409, r.text
    r = api.post("/delivery/liquidaciones/no-existe/anular", json={"motivo": "prueba"})
    assert r.status_code == 404, r.text

    tras = resumen(rep)
    assert abs(tras["totales"]["pendienteUsd"] - t1["pendienteUsd"]) < 0.01
    assert abs(tras["totales"]["liquidadoUsd"] - t1["liquidadoUsd"]) < 0.01

    det = api.get(f"/delivery/liquidaciones/{liq['id']}").json()
    assert len(det["paradas"]) == liq["entregas"]
    assert abs(sum(p["montoUsd"] for p in det["paradas"]) - liq["totalUsd"]) < 0.01

    lista = api.get(f"/delivery/liquidaciones?repartidor={rep}&desde={desde}&hasta={hasta}").json()
    assert any(x["id"] == liq["id"] and x["motivoAnulacion"] == "Se registró de más" for x in lista)
    fuera_de_rango = api.get(f"/delivery/liquidaciones?repartidor={rep}&desde=2020-01-01&hasta=2020-01-31").json()
    assert all(x["id"] != liq["id"] for x in fuera_de_rango)

    r = api.post(
        "/delivery/liquidaciones",
        json={"repartidorId": rep, "desde": desde, "hasta": hasta, "paradas": [ref(pagada)]},
    )
    assert r.status_code == 200 and r.json()["entregas"] == 1, r.text

    # --- Quitar el no se paga ---
    r = api.post("/delivery/exclusiones/quitar", json={"paradas": [ref(fuera)]})
    assert r.status_code == 200 and r.json()["quitadas"] == 1, r.text
    fila = next(p for p in resumen(rep)["paradas"] if clave(p) == clave(fuera))
    assert not fila["excluida"] and not fila["liquidada"]

    # --- Excel y estado de cuenta ---
    assert api.post("/delivery/exclusiones", json={"paradas": [ref(fuera)], "motivo": "Ruta vieja"}).status_code == 200
    r = api.get(f"/reportes/delivery.xlsx?desde={desde}&hasta={hasta}")
    assert r.status_code == 200 and len(r.content) > 1000
    libro = openpyxl.load_workbook(io.BytesIO(r.content), read_only=True)
    filas = list(libro["Detalle"].iter_rows(values_only=True))
    assert any(f[11] == "No se paga" and f[12] == "Ruta vieja" for f in filas[1:])

    api_rep = cliente_api(rep_user)
    cuenta = api_rep.get(f"/delivery/mi-cuenta?desde={desde}&hasta={hasta}").json()
    assert any(p["id"] == liq["id"] and p["anuladaEn"] for p in cuenta["pagos"])
    assert any(p["excluida"] for p in cuenta["paradas"])
    assert api_rep.post(f"/delivery/liquidaciones/{liq['id']}/anular", json={"motivo": "xxx"}).status_code == 403
    assert api_rep.post("/delivery/exclusiones", json={"paradas": [ref(fuera)], "motivo": "xxx"}).status_code == 403
