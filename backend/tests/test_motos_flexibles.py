"""Pruebas de rutas flexibles para motos (salida por tandas, multiples rutas
en transito, metricas de traslado limpio y espera entre salidas).
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from app.core.fechas import ahora_utc, a_caracas
from app.api.reportes import _PARADAS_CON_TIEMPOS


def test_salida_dos_tandas_estados_y_cierre_automatico(db, usuario, cliente_api):
    tag = uuid.uuid4().hex[:8]
    alm_id = f"alm-{tag}"
    moto_id = f"veh-moto-{tag}"
    ruta_id = f"rut-{tag}"
    clave = "ClaveApp123"

    adm = usuario("ADMIN", clave=clave)
    rep = usuario("REPARTIDOR", clave=clave)

    db.execute(
        'INSERT INTO "Almacen" ("id", "nombre", "tipo", "direccion", "ciudad", "lat", "lng") '
        "VALUES (%s, 'Almacen Test', 'Distribucion', 'Catia', 'Caracas', 10.5, -66.9)",
        (alm_id,),
    )
    db.execute(
        'INSERT INTO "Vehiculo" ("id", "placa", "tipo", "capacidadKg", "almacenBaseId") '
        "VALUES (%s, %s, 'MOTO', 35, %s)",
        (moto_id, f"M-{tag}", alm_id),
    )
    db.execute('UPDATE "Usuario" SET "vehiculoAsignadoId" = %s WHERE "id" = %s', (moto_id, rep["id"]))

    ahora = ahora_utc()
    db.execute(
        'INSERT INTO "Ruta" ("id", "numero", "vehiculoId", "origenId", "creadoPorId", "estado", "salidaProgramada") '
        "VALUES (%s, %s, %s, %s, %s, 'PLANIFICADA', %s)",
        (ruta_id, f"R-{tag}", moto_id, alm_id, adm["id"], ahora),
    )

    despachos = []
    for i in range(1, 6):
        cid = f"cli-{tag}-{i}"
        did = f"desp-{tag}-{i}"
        db.execute(
            'INSERT INTO "Cliente" ("id", "empresa", "codigo", "nombre", "tipo", "direccion", "ciudad", "lat", "lng", "telefono") '
            "VALUES (%s, 'TRALOG', %s, %s, 'Tienda', 'Calle 1', 'Caracas', %s, %s, '04140000000')",
            (cid, f"C-{tag}-{i}", f"Cliente {i}", 10.5 + i * 0.01, -66.9 - i * 0.01),
        )
        db.execute(
            'INSERT INTO "Despacho" ("id", "numero", "numeroDocumento", "tipoDocumento", "origenId", '
            '"destinoClienteId", "creadoPorId", "estado", "rutaId", "ordenEnRuta") '
            "VALUES (%s, %s, %s, 'FA', %s, %s, %s, 'APROBADO', %s, %s)",
            (did, f"D-{tag}-{i}", f"DOC-{tag}-{i}", alm_id, cid, adm["id"], ruta_id, i),
        )
        despachos.append(did)
    db.commit()

    api_rep = cliente_api(rep)

    # 1. Salida Tanda 1 con 2 despachos (despachos[0], despachos[1])
    res_t1 = api_rep.post(
        f"/rutas/{ruta_id}/paradas/salir",
        json={"despachoIds": [despachos[0], despachos[1]], "lat": 10.501, "lng": -66.901},
    )
    assert res_t1.status_code == 200, res_t1.text

    # Verificar estado de la ruta: pasa a EN_TRANSITO con iniciadaEn
    r_db = db.execute('SELECT * FROM "Ruta" WHERE "id" = %s', (ruta_id,)).fetchone()
    assert r_db["estado"] == "EN_TRANSITO"
    assert r_db["iniciadaEn"] is not None

    # Verificar despachos en DB
    d1 = db.execute('SELECT * FROM "Despacho" WHERE "id" = %s', (despachos[0],)).fetchone()
    d2 = db.execute('SELECT * FROM "Despacho" WHERE "id" = %s', (despachos[1],)).fetchone()
    d3 = db.execute('SELECT * FROM "Despacho" WHERE "id" = %s', (despachos[2],)).fetchone()
    d4 = db.execute('SELECT * FROM "Despacho" WHERE "id" = %s', (despachos[3],)).fetchone()
    d5 = db.execute('SELECT * FROM "Despacho" WHERE "id" = %s', (despachos[4],)).fetchone()

    assert d1["estado"] == "EN_TRANSITO" and d1["salidaEn"] is not None and d1["tandaSalida"] is not None
    assert d2["estado"] == "EN_TRANSITO" and d2["salidaEn"] is not None and d2["tandaSalida"] is not None
    assert d1["tandaSalida"] == d2["tandaSalida"]
    assert d1["salidaLat"] == 10.501 and d1["salidaLng"] == -66.901

    # Despachos en almacen siguen APROBADO sin salida
    assert d3["estado"] == "APROBADO" and d3["salidaEn"] is None and d3["tandaSalida"] is None
    assert d4["estado"] == "APROBADO" and d4["salidaEn"] is None and d4["tandaSalida"] is None
    assert d5["estado"] == "APROBADO" and d5["salidaEn"] is None and d5["tandaSalida"] is None

    # 2. Entregar d1 y d2
    assert api_rep.post(f"/rutas/{ruta_id}/paradas/{despachos[0]}/llegada", json={}).status_code == 200
    assert api_rep.post(f"/rutas/{ruta_id}/paradas/{despachos[0]}/entregar", json={}).status_code == 200

    r_db = db.execute('SELECT * FROM "Ruta" WHERE "id" = %s', (ruta_id,)).fetchone()
    assert r_db["estado"] == "EN_TRANSITO", "Ruta no debe cerrarse porque faltan despachos"

    assert api_rep.post(f"/rutas/{ruta_id}/paradas/{despachos[1]}/llegada", json={}).status_code == 200
    assert api_rep.post(f"/rutas/{ruta_id}/paradas/{despachos[1]}/entregar", json={}).status_code == 200

    r_db = db.execute('SELECT * FROM "Ruta" WHERE "id" = %s', (ruta_id,)).fetchone()
    assert r_db["estado"] == "EN_TRANSITO", "Ruta sigue EN_TRANSITO con d3, d4, d5 en almacen"

    # 3. Salida Tanda 2 con los 3 despachos restantes
    res_t2 = api_rep.post(
        f"/rutas/{ruta_id}/paradas/salir",
        json={"despachoIds": [despachos[2], despachos[3], despachos[4]]},
    )
    assert res_t2.status_code == 200, res_t2.text

    d3 = db.execute('SELECT * FROM "Despacho" WHERE "id" = %s', (despachos[2],)).fetchone()
    d4 = db.execute('SELECT * FROM "Despacho" WHERE "id" = %s', (despachos[3],)).fetchone()
    d5 = db.execute('SELECT * FROM "Despacho" WHERE "id" = %s', (despachos[4],)).fetchone()

    assert d3["estado"] == "EN_TRANSITO" and d3["salidaEn"] is not None
    assert d4["estado"] == "EN_TRANSITO" and d4["salidaEn"] is not None
    assert d5["estado"] == "EN_TRANSITO" and d5["salidaEn"] is not None
    assert d3["tandaSalida"] == d4["tandaSalida"] == d5["tandaSalida"]
    assert d3["tandaSalida"] != d1["tandaSalida"]

    # 4. Entregar d3 y d4
    assert api_rep.post(f"/rutas/{ruta_id}/paradas/{despachos[2]}/llegada", json={}).status_code == 200
    assert api_rep.post(f"/rutas/{ruta_id}/paradas/{despachos[2]}/entregar", json={}).status_code == 200
    assert api_rep.post(f"/rutas/{ruta_id}/paradas/{despachos[3]}/llegada", json={}).status_code == 200
    assert api_rep.post(f"/rutas/{ruta_id}/paradas/{despachos[3]}/entregar", json={}).status_code == 200

    r_db = db.execute('SELECT * FROM "Ruta" WHERE "id" = %s', (ruta_id,)).fetchone()
    assert r_db["estado"] == "EN_TRANSITO"

    # 5. Entregar el 5to y ultimo despacho -> cierre automatico a COMPLETADA
    assert api_rep.post(f"/rutas/{ruta_id}/paradas/{despachos[4]}/llegada", json={}).status_code == 200
    res_fin = api_rep.post(f"/rutas/{ruta_id}/paradas/{despachos[4]}/entregar", json={})
    assert res_fin.status_code == 200, res_fin.text

    r_db = db.execute('SELECT * FROM "Ruta" WHERE "id" = %s', (ruta_id,)).fetchone()
    assert r_db["estado"] == "COMPLETADA"
    assert r_db["completadaEn"] is not None


def test_multiples_rutas_en_transito_moto_vs_camion(db, usuario, cliente_api):
    tag = uuid.uuid4().hex[:8]
    alm_id = f"alm-multi-{tag}"
    moto_id = f"veh-moto-{tag}"
    camion_id = f"veh-cam-{tag}"

    adm = usuario("ADMIN")
    rep_moto = usuario("REPARTIDOR")
    rep_cam = usuario("REPARTIDOR")

    db.execute(
        'INSERT INTO "Almacen" ("id", "nombre", "tipo", "direccion", "ciudad", "lat", "lng") '
        "VALUES (%s, 'Almacen Multi', 'Distribucion', 'Catia', 'Caracas', 10.5, -66.9)",
        (alm_id,),
    )
    db.execute(
        'INSERT INTO "Vehiculo" ("id", "placa", "tipo", "capacidadKg", "almacenBaseId") '
        "VALUES (%s, %s, 'MOTO', 35, %s), (%s, %s, 'CAMION_REFRIGERADO', 3500, %s)",
        (moto_id, f"MM-{tag}", alm_id, camion_id, f"MC-{tag}", alm_id),
    )
    db.execute('UPDATE "Usuario" SET "vehiculoAsignadoId" = %s WHERE "id" = %s', (moto_id, rep_moto["id"]))
    db.execute('UPDATE "Usuario" SET "vehiculoAsignadoId" = %s WHERE "id" = %s', (camion_id, rep_cam["id"]))

    cid = f"cli-m-{tag}"
    db.execute(
        'INSERT INTO "Cliente" ("id", "empresa", "codigo", "nombre", "tipo", "direccion", "ciudad", "lat", "lng", "telefono") '
        "VALUES (%s, 'TRALOG', %s, 'Cliente M', 'Tienda', 'Calle 1', 'Caracas', 10.51, -66.91, '04140000000')",
        (cid, f"CM-{tag}"),
    )

    # 2 Rutas para MOTO
    r_m1 = f"rut-m1-{tag}"
    r_m2 = f"rut-m2-{tag}"
    ahora = ahora_utc()
    db.execute(
        'INSERT INTO "Ruta" ("id", "numero", "vehiculoId", "origenId", "creadoPorId", "estado", "salidaProgramada") '
        "VALUES (%s, %s, %s, %s, %s, 'PLANIFICADA', %s), (%s, %s, %s, %s, %s, 'PLANIFICADA', %s)",
        (r_m1, f"RM1-{tag}", moto_id, alm_id, adm["id"], ahora, r_m2, f"RM2-{tag}", moto_id, alm_id, adm["id"], ahora),
    )
    db.execute(
        'INSERT INTO "Despacho" ("id", "numero", "numeroDocumento", "tipoDocumento", "origenId", "destinoClienteId", "creadoPorId", "estado", "rutaId", "ordenEnRuta") '
        "VALUES (%s, %s, %s, 'FA', %s, %s, %s, 'APROBADO', %s, 1), "
        "(%s, %s, %s, 'FA', %s, %s, %s, 'APROBADO', %s, 1)",
        (f"d-m1-{tag}", f"DM1-{tag}", f"DOC-M1-{tag}", alm_id, cid, adm["id"], r_m1, f"d-m2-{tag}", f"DM2-{tag}", f"DOC-M2-{tag}", alm_id, cid, adm["id"], r_m2),
    )

    # 2 Rutas para CAMION_REFRIGERADO
    r_c1 = f"rut-c1-{tag}"
    r_c2 = f"rut-c2-{tag}"
    db.execute(
        'INSERT INTO "Ruta" ("id", "numero", "vehiculoId", "origenId", "creadoPorId", "estado", "salidaProgramada") '
        "VALUES (%s, %s, %s, %s, %s, 'PLANIFICADA', %s), (%s, %s, %s, %s, %s, 'PLANIFICADA', %s)",
        (r_c1, f"RC1-{tag}", camion_id, alm_id, adm["id"], ahora, r_c2, f"RC2-{tag}", camion_id, alm_id, adm["id"], ahora),
    )
    db.execute(
        'INSERT INTO "Despacho" ("id", "numero", "numeroDocumento", "tipoDocumento", "origenId", "destinoClienteId", "creadoPorId", "estado", "rutaId", "ordenEnRuta") '
        "VALUES (%s, %s, %s, 'FA', %s, %s, %s, 'APROBADO', %s, 1), "
        "(%s, %s, %s, 'FA', %s, %s, %s, 'APROBADO', %s, 1)",
        (f"d-c1-{tag}", f"DC1-{tag}", f"DOC-C1-{tag}", alm_id, cid, adm["id"], r_c1, f"d-c2-{tag}", f"DC2-{tag}", f"DOC-C2-{tag}", alm_id, cid, adm["id"], r_c2),
    )
    db.commit()

    api_moto = cliente_api(rep_moto)
    api_cam = cliente_api(rep_cam)

    # Iniciar primera ruta de moto -> 200
    assert api_moto.post(f"/rutas/{r_m1}/iniciar", json={}).status_code == 200
    # Iniciar SEGUNDA ruta de moto -> 200 (Permitido para MOTO!)
    res_m2 = api_moto.post(f"/rutas/{r_m2}/iniciar", json={})
    assert res_m2.status_code == 200, res_m2.text

    rm1_db = db.execute('SELECT "estado" FROM "Ruta" WHERE "id" = %s', (r_m1,)).fetchone()
    rm2_db = db.execute('SELECT "estado" FROM "Ruta" WHERE "id" = %s', (r_m2,)).fetchone()
    assert rm1_db["estado"] == "EN_TRANSITO"
    assert rm2_db["estado"] == "EN_TRANSITO"

    # Iniciar primera ruta de camion -> 200
    assert api_cam.post(f"/rutas/{r_c1}/iniciar", json={}).status_code == 200
    # Iniciar SEGUNDA ruta de camion -> 400 Bloqueado!
    res_c2 = api_cam.post(f"/rutas/{r_c2}/iniciar", json={})
    assert res_c2.status_code == 400
    assert "El vehiculo esta haciendo la ruta" in res_c2.text


def test_rechazo_salir_paradas_validaciones(db, usuario, cliente_api):
    tag = uuid.uuid4().hex[:8]
    alm_id = f"alm-val-{tag}"
    camion_id = f"veh-cam-{tag}"
    moto_id = f"veh-moto-{tag}"
    ruta_cam_id = f"rut-cam-{tag}"
    ruta_moto_id = f"rut-moto-{tag}"

    adm = usuario("ADMIN")
    rep_cam = usuario("REPARTIDOR")
    rep_moto = usuario("REPARTIDOR")

    db.execute(
        'INSERT INTO "Almacen" ("id", "nombre", "tipo", "direccion", "ciudad", "lat", "lng") '
        "VALUES (%s, 'Almacen Val', 'Distribucion', 'Catia', 'Caracas', 10.5, -66.9)",
        (alm_id,),
    )
    db.execute(
        'INSERT INTO "Vehiculo" ("id", "placa", "tipo", "capacidadKg", "almacenBaseId") '
        "VALUES (%s, %s, 'CAMION_REFRIGERADO', 3500, %s), (%s, %s, 'MOTO', 35, %s)",
        (camion_id, f"VC-{tag}", alm_id, moto_id, f"VM-{tag}", alm_id),
    )
    db.execute('UPDATE "Usuario" SET "vehiculoAsignadoId" = %s WHERE "id" = %s', (camion_id, rep_cam["id"]))
    db.execute('UPDATE "Usuario" SET "vehiculoAsignadoId" = %s WHERE "id" = %s', (moto_id, rep_moto["id"]))

    cid = f"cli-val-{tag}"
    db.execute(
        'INSERT INTO "Cliente" ("id", "empresa", "codigo", "nombre", "tipo", "direccion", "ciudad", "lat", "lng", "telefono") '
        "VALUES (%s, 'TRALOG', %s, 'Cliente Val', 'Tienda', 'Calle 1', 'Caracas', 10.51, -66.91, '04140000000')",
        (cid, f"CV-{tag}"),
    )

    ahora = ahora_utc()
    db.execute(
        'INSERT INTO "Ruta" ("id", "numero", "vehiculoId", "origenId", "creadoPorId", "estado", "salidaProgramada") '
        "VALUES (%s, %s, %s, %s, %s, 'PLANIFICADA', %s), (%s, %s, %s, %s, %s, 'PLANIFICADA', %s)",
        (ruta_cam_id, f"RC-{tag}", camion_id, alm_id, adm["id"], ahora, ruta_moto_id, f"RM-{tag}", moto_id, alm_id, adm["id"], ahora),
    )
    d_cam = f"d-cam-{tag}"
    d_m1 = f"d-m1-{tag}"
    d_m2 = f"d-m2-{tag}"
    db.execute(
        'INSERT INTO "Despacho" ("id", "numero", "numeroDocumento", "tipoDocumento", "origenId", "destinoClienteId", "creadoPorId", "estado", "rutaId", "ordenEnRuta") '
        "VALUES (%s, %s, %s, 'FA', %s, %s, %s, 'APROBADO', %s, 1), "
        "(%s, %s, %s, 'FA', %s, %s, %s, 'APROBADO', %s, 1), "
        "(%s, %s, %s, 'FA', %s, %s, %s, 'APROBADO', %s, 2)",
        (d_cam, f"DCAM-{tag}", f"DOC-CAM-{tag}", alm_id, cid, adm["id"], ruta_cam_id,
         d_m1, f"DM1-{tag}", f"DOC-M1V-{tag}", alm_id, cid, adm["id"], ruta_moto_id,
         d_m2, f"DM2-{tag}", f"DOC-M2V-{tag}", alm_id, cid, adm["id"], ruta_moto_id),
    )
    db.commit()

    api_cam = cliente_api(rep_cam)
    api_moto = cliente_api(rep_moto)

    # 1. Intentar salir paradas en camion -> 400
    res_cam = api_cam.post(f"/rutas/{ruta_cam_id}/paradas/salir", json={"despachoIds": [d_cam]})
    assert res_cam.status_code == 400
    assert "La salida por paradas solo aplica a motos" in res_cam.text

    # 2. Intentar salir con despacho ajeno a la ruta -> 400
    res_ajeno = api_moto.post(f"/rutas/{ruta_moto_id}/paradas/salir", json={"despachoIds": [d_cam]})
    assert res_ajeno.status_code == 400

    # 3. Salir con d_m1 -> 200
    res_ok = api_moto.post(f"/rutas/{ruta_moto_id}/paradas/salir", json={"despachoIds": [d_m1]})
    assert res_ok.status_code == 200

    # 4. Intentar salir de nuevo con d_m1 (ya en transito) -> 400
    res_duplicado = api_moto.post(f"/rutas/{ruta_moto_id}/paradas/salir", json={"despachoIds": [d_m1]})
    assert res_duplicado.status_code == 400
    assert "ya salio" in res_duplicado.text

    # 5. Entregar d_m1
    assert api_moto.post(f"/rutas/{ruta_moto_id}/paradas/{d_m1}/llegada", json={}).status_code == 200
    assert api_moto.post(f"/rutas/{ruta_moto_id}/paradas/{d_m1}/entregar", json={}).status_code == 200

    # 6. Intentar salir con d_m1 (ya entregado) -> 400
    res_entregado = api_moto.post(f"/rutas/{ruta_moto_id}/paradas/salir", json={"despachoIds": [d_m1]})
    assert res_entregado.status_code == 400
    assert "ya fue entregado" in res_entregado.text


def test_reportes_traslado_limpio_y_espera_entre_salidas(db, usuario, cliente_api):
    tag = uuid.uuid4().hex[:8]
    alm_id = f"alm-rep-{tag}"
    moto_id = f"veh-rep-{tag}"
    ruta_id = f"rut-rep-{tag}"

    adm = usuario("ADMIN")
    rep = usuario("REPARTIDOR")

    db.execute(
        'INSERT INTO "Almacen" ("id", "nombre", "tipo", "direccion", "ciudad", "lat", "lng") '
        "VALUES (%s, 'Almacen Rep', 'Distribucion', 'Catia', 'Caracas', 10.5, -66.9)",
        (alm_id,),
    )
    db.execute(
        'INSERT INTO "Vehiculo" ("id", "placa", "tipo", "capacidadKg", "almacenBaseId") '
        "VALUES (%s, %s, 'MOTO', 35, %s)",
        (moto_id, f"MR-{tag}", alm_id),
    )
    db.execute('UPDATE "Usuario" SET "vehiculoAsignadoId" = %s WHERE "id" = %s', (moto_id, rep["id"]))

    cid = f"cli-rep-{tag}"
    db.execute(
        'INSERT INTO "Cliente" ("id", "empresa", "codigo", "nombre", "tipo", "direccion", "ciudad", "lat", "lng", "telefono") '
        "VALUES (%s, 'TRALOG', %s, 'Cliente Rep', 'Tienda', 'Calle 1', 'Caracas', 10.51, -66.91, '04140000000')",
        (cid, f"CR-{tag}"),
    )

    # Base de tiempo: hoy a las 08:00 UTC
    base = ahora_utc().replace(hour=8, minute=0, second=0, microsecond=0)
    db.execute(
        'INSERT INTO "Ruta" ("id", "numero", "vehiculoId", "origenId", "creadoPorId", "estado", "fechaCreacion", "salidaProgramada", "iniciadaEn", "distanciaTotalKm") '
        "VALUES (%s, %s, %s, %s, %s, 'COMPLETADA', %s, %s, %s, 10.0)",
        (ruta_id, f"RR-{tag}", moto_id, alm_id, adm["id"], base, base, base),
    )

    # Tanda 1: salida 08:00
    # d1: llegada 08:20 (traslado 20m), entregado 08:30 (atencion 10m)
    # d2: llegada 08:50 (traslado 20m), entregado 09:00 (atencion 10m)
    # MAX(entregadoEn) tanda 1 = 09:00
    tanda_1 = f"tanda-1-{tag}"
    d1 = f"d1-{tag}"
    d2 = f"d2-{tag}"
    db.execute(
        'INSERT INTO "Despacho" ("id", "numero", "numeroDocumento", "tipoDocumento", "origenId", "destinoClienteId", "creadoPorId", "estado", '
        '"fechaCreacion", "rutaId", "ordenEnRuta", "salidaEn", "tandaSalida", "llegadaEn", "entregadoEn") VALUES '
        "(%s, %s, %s, 'FA', %s, %s, %s, 'ENTREGADO', %s, %s, 1, %s, %s, %s, %s), "
        "(%s, %s, %s, 'FA', %s, %s, %s, 'ENTREGADO', %s, %s, 2, %s, %s, %s, %s)",
        (
            d1, f"D1-{tag}", f"DOC1-{tag}", alm_id, cid, adm["id"], base, ruta_id, base, tanda_1, base + timedelta(minutes=20), base + timedelta(minutes=30),
            d2, f"D2-{tag}", f"DOC2-{tag}", alm_id, cid, adm["id"], base, ruta_id, base, tanda_1, base + timedelta(minutes=50), base + timedelta(minutes=60),
        ),
    )

    # Espera en almacen: de 09:00 a 10:30 = 90 minutos
    # Tanda 2: salida 10:30 (base + 150m)
    # d3: llegada 10:50 (traslado 20m desde salida 10:30), entregado 11:00 (atencion 10m)
    # d4: llegada 11:20 (traslado 20m desde 11:00), entregado 11:30 (atencion 10m)
    tanda_2 = f"tanda-2-{tag}"
    salida_t2 = base + timedelta(minutes=150)
    d3 = f"d3-{tag}"
    d4 = f"d4-{tag}"
    db.execute(
        'INSERT INTO "Despacho" ("id", "numero", "numeroDocumento", "tipoDocumento", "origenId", "destinoClienteId", "creadoPorId", "estado", '
        '"fechaCreacion", "rutaId", "ordenEnRuta", "salidaEn", "tandaSalida", "llegadaEn", "entregadoEn") VALUES '
        "(%s, %s, %s, 'FA', %s, %s, %s, 'ENTREGADO', %s, %s, 3, %s, %s, %s, %s), "
        "(%s, %s, %s, 'FA', %s, %s, %s, 'ENTREGADO', %s, %s, 4, %s, %s, %s, %s)",
        (
            d3, f"D3-{tag}", f"DOC3-{tag}", alm_id, cid, adm["id"], base, ruta_id, salida_t2, tanda_2, salida_t2 + timedelta(minutes=20), salida_t2 + timedelta(minutes=30),
            d4, f"D4-{tag}", f"DOC4-{tag}", alm_id, cid, adm["id"], base, ruta_id, salida_t2, tanda_2, salida_t2 + timedelta(minutes=50), salida_t2 + timedelta(minutes=60),
        ),
    )
    db.commit()

    # Verificar que el SQL de _PARADAS_CON_TIEMPOS calcula exactamente 20 min de traslado para cada una
    with db.cursor() as cur:
        cur.execute(f'SELECT * FROM ({_PARADAS_CON_TIEMPOS}) t WHERE "vehiculoId" = %s', (moto_id,))
        filas_moto = cur.fetchall()
        assert len(filas_moto) == 4
        # Si d3 hubiera tomado la entrega anterior (09:00), su traslado habria sido 110 min!
        # Con la tanda, mide 20 min exactos:
        assert [round(f["traslado"], 1) for f in filas_moto] == [20.0, 20.0, 20.0, 20.0]

    api_adm = cliente_api(adm)

    # Probar endpoint GET /reportes/rendimiento
    res_rend = api_adm.get("/reportes/rendimiento")
    assert res_rend.status_code == 200, res_rend.text
    data = res_rend.json()

    # Espera entre tandas para esta moto: 10:30 - 09:00 = 90 minutos
    cond = next((c for c in data["porConductor"] if c["placa"] == f"MR-{tag}"), None)
    assert cond is not None
    assert cond["esperaEntreSalidasMin"] == 90.0

    # Espera global informativa en el resumen
    assert data["esperaEntreSalidasMin"] is not None
    assert data["esperaEntreSalidasMin"] in (45.0, 90.0)

    # Probar tambien que GET /reportes/resumen devuelve lo mismo
    res_resumen = api_adm.get("/reportes/resumen")
    assert res_resumen.status_code == 200
    assert res_resumen.json()["esperaEntreSalidasMin"] in (45.0, 90.0)

    # Probar descarga Excel de despachos
    res_excel = api_adm.get("/reportes/despachos.xlsx")
    assert res_excel.status_code == 200
    assert res_excel.headers["content-type"].startswith("application/vnd.openxmlformats-officedocument")


def test_reverso_mixto_y_movil_y_delivery(db, usuario, cliente_api):
    tag = uuid.uuid4().hex[:8]
    alm_id = f"alm-rev-{tag}"
    moto_id = f"veh-rev-{tag}"
    ruta_id = f"rut-rev-{tag}"
    clave = "ClaveApp123"

    adm = usuario("ADMIN", clave=clave)
    rep = usuario("REPARTIDOR", clave=clave)

    db.execute(
        'INSERT INTO "Almacen" ("id", "nombre", "tipo", "direccion", "ciudad", "lat", "lng") '
        "VALUES (%s, 'Almacen Rev', 'Distribucion', 'Catia', 'Caracas', 10.5, -66.9)",
        (alm_id,),
    )
    db.execute(
        'INSERT INTO "Vehiculo" ("id", "placa", "tipo", "capacidadKg", "almacenBaseId") '
        "VALUES (%s, %s, 'MOTO', 35, %s)",
        (moto_id, f"MV-{tag}", alm_id),
    )
    db.execute('UPDATE "Usuario" SET "vehiculoAsignadoId" = %s WHERE "id" = %s', (moto_id, rep["id"]))

    cid = f"cli-rev-{tag}"
    db.execute(
        'INSERT INTO "Cliente" ("id", "empresa", "codigo", "nombre", "tipo", "direccion", "ciudad", "lat", "lng", "telefono") '
        "VALUES (%s, 'TRALOG', %s, 'Cliente Rev', 'Tienda', 'Calle 1', 'Caracas', 10.51, -66.91, '04140000000')",
        (cid, f"CRV-{tag}"),
    )
    db.execute(
        'INSERT INTO "DistanciaCliente" ("id", "almacenId", "clienteId", "km", "fuente") '
        "VALUES (%s, %s, %s, 4.0, 'estimada')",
        (f"dist-{tag}", alm_id, cid),
    )
    db.execute(
        'INSERT INTO "TabuladorDelivery" ("id", "orden", "hastaKm", "montoUsd") '
        "VALUES (%s, 1, NULL, 5.0) ON CONFLICT (\"orden\") DO NOTHING",
        (f"tab-{tag}",),
    )

    ahora = ahora_utc()
    db.execute(
        'INSERT INTO "Ruta" ("id", "numero", "vehiculoId", "origenId", "creadoPorId", "estado", "salidaProgramada", "iniciadaEn") '
        "VALUES (%s, %s, %s, %s, %s, 'EN_TRANSITO', %s, %s)",
        (ruta_id, f"RRV-{tag}", moto_id, alm_id, adm["id"], ahora, ahora),
    )

    d1 = f"d-rev-1-{tag}"
    d2 = f"d-rev-2-{tag}"
    d3 = f"d-rev-3-{tag}"

    # d1: ENTREGADO
    # d2: EN_TRANSITO (salio en tanda)
    # d3: APROBADO (sigue en almacen)
    tanda = f"tanda-rev-{tag}"
    db.execute(
        'INSERT INTO "Despacho" ("id", "numero", "numeroDocumento", "tipoDocumento", "origenId", "destinoClienteId", "creadoPorId", "estado", '
        '"rutaId", "ordenEnRuta", "salidaEn", "tandaSalida", "llegadaEn", "entregadoEn") VALUES '
        "(%s, %s, %s, 'FA', %s, %s, %s, 'ENTREGADO', %s, 1, %s, %s, %s, %s), "
        "(%s, %s, %s, 'FA', %s, %s, %s, 'EN_TRANSITO', %s, 2, %s, %s, %s, NULL), "
        "(%s, %s, %s, 'FA', %s, %s, %s, 'APROBADO', %s, 3, NULL, NULL, NULL, NULL)",
        (
            d1, f"DR1-{tag}", f"DOC-R1-{tag}", alm_id, cid, adm["id"], ruta_id, ahora, tanda, ahora, ahora + timedelta(minutes=10),
            d2, f"DR2-{tag}", f"DOC-R2-{tag}", alm_id, cid, adm["id"], ruta_id, ahora, tanda, ahora + timedelta(minutes=15),
            d3, f"DR3-{tag}", f"DOC-R3-{tag}", alm_id, cid, adm["id"], ruta_id,
        ),
    )
    db.commit()

    api_rep = cliente_api()
    t = api_rep.post("/auth/movil/login", json={"email": rep["email"], "password": clave}).json()["token"]
    bearer = {"Authorization": f"Bearer {t}"}

    # 1. Verificar movil API incluye tipoVehiculo y paradas salidaEn, tandaSalida
    res_movil_rutas = api_rep.get("/movil/rutas", headers=bearer)
    assert res_movil_rutas.status_code == 200
    rutas_movil = res_movil_rutas.json()["rutas"]
    esta_ruta = next(r for r in rutas_movil if r["id"] == ruta_id)
    assert esta_ruta["tipoVehiculo"] == "MOTO"
    assert esta_ruta["esMoto"] is True
    p1 = next(p for p in esta_ruta["paradas"] if p["despachoId"] == d1)
    p2 = next(p for p in esta_ruta["paradas"] if p["despachoId"] == d2)
    p3 = next(p for p in esta_ruta["paradas"] if p["despachoId"] == d3)
    assert p1["salidaEn"] is not None and p1["tandaSalida"] == tanda
    assert p2["salidaEn"] is not None and p2["tandaSalida"] == tanda
    assert p3["salidaEn"] is None and p3["tandaSalida"] is None

    # Detalle individual
    res_det = api_rep.get(f"/movil/rutas/{ruta_id}", headers=bearer)
    assert res_det.status_code == 200
    assert res_det.json()["tipoVehiculo"] == "MOTO"

    # 2. Intento de marcar no-entregado en d3 (que sigue en almacen, no salio) -> 400
    res_no_d3 = api_rep.post(
        f"/rutas/{ruta_id}/paradas/{d3}/no-entregado",
        headers=bearer,
        json={"motivo": "Aun no salio"},
    )
    assert res_no_d3.status_code == 400

    # 3. Marcar d2 (que esta en transito) como no-entregado -> 200
    res_no_d2 = api_rep.post(
        f"/rutas/{ruta_id}/paradas/{d2}/no-entregado",
        headers=bearer,
        json={"motivo": "Cliente ausente"},
    )
    assert res_no_d2.status_code == 200

    # Verificar que reversos.liberar limpio salidaEn, tandaSalida, salidaLat, salidaLng
    d2_db = db.execute('SELECT * FROM "Despacho" WHERE "id" = %s', (d2,)).fetchone()
    assert d2_db["estado"] == "APROBADO"
    assert d2_db["rutaId"] is None
    assert d2_db["salidaEn"] is None
    assert d2_db["tandaSalida"] is None
    assert d2_db["salidaLat"] is None
    assert d2_db["salidaLng"] is None

    # 4. Liquidacion delivery intacta
    api_adm = cliente_api(adm)
    hoy = ahora.date().isoformat()
    res_deliv = api_adm.get(f"/delivery/resumen?desde={hoy}&hasta={hoy}&repartidor={rep['id']}")
    assert res_deliv.status_code == 200
    deliv_data = res_deliv.json()
    assert "paradas" in deliv_data
