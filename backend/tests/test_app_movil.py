"""Backend de la app movil (fase A0): login Bearer, jornada, lotes de
posiciones con correccion de reloj, seguimiento en vivo, marcas diferidas,
cierre automatico y limpieza.
"""

from __future__ import annotations

import uuid
from datetime import timedelta, timezone

import pytest


def _ms(dt) -> int:
    return int(dt.replace(tzinfo=timezone.utc).timestamp() * 1000)


@pytest.fixture()
def entorno_movil(db, usuario, cliente_api):
    """Crea almacen, dos motos, repartidor asignado, admin, vendedor, cliente,
    ruta en transito con parada y trazado, y una ruta de otra moto."""
    from app.core.fechas import ahora_utc

    tag = uuid.uuid4().hex[:8]
    alm_id = f"alm-mov-{tag}"
    moto_id = f"veh-mov-{tag}"
    otra_moto_id = f"veh-otr-{tag}"
    cli_id = f"cli-mov-{tag}"
    ruta_id = f"rut-mov-{tag}"
    otra_ruta_id = f"rut-otr-{tag}"
    desp_id = f"desp-mov-{tag}"

    clave = "ClaveApp123"
    rep = usuario("REPARTIDOR", clave=clave)
    adm = usuario("ADMIN", clave=clave)
    ven = usuario("VENDEDOR", clave=clave)

    db.execute(
        'INSERT INTO "Almacen" ("id", "nombre", "tipo", "direccion", "ciudad", "lat", "lng") '
        "VALUES (%s, 'Almacen Movil', 'Centro de Distribucion', 'Catia', 'Caracas', 10.5, -66.9)",
        (alm_id,),
    )
    db.execute(
        'INSERT INTO "Vehiculo" ("id", "placa", "tipo", "capacidadKg", "almacenBaseId") '
        "VALUES (%s, %s, 'MOTO', 35, %s), (%s, %s, 'MOTO', 35, %s)",
        (moto_id, f"M1-{tag}", alm_id, otra_moto_id, f"M2-{tag}", alm_id),
    )
    db.execute('UPDATE "Usuario" SET "vehiculoAsignadoId" = %s WHERE "id" = %s', (moto_id, rep["id"]))
    db.execute(
        'INSERT INTO "Cliente" ("id", "empresa", "codigo", "nombre", "tipo", "direccion", "ciudad", '
        '"lat", "lng", "telefono") '
        "VALUES (%s, 'TRALOG', %s, 'Cliente Movil', 'Tienda', 'Calle 1', 'Caracas', 10.51, -66.91, '04141234567')",
        (cli_id, f"CM-{tag}"),
    )
    ahora = ahora_utc()
    db.execute(
        'INSERT INTO "Ruta" ("id", "numero", "vehiculoId", "origenId", "creadoPorId", "estado", '
        '"salidaProgramada", "iniciadaEn") '
        "VALUES (%s, %s, %s, %s, %s, 'EN_TRANSITO', %s, %s), "
        "(%s, %s, %s, %s, %s, 'EN_TRANSITO', %s, %s)",
        (
            ruta_id, f"RM-{tag}", moto_id, alm_id, adm["id"], ahora, ahora - timedelta(hours=1),
            otra_ruta_id, f"RO-{tag}", otra_moto_id, alm_id, adm["id"], ahora, ahora - timedelta(hours=1),
        ),
    )
    db.execute(
        'INSERT INTO "Despacho" ("id", "numero", "numeroDocumento", "tipoDocumento", "origenId", '
        '"destinoClienteId", "creadoPorId", "estado", "rutaId", "ordenEnRuta") '
        "VALUES (%s, %s, %s, 'FA', %s, %s, %s, 'EN_TRANSITO', %s, 1)",
        (desp_id, f"DM-{tag}", f"F-{tag}", alm_id, cli_id, adm["id"], ruta_id),
    )
    db.execute(
        'INSERT INTO "DespachoItem" ("id", "despachoId", "descripcion", "cantidadSolicitada", "cantidad", '
        '"pesoUnitarioKg") VALUES (%s, %s, \'Helado 1L\', 2, 2, 5.0)',
        (f"di-{tag}", desp_id),
    )
    db.execute(
        'INSERT INTO "RutaPunto" ("id", "rutaId", "orden", "lat", "lng", "estado", "timestamp", "paradaDespachoId") '
        "VALUES (%s, %s, 1, 10.5, -66.9, 'salida', %s, NULL), "
        "(%s, %s, 2, 10.51, -66.91, 'en_ruta', %s, %s)",
        (f"rp1-{tag}", ruta_id, ahora, f"rp2-{tag}", ruta_id, ahora, desp_id),
    )
    db.commit()

    return {
        "rep": rep,
        "adm": adm,
        "ven": ven,
        "clave": clave,
        "moto_id": moto_id,
        "ruta_id": ruta_id,
        "otra_ruta_id": otra_ruta_id,
        "desp_id": desp_id,
        "api_anon": lambda: cliente_api(),
        "api_adm": cliente_api(adm),
    }


def _login_movil(api, email: str, password: str, dispositivo: str | None = None):
    payload = {"email": email, "password": password}
    if dispositivo is not None:
        payload["dispositivo"] = dispositivo
    return api.post("/auth/movil/login", json=payload)


def test_login_movil_bearer_y_renovacion(entorno_movil, db):
    from app.core.fechas import ahora_utc

    c = entorno_movil["api_anon"]()
    rep = entorno_movil["rep"]
    adm = entorno_movil["adm"]
    clave = entorno_movil["clave"]

    r = _login_movil(c, rep["email"], clave, "Moto G")
    assert r.status_code == 200, r.text
    assert r.json().get("token")
    assert "sesion_id" not in r.cookies
    token = r.json()["token"]
    bearer = {"Authorization": f"Bearer {token}"}

    ses = db.execute('SELECT * FROM "Sesion" WHERE "usuarioId" = %s', (rep["id"],)).fetchone()
    assert ses["origen"] == "MOVIL"
    assert ses["dispositivo"] == "Moto G"
    assert (ses["expiraEn"] - ahora_utc()).days >= 29

    assert c.get("/auth/me", headers=bearer).json().get("id") == rep["id"]
    assert c.get("/auth/me").status_code == 401
    assert c.get("/auth/me", headers={"Authorization": "Bearer nada"}).status_code == 401

    r_adm = _login_movil(c, adm["email"], clave)
    assert r_adm.status_code == 403 and "página web" in r_adm.text

    r_mala = _login_movil(c, rep["email"], "mala")
    assert r_mala.status_code == 401
    intentos = db.execute('SELECT "intentosFallidos" FROM "Usuario" WHERE "id" = %s', (rep["id"],)).fetchone()
    assert intentos["intentosFallidos"] == 1

    ahora = ahora_utc()
    db.execute(
        'UPDATE "Sesion" SET "ultimoUsoEn" = %s, "expiraEn" = %s WHERE "id" = %s',
        (ahora - timedelta(hours=3), ahora + timedelta(days=1), ses["id"]),
    )
    db.commit()
    assert c.get("/auth/me", headers=bearer).status_code == 200
    ses2 = db.execute('SELECT * FROM "Sesion" WHERE "id" = %s', (ses["id"],)).fetchone()
    assert (ses2["expiraEn"] - ahora_utc()).days >= 29


def test_jornada_posiciones_ruta_seguimiento_y_marcas(entorno_movil, db):
    from app.core.fechas import ahora_utc

    c = entorno_movil["api_anon"]()
    a = entorno_movil["api_adm"]
    rep = entorno_movil["rep"]
    moto = entorno_movil["moto_id"]
    ruta = entorno_movil["ruta_id"]
    otra = entorno_movil["otra_ruta_id"]
    desp_id = entorno_movil["desp_id"]

    r = _login_movil(c, rep["email"], entorno_movil["clave"], "Moto G")
    assert r.status_code == 200, r.text
    bearer = {"Authorization": f"Bearer {r.json()['token']}"}

    # Jornada
    r = c.get("/movil/jornada", headers=bearer)
    assert r.status_code == 200 and r.json()["jornada"] is None and r.json()["segundosEntrePuntos"] == 30
    j1 = c.post("/movil/jornada/iniciar", headers=bearer).json()["jornada"]
    j2 = c.post("/movil/jornada/iniciar", headers=bearer).json()["jornada"]
    assert j1["id"] == j2["id"] and j1["vehiculoId"] == moto
    jid = j1["id"]

    # Posiciones con el reloj del telefono 2 horas adelantado
    ahora = ahora_utc()
    corrido = timedelta(hours=2)
    lote = {
        "jornadaId": jid,
        "enviadoEnMs": _ms(ahora + corrido),
        "puntos": [
            {"lat": 10.50, "lng": -66.90, "precisionM": 8, "bateria": 0.8,
             "tomadaEnMs": _ms(ahora + corrido - timedelta(seconds=60))},
            {"lat": 10.51, "lng": -66.91, "precisionM": 9, "bateria": 0.79,
             "tomadaEnMs": _ms(ahora + corrido - timedelta(seconds=30))},
            {"lat": 10.51, "lng": -66.91,
             "tomadaEnMs": _ms(ahora + corrido - timedelta(hours=5))},  # antes de la jornada
        ],
    }
    r = c.post("/movil/posiciones", json=lote, headers=bearer)
    assert r.status_code == 200, r.text
    assert r.json() == {"recibidos": 3, "nuevos": 2, "jornadaAbierta": True}

    pos = db.execute('SELECT * FROM "Posicion" WHERE "jornadaId" = %s ORDER BY "tomadaEn"', (jid,)).fetchall()
    assert abs((pos[-1]["tomadaEn"] - (ahora - timedelta(seconds=30))).total_seconds()) < 5

    r_dup = c.post("/movil/posiciones", json=lote, headers=bearer)
    assert r_dup.json()["nuevos"] == 0

    up = db.execute('SELECT * FROM "UltimaPosicion" WHERE "usuarioId" = %s', (rep["id"],)).fetchone()
    assert up and up["lat"] == 10.51

    viejo = {
        "jornadaId": jid,
        "enviadoEnMs": _ms(ahora_utc()),
        "puntos": [{"lat": 1.0, "lng": 1.0, "tomadaEnMs": _ms(ahora_utc() - timedelta(minutes=20))}],
    }
    c.post("/movil/posiciones", json=viejo, headers=bearer)
    up = db.execute('SELECT * FROM "UltimaPosicion" WHERE "usuarioId" = %s', (rep["id"],)).fetchone()
    assert up["lat"] == 10.51

    assert c.post("/movil/posiciones", json={**lote, "jornadaId": "jor-ajena"}, headers=bearer).status_code == 404

    # Ruta en transito de su moto: los puntos se le asignan
    ahora = ahora_utc()
    c.post(
        "/movil/posiciones",
        headers=bearer,
        json={"jornadaId": jid, "enviadoEnMs": _ms(ahora),
              "puntos": [{"lat": 10.52, "lng": -66.92, "tomadaEnMs": _ms(ahora - timedelta(seconds=5))}]},
    )
    p = db.execute(
        'SELECT "rutaId" FROM "Posicion" WHERE "jornadaId" = %s ORDER BY "tomadaEn" DESC LIMIT 1', (jid,)
    ).fetchone()
    assert p["rutaId"] == ruta

    r_rutas = c.get("/movil/rutas", headers=bearer)
    assert r_rutas.status_code == 200, r_rutas.text
    mias = r_rutas.json()["rutas"]
    assert any(x["id"] == ruta for x in mias)
    mia = next(x for x in mias if x["id"] == ruta)
    assert mia["paradas"] and "telefono" in mia["paradas"][0]["cliente"]
    assert mia["vehiculo"]["tipo"] == "MOTO" and mia["esMoto"]

    r_det = c.get(f"/movil/rutas/{ruta}", headers=bearer)
    assert r_det.status_code == 200
    assert isinstance(r_det.json().get("trazado"), list) and len(r_det.json()["trazado"]) <= 401
    assert c.get(f"/movil/rutas/{otra}", headers=bearer).status_code == 404

    # Seguimiento en vivo
    r_seg = a.get("/rutas/seguimiento/repartidores")
    assert r_seg.status_code == 200, r_seg.text
    yo = [x for x in r_seg.json()["repartidores"] if x["usuarioId"] == rep["id"]]
    assert yo and yo[0]["rutaId"] == ruta and not yo[0]["sinSenal"]
    r_rec = a.get(f"/rutas/{ruta}/recorrido")
    assert r_rec.status_code == 200 and r_rec.json()["total"] >= 1
    assert c.get("/rutas/seguimiento/repartidores", headers=bearer).status_code == 403

    # Marcas diferidas
    r_ll = c.post(
        f"/rutas/{ruta}/paradas/{desp_id}/llegada",
        headers=bearer,
        json={"haceSegundos": 600, "lat": 10.5, "lng": -66.9},
    )
    d = db.execute('SELECT * FROM "Despacho" WHERE "id" = %s', (desp_id,)).fetchone()
    assert r_ll.status_code == 200
    assert abs((ahora_utc() - d["llegadaEn"]).total_seconds() - 600) < 10
    assert d["llegadaLat"] == 10.5

    r_ent = c.post(f"/rutas/{ruta}/paradas/{desp_id}/entregar", headers=bearer)
    d = db.execute('SELECT * FROM "Despacho" WHERE "id" = %s', (desp_id,)).fetchone()
    assert r_ent.status_code == 200 and d["estado"] == "ENTREGADO" and d["entregadoLat"] is None

    # Seguimiento sin senal
    db.execute(
        'UPDATE "UltimaPosicion" SET "tomadaEn" = %s WHERE "usuarioId" = %s',
        (ahora_utc() - timedelta(minutes=30), rep["id"]),
    )
    db.commit()
    yo = [x for x in a.get("/rutas/seguimiento/repartidores").json()["repartidores"] if x["usuarioId"] == rep["id"]]
    assert yo and yo[0]["sinSenal"] and yo[0]["minutosDesdeUltimo"] >= 29
    sin_senal_badge = a.get("/rutas/seguimiento/sin-senal")
    assert sin_senal_badge.status_code == 200 and sin_senal_badge.json()["sinSenal"] >= 1


def test_terminar_cierre_automatico_y_limpieza(entorno_movil, db):
    from app.core.fechas import ahora_utc
    from app.services import jornadas

    c = entorno_movil["api_anon"]()
    rep = entorno_movil["rep"]
    token = _login_movil(c, rep["email"], entorno_movil["clave"], "Moto G").json()["token"]
    bearer = {"Authorization": f"Bearer {token}"}

    jid = c.post("/movil/jornada/iniciar", headers=bearer).json()["jornada"]["id"]
    ahora = ahora_utc()
    r = c.post(
        "/movil/posiciones",
        headers=bearer,
        json={
            "jornadaId": jid,
            "enviadoEnMs": _ms(ahora),
            "puntos": [
                {"lat": 10.50, "lng": -66.90, "tomadaEnMs": _ms(ahora - timedelta(seconds=60))},
                {"lat": 10.51, "lng": -66.91, "tomadaEnMs": _ms(ahora - timedelta(seconds=30))},
            ],
        },
    )
    assert r.status_code == 200 and r.json()["nuevos"] == 2

    # Terminar y puntos tardios
    antes_de_cerrar = ahora_utc()
    r_term = c.post("/movil/jornada/terminar", headers=bearer)
    assert r_term.status_code == 200 and r_term.json()["jornada"] is None
    r_tard = c.post(
        "/movil/posiciones",
        headers=bearer,
        json={
            "jornadaId": jid,
            "enviadoEnMs": _ms(ahora_utc()),
            "puntos": [
                {"lat": 10.53, "lng": -66.93, "tomadaEnMs": _ms(antes_de_cerrar - timedelta(seconds=20))},
                {"lat": 10.54, "lng": -66.94, "tomadaEnMs": _ms(ahora_utc() + timedelta(minutes=10))},
            ],
        },
    )
    assert r_tard.json() == {"recibidos": 2, "nuevos": 1, "jornadaAbierta": False}
    assert c.post("/movil/jornada/terminar", headers=bearer).status_code == 200

    # Cierre automatico a las 16 h
    j3 = c.post("/movil/jornada/iniciar", headers=bearer).json()["jornada"]
    db.execute(
        'UPDATE "Jornada" SET "iniciadaEn" = %s WHERE "id" = %s',
        (ahora_utc() - timedelta(hours=17), j3["id"]),
    )
    db.commit()
    r_auto = c.get("/movil/jornada", headers=bearer)
    cierre = db.execute('SELECT "cierre", "terminadaEn" FROM "Jornada" WHERE "id" = %s', (j3["id"],)).fetchone()
    assert r_auto.json()["jornada"] is None and cierre["cierre"] == "AUTOMATICO"

    # Limpieza de puntos > 60 dias
    db.execute('UPDATE "Posicion" SET "tomadaEn" = "tomadaEn" - interval \'90 days\' WHERE "jornadaId" = %s', (jid,))
    db.commit()
    with db.cursor() as cur:
        borrados = jornadas.limpiar_viejas(cur)
    db.commit()
    assert borrados >= 3


def test_permisos_vendedor_sesiones_moviles_y_login_web(entorno_movil):
    c = entorno_movil["api_anon"]()
    a = entorno_movil["api_adm"]
    rep = entorno_movil["rep"]
    adm = entorno_movil["adm"]
    ven = entorno_movil["ven"]
    clave = entorno_movil["clave"]

    rv = c.post("/auth/movil/login", json={"email": ven["email"], "password": clave})
    assert rv.status_code == 200, rv.text
    assert c.get("/movil/jornada", headers={"Authorization": f"Bearer {rv.json()['token']}"}).status_code == 403

    r_rep = _login_movil(c, rep["email"], clave, "Moto G")
    bearer = {"Authorization": f"Bearer {r_rep.json()['token']}"}
    assert len(a.get(f"/usuarios/{rep['id']}/sesiones-moviles").json()) == 1

    r_del = a.delete(f"/usuarios/{rep['id']}/sesiones-moviles")
    assert r_del.json() == {"cerradas": 1}
    assert c.get("/auth/me", headers=bearer).status_code == 401

    r2 = _login_movil(c, rep["email"], clave)
    t2 = {"Authorization": f"Bearer {r2.json()['token']}"}
    c.post("/auth/logout", headers=t2)
    assert c.get("/auth/me", headers=t2).status_code == 401

    w = entorno_movil["api_anon"]()
    r_web = w.post("/auth/login", json={"email": adm["email"], "password": clave})
    assert r_web.status_code == 200 and "sesion_id" in r_web.cookies
    assert w.get("/auth/me").status_code == 200
