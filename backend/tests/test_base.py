"""Pruebas de base: las migraciones se aplican sobre una base vacía, la
sesión funciona y vence, y las horas salen con zona."""

from datetime import datetime


def test_migraciones_dejan_las_extensiones(db):
    extensiones = {f["extname"] for f in db.execute("SELECT extname FROM pg_extension").fetchall()}
    assert {"postgis", "pgrouting"} <= extensiones


def test_login_con_clave_equivocada_da_401(cliente_api, usuario):
    u = usuario()
    r = cliente_api().post("/auth/login", json={"email": u["email"], "password": "otra-clave"})
    assert r.status_code == 401


def test_login_y_me(cliente_api, usuario):
    u = usuario()
    api = cliente_api()
    r = api.post("/auth/login", json={"email": u["email"], "password": u["clave"]})
    assert r.status_code == 200, r.text
    me = api.get("/auth/me")
    assert me.status_code == 200
    assert me.json()["id"] == u["id"]


def test_sesion_vencida_da_401(cliente_api, usuario, db):
    u = usuario()
    api = cliente_api(u)
    assert api.get("/auth/me").status_code == 200
    db.execute(
        """UPDATE "Sesion" SET "expiraEn" = now() AT TIME ZONE 'UTC' - interval '1 minute' WHERE "usuarioId" = %s""",
        (u["id"],),
    )
    db.commit()
    assert api.get("/auth/me").status_code == 401


def test_el_vendedor_no_entra_a_despachos(cliente_api, usuario):
    api = cliente_api(usuario("VENDEDOR"))
    assert api.get("/despachos").status_code == 403


def test_horas_de_las_cargas_con_zona(cliente_api, usuario, db):
    """Las horas se guardan en UTC sin zona; la API las manda con zona (si no,
    el navegador las corre 4 horas)."""
    u = usuario()
    db.execute(
        'INSERT INTO "VentaCarga" ("id", "empresa", "archivo", "periodoDesde", "periodoHasta", "filas", '
        '"subidaPorId", "resumen", "dimensiones") '
        "VALUES ('carga-prueba', 'TRALOG', 'x.xlsx', '2026-11-01', '2026-11-01', 0, %s, '{}', '{}')",
        (u["id"],),
    )
    db.commit()
    r = cliente_api(u).get("/indicadores/cargas?empresa=TRALOG")
    assert r.status_code == 200, r.text
    subida = next(c for c in r.json() if c["id"] == "carga-prueba")["subidaEn"]
    assert datetime.fromisoformat(subida.replace("Z", "+00:00")).tzinfo is not None, subida
