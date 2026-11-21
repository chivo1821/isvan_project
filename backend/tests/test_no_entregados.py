"""Paradas no entregadas en su ruta (rojo + motivo), reversos y ultima senal
del recorrido, mas asignacion de entrega al repartidor con jornada abierta.
"""

from __future__ import annotations

import uuid
from datetime import timedelta, timezone


def _ms(dt) -> int:
    return int(dt.replace(tzinfo=timezone.utc).timestamp() * 1000)


def test_no_entregados_recorrido_y_jornada_delivery(db, usuario, cliente_api):
    from app.core.auth import hash_password
    from app.core.fechas import ahora_utc

    tag = uuid.uuid4().hex[:8]
    alm_id = f"alm-ne-{tag}"
    moto_id = f"veh-ne-{tag}"
    ruta_id = f"rut-ne-{tag}"
    vacia_id = f"rut-vac-{tag}"
    clave = "ClaveApp123"

    rep = usuario("REPARTIDOR", clave=clave)
    adm = usuario("ADMIN", clave=clave)

    db.execute(
        'INSERT INTO "Almacen" ("id", "nombre", "tipo", "direccion", "ciudad", "lat", "lng") '
        "VALUES (%s, 'Almacen NE', 'Centro de Distribucion', 'Catia', 'Caracas', 10.5, -66.9)",
        (alm_id,),
    )
    db.execute(
        'INSERT INTO "Vehiculo" ("id", "placa", "tipo", "capacidadKg", "almacenBaseId") '
        "VALUES (%s, %s, 'MOTO', 35, %s)",
        (moto_id, f"MN-{tag}", alm_id),
    )
    db.execute('UPDATE "Usuario" SET "vehiculoAsignadoId" = %s WHERE "id" = %s', (moto_id, rep["id"]))
    db.execute(
        'INSERT INTO "TabuladorDelivery" ("id", "orden", "hastaKm", "montoUsd") '
        "VALUES (%s, 1, NULL, 5.0) ON CONFLICT (\"orden\") DO NOTHING",
        (f"tab-{tag}",),
    )

    clientes = []
    for i in range(1, 4):
        cid = f"cli-ne-{tag}-{i}"
        db.execute(
            'INSERT INTO "Cliente" ("id", "empresa", "codigo", "nombre", "tipo", "direccion", "ciudad", '
            '"lat", "lng", "telefono") '
            "VALUES (%s, 'TRALOG', %s, %s, 'Tienda', 'Av 1', 'Caracas', %s, %s, '04140000000')",
            (cid, f"CNE-{tag}-{i}", f"Cliente NE {i}", 10.5 + i * 0.01, -66.9 - i * 0.01),
        )
        db.execute(
            'INSERT INTO "DistanciaCliente" ("id", "almacenId", "clienteId", "km", "fuente") '
            "VALUES (%s, %s, %s, 5.0, 'estimada')",
            (f"dist-{tag}-{i}", alm_id, cid),
        )
        clientes.append(cid)

    ahora = ahora_utc()
    db.execute(
        'INSERT INTO "Ruta" ("id", "numero", "vehiculoId", "origenId", "creadoPorId", "estado", '
        '"salidaProgramada", "iniciadaEn") '
        "VALUES (%s, %s, %s, %s, %s, 'EN_TRANSITO', %s, %s), "
        "(%s, %s, NULL, %s, %s, 'PLANIFICADA', %s, NULL)",
        (
            ruta_id, f"RNE-{tag}", moto_id, alm_id, adm["id"], ahora, ahora - timedelta(hours=1),
            vacia_id, f"RNV-{tag}", alm_id, adm["id"], ahora,
        ),
    )

    tres = []
    for orden, cid in enumerate(clientes, start=1):
        did = f"desp-ne-{tag}-{orden}"
        db.execute(
            'INSERT INTO "Despacho" ("id", "numero", "numeroDocumento", "tipoDocumento", "origenId", '
            '"destinoClienteId", "creadoPorId", "estado", "rutaId", "ordenEnRuta") '
            "VALUES (%s, %s, %s, 'FA', %s, %s, %s, 'EN_TRANSITO', %s, %s)",
            (did, f"DNE-{tag}-{orden}", f"FNE-{tag}-{orden}", alm_id, cid, adm["id"], ruta_id, orden),
        )
        tres.append(did)
    db.commit()

    rep_api = cliente_api()
    t = rep_api.post("/auth/movil/login", json={"email": rep["email"], "password": clave}).json()["token"]
    bearer = {"Authorization": f"Bearer {t}"}
    adm_api = cliente_api(adm)

    # El repartidor llega a la 2 y no la puede entregar.
    assert rep_api.post(f"/rutas/{ruta_id}/paradas/{tres[1]}/llegada", headers=bearer, json={}).status_code == 200
    r = rep_api.post(
        f"/rutas/{ruta_id}/paradas/{tres[1]}/no-entregado",
        headers=bearer,
        json={"motivo": "El local estaba cerrado"},
    )
    assert r.status_code == 200, r.text
    rev = db.execute('SELECT * FROM "DespachoReverso" WHERE "despachoId" = %s', (tres[1],)).fetchone()
    assert rev and rev["ordenEnRuta"] == 2

    d = adm_api.get(f"/rutas/{ruta_id}").json()
    ne = d.get("noEntregados", [])
    assert len(ne) == 1 and ne[0]["despachoId"] == tres[1]
    assert (
        ne[0]["motivo"] == "El local estaba cerrado"
        and ne[0]["usuario"] == "Prueba REPARTIDOR"
        and ne[0]["ordenEnRuta"] == 2
        and ne[0]["alcance"] == "REPARTIDOR"
        and ne[0]["llegadaEn"]
        and ne[0]["cliente"]["nombre"]
    )
    assert tres[1] not in [x["id"] for x in d["despachos"]]

    m_ = rep_api.get(f"/movil/rutas/{ruta_id}", headers=bearer).json()
    assert [n["despachoId"] for n in m_.get("noEntregados", [])] == [tres[1]]
    assert isinstance(m_["noEntregados"][0]["fecha"], str) and m_["noEntregados"][0]["fecha"].endswith(("Z", "+00:00"))
    lista = rep_api.get("/movil/rutas", headers=bearer).json()["rutas"]
    assert any(x["id"] == ruta_id and len(x["noEntregados"]) == 1 for x in lista)

    # La oficina saca la 3: otro tipo de reverso, tambien a la vista.
    r_rev = adm_api.post(f"/despachos/{tres[2]}/reversar", json={"motivo": "El cliente cambio el dia"})
    assert r_rev.status_code == 200, r_rev.text
    ne = adm_api.get(f"/rutas/{ruta_id}").json()["noEntregados"]
    assert [n["despachoId"] for n in ne] == [tres[1], tres[2]] and ne[1]["alcance"] == "DESPACHO"

    # Si la 2 vuelve a esta misma ruta, deja de salir como no entregada.
    db.execute(
        'UPDATE "Despacho" SET "rutaId" = %s, "ordenEnRuta" = 2, "estado" = \'EN_TRANSITO\' WHERE "id" = %s',
        (ruta_id, tres[1]),
    )
    db.commit()
    ne = adm_api.get(f"/rutas/{ruta_id}").json()["noEntregados"]
    assert [n["despachoId"] for n in ne] == [tres[2]]

    # El listado tambien la trae (el dashboard y el seguimiento usan el lote).
    todas = adm_api.get("/rutas").json()
    esta = next(x for x in todas if x["id"] == ruta_id)
    assert len(esta.get("noEntregados", [])) == 1

    # Recorrido: la ultima senal con bateria y repartidor.
    j = rep_api.post("/movil/jornada/iniciar", headers=bearer).json()["jornada"]
    db.execute(
        'UPDATE "Jornada" SET "iniciadaEn" = %s WHERE "id" = %s',
        (ahora_utc() - timedelta(minutes=30), j["id"]),
    )
    db.commit()
    ahora = ahora_utc()
    rep_api.post(
        "/movil/posiciones",
        headers=bearer,
        json={
            "jornadaId": j["id"],
            "enviadoEnMs": _ms(ahora),
            "puntos": [
                {"lat": 10.50, "lng": -66.90, "bateria": 0.5, "precisionM": 9,
                 "tomadaEnMs": _ms(ahora - timedelta(minutes=15))},
                {"lat": 10.51, "lng": -66.91, "bateria": 0.4, "precisionM": 7,
                 "tomadaEnMs": _ms(ahora - timedelta(minutes=12))},
            ],
        },
    )
    rec = adm_api.get(f"/rutas/{ruta_id}/recorrido").json()
    u = rec.get("ultima") or {}
    assert u.get("lat") == 10.51 and u.get("bateria") == 0.4 and u.get("repartidor") == "Prueba REPARTIDOR"
    assert u.get("minutosDesdeUltimo") == 12 and u.get("sinSenal") is True

    # Recien iniciada: sin puntos de la ruta usa la posicion de la jornada.
    db.execute('DELETE FROM "Posicion" WHERE "rutaId" = %s', (ruta_id,))
    db.commit()
    rec = adm_api.get(f"/rutas/{ruta_id}/recorrido").json()
    u = rec.get("ultima") or {}
    assert rec["total"] == 0 and u.get("lat") == 10.51 and u.get("repartidor") == "Prueba REPARTIDOR"

    db.execute('UPDATE "Ruta" SET "estado" = \'COMPLETADA\' WHERE "id" = %s', (ruta_id,))
    db.commit()
    assert adm_api.get(f"/rutas/{ruta_id}/recorrido").json().get("ultima") is None

    # Estado de cuenta: con dos repartidores en la misma moto, la entrega es
    # de quien tenia la jornada abierta (antes se la llevaba el primero por nombre).
    otro_id = f"usr-otro-{tag}"
    otro_email = f"otro.{tag}@pruebas.test"
    db.execute(
        'INSERT INTO "Usuario" ("id", "nombre", "email", "passwordHash", "rol", "vehiculoAsignadoId") '
        "VALUES (%s, 'AAA primero por nombre', %s, %s, 'REPARTIDOR', %s)",
        (otro_id, otro_email, hash_password(clave), moto_id),
    )
    db.execute('UPDATE "Ruta" SET "estado" = \'EN_TRANSITO\', "completadaEn" = NULL WHERE "id" = %s', (ruta_id,))
    db.commit()

    assert rep_api.post(f"/rutas/{ruta_id}/paradas/{tres[0]}/llegada", headers=bearer, json={}).status_code == 200
    r_ent = rep_api.post(f"/rutas/{ruta_id}/paradas/{tres[0]}/entregar", headers=bearer, json={})
    assert r_ent.status_code == 200, r_ent.text

    hoy = (ahora_utc() - timedelta(hours=4)).date()
    q = f"desde={hoy}&hasta={hoy}"
    cuenta = rep_api.get(f"/delivery/mi-cuenta?{q}", headers=bearer).json()
    assert any(p["rutaId"] == ruta_id for p in cuenta["paradas"])

    t_otro = cliente_api().post("/auth/movil/login", json={"email": otro_email, "password": clave}).json()["token"]
    del_otro = rep_api.get(f"/delivery/mi-cuenta?{q}", headers={"Authorization": f"Bearer {t_otro}"}).json()
    assert not any(p["rutaId"] == ruta_id for p in del_otro["paradas"])

    assert adm_api.get(f"/rutas/{vacia_id}/recorrido").json().get("ultima") is None
