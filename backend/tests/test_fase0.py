"""Fase 0 del sistema administrativo: empresas, permisos, interruptores,
bitacora, numeracion, cola de tareas y catalogo."""

import io
import threading
import uuid

import openpyxl
import psycopg
import pytest


def test_empresas_iniciales_sin_datos_fiscales(cliente_api, usuario):
    r = cliente_api(usuario()).get("/empresas")
    assert r.status_code == 200
    por_codigo = {e["codigo"]: e for e in r.json()}
    assert {"ISVAN", "TRALOG"} <= set(por_codigo)
    assert "rif" in por_codigo["TRALOG"]["faltaParaFacturar"]
    assert por_codigo["TRALOG"]["modulos"] == {"ventas": False, "inventario": False}


DATOS_TRALOG = {
    "rif": "j123456789",
    "razonSocial": "TRALOG C.A.",
    "domicilioFiscal": "Av. Principal, Caracas",
    "correo": "facturas@tralog.test",
    "contribuyenteEspecial": True,
    "agenteRetencionIva": True,
    "porcentajeRetencionIva": 75,
}


def test_editar_empresa_y_bitacora(cliente_api, usuario, db):
    api = cliente_api(usuario())
    r = api.put("/empresas/emp-tralog", json=DATOS_TRALOG)
    assert r.status_code == 200, r.text
    assert r.json()["rif"] == "J-12345678-9"
    assert r.json()["faltaParaFacturar"] == []
    filas = db.execute(
        'SELECT "accion" FROM "Bitacora" WHERE "entidad" = \'EmpresaFiscal\' AND "entidadId" = \'emp-tralog\''
    ).fetchall()
    assert any(f["accion"] == "editar" for f in filas)
    malo = api.put("/empresas/emp-tralog", json={**DATOS_TRALOG, "rif": "123"})
    assert malo.status_code == 400
    sin_porcentaje = api.put("/empresas/emp-tralog", json={**DATOS_TRALOG, "porcentajeRetencionIva": 50})
    assert sin_porcentaje.status_code == 400


def test_solo_quien_administra_edita_empresas(cliente_api, usuario):
    r = cliente_api(usuario("DESPACHOS")).put("/empresas/emp-tralog", json=DATOS_TRALOG)
    assert r.status_code == 403


def test_modulo_ventas_exige_datos_fiscales(cliente_api, usuario):
    api = cliente_api(usuario())
    r = api.put("/empresas/emp-isvan/modulos/ventas", json={"activo": True})
    assert r.status_code == 409
    assert "rif" in r.json()["detail"]
    api.put("/empresas/emp-tralog", json=DATOS_TRALOG)
    r = api.put("/empresas/emp-tralog/modulos/ventas", json={"activo": True})
    assert r.status_code == 200 and r.json()["ventas"] is True
    r = api.put("/empresas/emp-tralog/modulos/ventas", json={"activo": False})
    assert r.json()["ventas"] is False


def test_bitacora_no_se_edita_ni_se_borra(db):
    db.execute(
        'INSERT INTO "Bitacora" ("entidad", "entidadId", "accion") VALUES (\'Prueba\', \'1\', \'crear\')'
    )
    db.commit()
    with pytest.raises(psycopg.errors.RaiseException):
        db.execute('UPDATE "Bitacora" SET "accion" = \'otra\' WHERE "entidad" = \'Prueba\'')
    db.rollback()
    with pytest.raises(psycopg.errors.RaiseException):
        db.execute('DELETE FROM "Bitacora" WHERE "entidad" = \'Prueba\'')
    db.rollback()


def test_permisos_por_rol(cliente_api, usuario):
    vendedor = cliente_api(usuario("VENDEDOR"))
    assert "catalogo.ver" in vendedor.get("/permisos/mios").json()
    assert vendedor.get("/catalogo/productos?empresaId=emp-tralog").status_code == 200
    r = vendedor.post("/catalogo/productos?empresaId=emp-tralog", json={"codigo": 1, "nombre": "x"})
    assert r.status_code == 403
    admin = cliente_api(usuario()).get("/permisos/mios").json()
    assert "ventas.facturar" in admin


# ---------- Numeracion ----------


def test_correlativo_sin_saltos_en_paralelo(base_url):
    from app.services import correlativo

    empresa = f"emp-{uuid.uuid4().hex[:6]}"
    numeros, errores = [], []

    def tomar():
        try:
            with psycopg.connect(base_url, row_factory=psycopg.rows.dict_row) as conn:
                with conn.cursor() as cur:
                    numeros.append(correlativo.siguiente(cur, empresa, "FA"))
                conn.commit()
        except Exception as e:  # noqa: BLE001
            errores.append(e)

    hilos = [threading.Thread(target=tomar) for _ in range(20)]
    for h in hilos:
        h.start()
    for h in hilos:
        h.join()
    assert not errores
    assert sorted(numeros) == list(range(1, 21))


def test_correlativo_que_se_deshace_no_deja_salto(base_url):
    from app.services import correlativo

    empresa = f"emp-{uuid.uuid4().hex[:6]}"
    with psycopg.connect(base_url, row_factory=psycopg.rows.dict_row) as conn:
        with conn.cursor() as cur:
            assert correlativo.siguiente(cur, empresa, "NC") == 1
        conn.rollback()
        with conn.cursor() as cur:
            assert correlativo.siguiente(cur, empresa, "NC") == 1
        conn.commit()
    assert correlativo.formatear("NC", 1) == "NC-00000001"


# ---------- Cola de tareas ----------


def test_cola_de_tareas_reintenta(db):
    from app.services import tareas

    llamadas = {"n": 0}

    @tareas.manejador("prueba.falla_una_vez")
    def _falla(cur, datos):
        llamadas["n"] += 1
        if llamadas["n"] == 1:
            raise RuntimeError("primera vez falla")

    with db.cursor() as cur:
        tareas.encolar(cur, "prueba.falla_una_vez", {"x": 1}, clave_unica="prueba-1")
        tareas.encolar(cur, "prueba.falla_una_vez", {"x": 1}, clave_unica="prueba-1")  # no se duplica
    db.commit()
    assert db.execute('SELECT count(*) AS n FROM "Tarea" WHERE "claveUnica" = \'prueba-1\'').fetchone()["n"] == 1
    assert tareas.procesar()["fallidas"] == 1
    fila = db.execute('SELECT * FROM "Tarea" WHERE "claveUnica" = \'prueba-1\'').fetchone()
    assert fila["estado"] == "PENDIENTE" and fila["intentos"] == 1 and "primera vez" in fila["ultimoError"]
    db.execute('UPDATE "Tarea" SET "ejecutarDesde" = now() - interval \'1 hour\' WHERE "claveUnica" = \'prueba-1\'')
    db.commit()
    assert tareas.procesar()["hechas"] == 1
    assert db.execute('SELECT "estado" FROM "Tarea" WHERE "claveUnica" = \'prueba-1\'').fetchone()["estado"] == "HECHA"


def test_tarea_procesar_pide_secreto(cliente_api, monkeypatch):
    monkeypatch.setenv("CRON_SECRET", "secreto-de-prueba")
    api = cliente_api()
    assert api.get("/tareas/procesar").status_code == 401
    assert api.get("/tareas/procesar", headers={"Authorization": "Bearer secreto-de-prueba"}).status_code == 200


# ---------- Catalogo ----------


@pytest.fixture()
def extracto(db, usuario):
    """Un producto y un cliente en el extracto de ventas de TRALOG."""
    db.execute(
        'INSERT INTO "VentaProducto" ("id", "empresa", "codigo", "nombre", "grupo", "unidadesPorCaja", "litrosPorUnidad") '
        "VALUES ('vp-prueba', 'TRALOG', 900001, 'HELADO PRUEBA 1L', 'TIO RICO', 6, 1.0) ON CONFLICT DO NOTHING"
    )
    db.execute(
        'INSERT INTO "VentaCliente" ("id", "empresa", "codigo", "nombre", "tipo", "ruta", "listaPrecio") '
        "VALUES ('vc-prueba', 'TRALOG', 'C900', 'BODEGA PRUEBA', 'TRADICIONAL', 'R3', 'L1') ON CONFLICT DO NOTHING"
    )
    db.execute(
        'INSERT INTO "Cliente" ("id", "empresa", "codigo", "nombre", "tipo", "direccion", "ciudad", "telefono") '
        "VALUES ('cli-prueba', 'TRALOG', 'C900', 'BODEGA PRUEBA', 'Tienda', 'Calle 1', 'Caracas', '0212') "
        "ON CONFLICT DO NOTHING"
    )
    db.commit()


def test_sincronizar_catalogo(cliente_api, usuario, db, extracto):
    api = cliente_api(usuario())
    r = api.post("/catalogo/sincronizar?empresaId=emp-tralog")
    assert r.status_code == 200, r.text
    productos = api.get("/catalogo/productos?empresaId=emp-tralog&buscar=PRUEBA").json()
    assert any(p["codigo"] == 900001 and p["unidadesPorCaja"] == 6 for p in productos)
    cliente = db.execute('SELECT "rutaVenta", "listaPrecioCodigo" FROM "Cliente" WHERE "id" = \'cli-prueba\'').fetchone()
    assert cliente == {"rutaVenta": "R3", "listaPrecioCodigo": "L1"}
    listas = api.get("/catalogo/listas?empresaId=emp-tralog").json()
    assert any(l["codigo"] == "L1" for l in listas)
    # Sincronizar de nuevo no duplica ni pisa
    api.post("/catalogo/sincronizar?empresaId=emp-tralog")
    assert len([p for p in api.get("/catalogo/productos?empresaId=emp-tralog&buscar=PRUEBA").json()]) == 1


def test_precios_desde_excel(cliente_api, usuario, extracto):
    api = cliente_api(usuario())
    api.post("/catalogo/sincronizar?empresaId=emp-tralog")
    lista = next(l for l in api.get("/catalogo/listas?empresaId=emp-tralog").json() if l["codigo"] == "L1")
    libro = openpyxl.Workbook()
    hoja = libro.active
    hoja.append(["Codigo", "Precio caja USD"])
    hoja.append([900001, 12.5])
    hoja.append([123, 3])
    hoja.append([900001.0, "abc"])
    datos = io.BytesIO()
    libro.save(datos)
    r = api.post(
        f"/catalogo/listas/{lista['id']}/precios/excel",
        files={"archivo": ("precios.xlsx", datos.getvalue(), "application/vnd.ms-excel")},
    )
    assert r.status_code == 200, r.text
    assert r.json()["guardados"] == 1
    assert len(r.json()["problemas"]) == 2
    precios = api.get(f"/catalogo/listas/{lista['id']}/precios").json()
    assert next(p for p in precios if p["codigo"] == 900001)["precioCajaUsd"] == 12.5


def test_ficha_fiscal_del_cliente(cliente_api, usuario, extracto):
    api = cliente_api(usuario())
    r = api.put(
        "/catalogo/clientes/cli-prueba/ficha",
        json={"rifCedula": "v 12.345.678", "razonSocial": "BODEGA PRUEBA", "contribuyenteEspecial": True,
              "porcentajeRetencionIva": 75, "limiteCreditoUsd": 500, "diasCredito": 15},
    )
    assert r.status_code == 200, r.text
    assert r.json()["rifCedula"] == "V-12345678"
    malo = api.put("/catalogo/clientes/cli-prueba/ficha", json={"contribuyenteEspecial": True})
    assert malo.status_code == 400


def test_estado_de_la_tasa(cliente_api, usuario, db):
    api = cliente_api(usuario())
    assert api.get("/tasa/estado").json()["vigente"] is False
    db.execute(
        "INSERT INTO \"TasaCambio\" (\"fecha\", \"tasa\", \"fuente\") "
        "VALUES ((now() AT TIME ZONE 'America/Caracas')::date, 250.5, 'MANUAL') ON CONFLICT DO NOTHING"
    )
    db.commit()
    estado = api.get("/tasa/estado").json()
    assert estado["vigente"] is True and estado["tasa"] == 250.5
