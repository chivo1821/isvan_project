"""Pruebas integrales del modulo de Inventario Valorizado (SENIAT Art. 177 RISLR),
los 3 tipos de costo por caja (ultimo, promedio ponderado movil y presupuestario),
Kardex valorado, retiros/autoconsumo, entradas Excel valoradas y calculo de
precios/margenes en listas de precios."""

from __future__ import annotations

import io
import uuid
from decimal import Decimal

import openpyxl
import pytest

from app.core.db import con_organizacion
from app.core.fechas import hoy_caracas
from app.services import tareas


def _emitir_cola() -> None:
    while tareas.procesar()["hechas"]:
        pass


@pytest.fixture()
def entorno_costos(db, cliente_api, usuario):
    """Empresa fiscal aislada con modulos ventas + inventario encendidos, dos
    almacenes, un cliente con ficha fiscal y tasa BCV inicial de 100 Bs/USD."""
    sufijo = uuid.uuid4().hex[:6]
    emp_id = f"emp-costos-{sufijo}"
    emp_cod = "ISVAN"
    alm_a = f"alm-a-{sufijo}"
    alm_b = f"alm-b-{sufijo}"
    cli_id = f"cli-costos-{sufijo}"

    # Usamos emp-isvan existente o aseguramos sus datos fiscales limpios para las pruebas
    emp_id = "emp-isvan"
    admin = usuario("ADMIN")
    api = cliente_api(admin)

    r = api.put(
        f"/empresas/{emp_id}",
        json={
            "rif": "J-98765432-1",
            "razonSocial": "ISVAN DISTRIBUIDORA C.A.",
            "domicilioFiscal": "Zona Industrial Valencia",
            "agenteRetencionIva": False,
            "contribuyenteEspecial": False,
        },
    )
    assert r.status_code == 200, r.text
    for mod in ("ventas", "inventario"):
        rm = api.put(f"/empresas/{emp_id}/modulos/{mod}", json={"activo": True})
        assert rm.status_code == 200, rm.text

    db.execute(
        'INSERT INTO "TasaCambio" ("fecha", "tasa", "fuente") '
        "VALUES ((now() AT TIME ZONE 'America/Caracas')::date, 100, 'MANUAL') "
        'ON CONFLICT ("fecha") DO UPDATE SET "tasa" = 100, "fuente" = \'MANUAL\''
    )
    db.execute(
        'INSERT INTO "Almacen" ("id", "nombre", "tipo", "direccion", "ciudad", "lat", "lng") VALUES '
        "('alm-catia', 'Almacen Catia', 'CD', 'Catia', 'Caracas', 10.5, -66.95), "
        "(%s, 'Almacen Principal Costos', 'CD', 'Av. 1', 'Valencia', 10.2, -68.0), "
        "(%s, 'Almacen Secundario Costos', 'Sucursal', 'Av. 2', 'Maracay', 10.25, -67.6) "
        "ON CONFLICT DO NOTHING",
        (alm_a, alm_b),
    )
    db.execute(
        'INSERT INTO "Cliente" ("id", "empresa", "codigo", "nombre", "tipo", "direccion", "ciudad", "telefono", '
        '"rifCedula", "razonSocial", "rutaVenta", "listaPrecioCodigo", "diasCredito") '
        "VALUES (%s, %s, %s, 'AUTOMERCADO PRUEBA', 'Supermercado', 'Av. Bolivar', 'Valencia', '0241', "
        "'J-22222222-2', 'AUTOMERCADO PRUEBA C.A.', 'R1', %s, 7)",
        (cli_id, emp_cod, f"C-{sufijo}", f"LP-{sufijo}"),
    )
    db.commit()

    base_cod = int(uuid.uuid4().int % 800000) + 100000

    def crear_producto(**kwargs) -> dict:
        non_local_cod = kwargs.pop("codigo", None)
        if non_local_cod is None:
            crear_producto.seq += 1
            non_local_cod = base_cod + crear_producto.seq
        datos = {
            "codigo": non_local_cod,
            "nombre": kwargs.pop("nombre", f"PROD {non_local_cod}"),
            "grupo": kwargs.pop("grupo", "HELADOS"),
            "unidadesPorCaja": kwargs.pop("unidadesPorCaja", 6),
            "litrosPorUnidad": kwargs.pop("litrosPorUnidad", 1.5),
            "pesoCajaKg": kwargs.pop("pesoCajaKg", 5.0),
            "impuestoCodigo": kwargs.pop("impuestoCodigo", "IVA_GENERAL"),
            **kwargs,
        }
        resp = api.post(f"/catalogo/productos?empresaId={emp_id}", json=datos)
        assert resp.status_code == 201, resp.text
        return resp.json()

    crear_producto.seq = 0  # type: ignore[attr-defined]

    try:
        yield {
            "api": api,
            "admin": admin,
            "empresaId": emp_id,
            "almacenA": alm_a,
            "almacenB": alm_b,
            "clienteId": cli_id,
            "listaCodigo": f"LP-{sufijo}",
            "crear_producto": crear_producto,
            "sufijo": sufijo,
        }
    finally:
        db.rollback()
        db.execute(
            'DELETE FROM "DespachoItem" WHERE "despachoId" IN '
            '(SELECT "id" FROM "Despacho" WHERE "destinoClienteId" = %s)',
            (cli_id,),
        )
        db.execute('DELETE FROM "Despacho" WHERE "destinoClienteId" = %s', (cli_id,))
        db.execute('DELETE FROM "DocumentoCobro" WHERE "codigoCliente" = %s', (f"C-{sufijo}",))
        db.execute('DELETE FROM "Venta" WHERE "empresa" = \'ISVAN\' AND "numDoc" LIKE \'FA-%\'')
        db.execute('DELETE FROM "Configuracion" WHERE "clave" LIKE %s', (f"modulo.%.{emp_id}",))
        db.execute(
            'UPDATE "EmpresaFiscal" SET "rif" = NULL, "domicilioFiscal" = NULL, '
            '"contribuyenteEspecial" = FALSE, "agenteRetencionIva" = FALSE, "porcentajeRetencionIva" = NULL '
            'WHERE "id" = %s',
            (emp_id,),
        )
        db.execute('DELETE FROM "TasaCambio"')
        db.commit()


def test_tres_costos_cpp_movil_seniat_y_recalculo_presupuestario(entorno_costos, db, cliente_api, usuario):
    api = entorno_costos["api"]
    emp_id = entorno_costos["empresaId"]
    alm_a = entorno_costos["almacenA"]
    crear_producto = entorno_costos["crear_producto"]

    p_prom = crear_producto(nombre="TORTA SUIZA 1L", grupo="POSTRES")
    p_ult = crear_producto(nombre="PALETA FRESA", grupo="PALETAS")
    p_man = crear_producto(nombre="CONO VAINILLA", grupo="CONOS")

    # Permiso inventario.costos exigido para configurar costo presupuestario
    usr_sin_permiso = usuario("DESPACHOS")
    r_403 = cliente_api(usr_sin_permiso).put(
        f"/inventario/productos/{p_prom['id']}/costo-presupuestario",
        json={"modo": "SOBRE_PROMEDIO", "porcentaje": 10},
    )
    assert r_403.status_code == 403

    # Otorgando permiso inventario.costos al usuario funciona correctamente
    db.execute(
        'INSERT INTO "UsuarioPermiso" ("usuarioId", "permisoCodigo") VALUES (%s, \'inventario.costos\')',
        (usr_sin_permiso["id"],),
    )
    db.commit()
    r_ok = cliente_api(usr_sin_permiso).put(
        f"/inventario/productos/{p_prom['id']}/costo-presupuestario",
        json={"modo": "SOBRE_PROMEDIO", "porcentaje": 10},
    )
    assert r_ok.status_code == 200, r_ok.text
    assert r_ok.json()["modoPresupuestario"] == "SOBRE_PROMEDIO"
    assert r_ok.json()["porcentajePresupuestario"] == 10.0
    # Aun no hay costo promedio, queda None hasta la primera entrada valorada
    assert r_ok.json()["costoPresupuestarioCajaUsd"] is None

    assert (
        api.put(
            f"/inventario/productos/{p_ult['id']}/costo-presupuestario",
            json={"modo": "SOBRE_ULTIMO", "porcentajePresupuestario": 15},
        ).status_code
        == 200
    )
    r_man = api.put(
        f"/inventario/productos/{p_man['id']}/costo-presupuestario",
        json={"modo": "MANUAL", "costoPresupuestarioCajaUsd": 18.5},
    )
    assert r_man.status_code == 200
    assert r_man.json()["costoPresupuestarioCajaUsd"] == 18.5

    # 1ra entrada valorada: 10 cajas a $10.00 (tasa BCV = 100 -> 1.000 Bs/caja)
    r_ent1 = api.post(
        "/inventario/entradas",
        json={
            "empresaId": emp_id,
            "almacenId": alm_a,
            "referencia": "Compra inicial",
            "proveedor": "Alimentos Polar C.A.",
            "numeroFacturaCompra": "FAC-1001",
            "items": [
                {"productoId": p_prom["id"], "lote": "L-01", "vencimiento": "2027-06-30", "cajas": 10, "costoCajaUsd": 10},
                {"productoId": p_ult["id"], "lote": "L-01", "cajas": 5, "costoCajaUsd": 10},
                {"productoId": p_man["id"], "lote": "L-01", "cajas": 8, "costoCajaUsd": 12},
            ],
        },
    )
    assert r_ent1.status_code == 201, r_ent1.text

    prods = {p["id"]: p for p in api.get(f"/catalogo/productos?empresaId={emp_id}").json()}
    assert prods[p_prom["id"]]["ultimoCostoCajaUsd"] == 10.0
    assert prods[p_prom["id"]]["ultimoCostoCajaBs"] == 1000.0
    assert prods[p_prom["id"]]["costoPromedioCajaUsd"] == 10.0
    assert prods[p_prom["id"]]["costoPromedioCajaBs"] == 1000.0
    assert prods[p_prom["id"]]["costoPresupuestarioCajaUsd"] == 11.0  # 10 + 10%

    assert prods[p_ult["id"]]["costoPresupuestarioCajaUsd"] == 11.5  # 10 + 15%
    assert prods[p_man["id"]]["costoPresupuestarioCajaUsd"] == 18.5  # MANUAL intacto

    # 2da entrada valorada con nueva tasa explicita 120 Bs/USD: 10 cajas a $14.00 (= 1.680 Bs/caja)
    r_ent2 = api.post(
        "/inventario/entradas",
        json={
            "empresaId": emp_id,
            "almacenId": alm_a,
            "referencia": "Reposicion lote 2",
            "proveedor": "Alimentos Polar C.A.",
            "numeroFacturaCompra": "FAC-1002",
            "tasa": 120,
            "items": [
                {"productoId": p_prom["id"], "lote": "L-02", "vencimiento": "2027-09-30", "cajas": 10, "costoCajaUsd": 14},
                {"productoId": p_ult["id"], "lote": "L-02", "cajas": 5, "costoCajaUsd": 20},
            ],
        },
    )
    assert r_ent2.status_code == 201, r_ent2.text

    prods = {p["id"]: p for p in api.get(f"/catalogo/productos?empresaId={emp_id}").json()}
    # p_prom: CPP USD = (10*10 + 10*14)/20 = 12.0; CPP Bs = (10*1000 + 10*1680)/20 = 1340.0
    assert prods[p_prom["id"]]["ultimoCostoCajaUsd"] == 14.0
    assert prods[p_prom["id"]]["ultimoCostoCajaBs"] == 1680.0
    assert prods[p_prom["id"]]["costoPromedioCajaUsd"] == 12.0
    assert prods[p_prom["id"]]["costoPromedioCajaBs"] == 1340.0
    assert prods[p_prom["id"]]["costoPresupuestarioCajaUsd"] == 13.2  # 12.0 + 10%

    # p_ult: ultimo = 20.0, promedio = 15.0, presupuestario SOBRE_ULTIMO (+15%) = 23.0
    assert prods[p_ult["id"]]["ultimoCostoCajaUsd"] == 20.0
    assert prods[p_ult["id"]]["costoPromedioCajaUsd"] == 15.0
    assert prods[p_ult["id"]]["costoPresupuestarioCajaUsd"] == 23.0

    # Entrada solo en Bs (se convierte con tasa) y entrada sin costo (compatible, no altera CPP)
    r_ent_bs = api.post(
        "/inventario/entradas",
        json={
            "empresaId": emp_id,
            "almacenId": alm_a,
            "referencia": "Factura en Bs",
            "tasa": 100,
            "items": [
                {"productoId": p_man["id"], "lote": "L-02", "cajas": 8, "costoCajaBs": 1600},
                {"productoId": p_prom["id"], "lote": "L-SINCOSTO", "cajas": 2},
            ],
        },
    )
    assert r_ent_bs.status_code == 201, r_ent_bs.text
    prods = {p["id"]: p for p in api.get(f"/catalogo/productos?empresaId={emp_id}").json()}
    # p_man tenia 8 cajas @ $12, entran 8 cajas @ 1600 Bs / 100 = $16 -> CPP = $14
    assert prods[p_man["id"]]["ultimoCostoCajaUsd"] == 16.0
    assert prods[p_man["id"]]["costoPromedioCajaUsd"] == 14.0
    # p_prom recibio 2 cajas sin costo -> su CPP se mantiene en 12.0
    assert prods[p_prom["id"]]["costoPromedioCajaUsd"] == 12.0

    # Verificar auditoria en HistorialCostoProducto
    hist = db.execute(
        'SELECT "tipoCosto", "costoAnteriorUsd", "costoNuevoUsd", "movimientoId" '
        'FROM "HistorialCostoProducto" WHERE "productoId" = %s ORDER BY "id" ASC',
        (p_prom["id"],),
    ).fetchall()
    tipos = [h["tipoCosto"] for h in hist]
    assert "ULTIMO" in tipos and "PROMEDIO" in tipos and "PRESUPUESTARIO" in tipos
    assert all(h["movimientoId"] is not None for h in hist)


def test_salidas_retiros_traslados_ajustes_devolucion_y_kardex(entorno_costos):
    api = entorno_costos["api"]
    emp_id = entorno_costos["empresaId"]
    alm_a = entorno_costos["almacenA"]
    alm_b = entorno_costos["almacenB"]
    cli_id = entorno_costos["clienteId"]
    lista_cod = entorno_costos["listaCodigo"]
    crear_producto = entorno_costos["crear_producto"]

    prod = crear_producto(nombre="HELADO CREMA REAL 2L", grupo="FAMILIAR")
    lista = api.post(f"/catalogo/listas?empresaId={emp_id}", json={"codigo": lista_cod, "nombre": "Mayorista"}).json()
    api.put(f"/catalogo/listas/{lista['id']}/precios", json={"precios": [{"productoId": prod["id"], "precioCajaUsd": 25}]})
    api.put(
        f"/inventario/productos/{prod['id']}/costo-presupuestario",
        json={"modo": "SOBRE_PROMEDIO", "porcentaje": 20},
    )

    # Entrada inicial: 20 cajas a $10.00 (tasa 100 -> 1.000 Bs)
    assert (
        api.post(
            "/inventario/entradas",
            json={
                "empresaId": emp_id,
                "almacenId": alm_a,
                "referencia": "Compra Lote Base",
                "proveedor": "Lacteos Los Andes",
                "numeroFacturaCompra": "F-500",
                "items": [{"productoId": prod["id"], "lote": "LB-1", "vencimiento": "2027-05-01", "cajas": 20, "costoCajaUsd": 10}],
            },
        ).status_code
        == 201
    )

    ex_list = [e for e in api.get(f"/inventario/existencias?empresaId={emp_id}").json() if e["productoId"] == prod["id"]]
    assert len(ex_list) == 1
    lote_id = ex_list[0]["lotes"][0]["loteId"]
    assert ex_list[0]["costoPromedioCajaUsd"] == 10.0
    assert ex_list[0]["costoPresupuestarioCajaUsd"] == 12.0
    assert ex_list[0]["valorPromedioUsd"] == 200.0
    assert ex_list[0]["valorPromedioBs"] == 20000.0
    assert ex_list[0]["valorPresupuestarioUsd"] == 240.0

    # 1. Traslado de 5 cajas de Almacen A -> Almacen B (neutro en costo y saldo empresa)
    r_tras = api.post(
        "/inventario/traslados",
        json={
            "empresaId": emp_id,
            "desdeAlmacenId": alm_a,
            "haciaAlmacenId": alm_b,
            "productoId": prod["id"],
            "loteId": lote_id,
            "cajas": 5,
        },
    )
    assert r_tras.status_code == 201, r_tras.text
    ex_por_alm = {
        e["almacenId"]: e
        for e in api.get(f"/inventario/existencias?empresaId={emp_id}").json()
        if e["productoId"] == prod["id"]
    }
    assert ex_por_alm[alm_a]["cajas"] == 15.0 and ex_por_alm[alm_b]["cajas"] == 5.0
    assert ex_por_alm[alm_a]["costoPromedioCajaUsd"] == 10.0

    # 2. Validaciones y ejecucion de Retiro y Autoconsumo (descarga a CPP = $10 sin alterarlo)
    sin_motivo = api.post(
        "/inventario/retiros",
        json={"empresaId": emp_id, "almacenId": alm_a, "tipo": "RETIRO", "motivo": " ", "productoId": prod["id"], "loteId": lote_id, "cajas": 1},
    )
    assert sin_motivo.status_code == 400

    exceso = api.post(
        "/inventario/retiros",
        json={"empresaId": emp_id, "almacenId": alm_b, "tipo": "RETIRO", "motivo": "Exceso stock", "productoId": prod["id"], "loteId": lote_id, "cajas": 99},
    )
    assert exceso.status_code == 409

    # Payload mixto como envia el frontend (items + campos planos simultaneos -> no debe duplicar)
    r_ret = api.post(
        "/inventario/retiros",
        json={
            "empresaId": emp_id,
            "almacenId": alm_a,
            "tipo": "RETIRO",
            "motivo": "Rotura de cava en pasillo",
            "items": [{"productoId": prod["id"], "loteId": lote_id, "cajas": 2}],
            "productoId": prod["id"],
            "loteId": lote_id,
            "cajas": 2,
        },
    )
    assert r_ret.status_code == 201, r_ret.text

    r_auto = api.post(
        "/inventario/retiros",
        json={
            "empresaId": emp_id,
            "almacenId": alm_a,
            "tipo": "AUTOCONSUMO",
            "motivo": "Degustacion evento comercial",
            "productoId": prod["id"],
            "cajas": 1,
        },
    )
    assert r_auto.status_code == 201, r_auto.text

    # 3. Ajuste negativo aprobado (-1 caja en Almacen B) -> quedan 12 en A + 4 en B = 16 cajas
    aju = api.post(
        "/inventario/ajustes",
        json={
            "empresaId": emp_id,
            "almacenId": alm_b,
            "motivo": "Diferencia conteo fisico",
            "items": [{"productoId": prod["id"], "loteId": lote_id, "cajas": -1}],
        },
    ).json()
    assert api.post(f"/inventario/ajustes/{aju['id']}/aprobar").status_code == 200

    # 4. Factura de venta (FA) por 4 cajas en Almacen A (sale a CPP = $10 -> quedan 12 cajas empresa)
    ped = api.post(
        "/ventas/pedidos",
        json={
            "empresaId": emp_id,
            "clienteId": cli_id,
            "almacenId": alm_a,
            "items": [{"productoId": prod["id"], "cajas": 4}],
        },
    ).json()
    assert api.post(f"/ventas/pedidos/{ped['id']}/confirmar").status_code == 200
    doc_id = api.post(f"/ventas/pedidos/{ped['id']}/facturar", json={"tipo": "FA"}).json()["documentoId"]
    _emitir_cola()
    doc = api.get(f"/ventas/documentos/{doc_id}").json()
    assert doc["estado"] == "EMITIDA", doc.get("errorEmision")

    # 5. Nueva compra de 12 cajas a $16.00 -> quedan 24 cajas empresa y CPP sube a (12*10 + 12*16)/24 = $13.00
    assert (
        api.post(
            "/inventario/entradas",
            json={
                "empresaId": emp_id,
                "almacenId": alm_a,
                "referencia": "Compra con incremento",
                "items": [{"productoId": prod["id"], "lote": "LB-2", "vencimiento": "2027-10-01", "cajas": 12, "costoCajaUsd": 16}],
            },
        ).status_code
        == 201
    )
    p_actual = next(p for p in api.get(f"/catalogo/productos?empresaId={emp_id}").json() if p["id"] == prod["id"])
    assert p_actual["costoPromedioCajaUsd"] == 13.0

    # 6. Nota de credito con devolucion de 2 cajas de la FA (que salieron a $10.00):
    # reingresan al costo del documento origen ($10.00) -> nuevo CPP = (24*13 + 2*10)/26 = 332/26 = 12.7692
    nc = api.post(
        f"/ventas/documentos/{doc_id}/notas",
        json={"tipo": "NC", "motivo": "Devolucion parcial", "devuelveInventario": True, "items": [{"productoId": prod["id"], "cajas": 2}]},
    )
    assert nc.status_code == 201, nc.text
    _emitir_cola()

    p_post_nc = next(p for p in api.get(f"/catalogo/productos?empresaId={emp_id}").json() if p["id"] == prod["id"])
    assert p_post_nc["costoPromedioCajaUsd"] == pytest.approx(12.7692, abs=1e-4)

    # 7. Kardex valorizado completo (sin pasar empresaId, tal como invoca el dialogo frontend)
    kardex = api.get(f"/inventario/kardex/{prod['id']}").json()
    assert len(kardex) == 9  # entrada, tras_sal, tras_ent, retiro, autoconsumo, ajuste, salida_venta, entrada2, devolucion
    assert kardex[0]["tipo"] == "DEVOLUCION"
    assert kardex[0]["cajas"] == 2.0
    assert kardex[0]["costoUnitarioUsd"] == 10.0
    assert kardex[0]["saldoCajasEmpresa"] == 26.0
    assert kardex[0]["costoPromedioResultanteUsd"] == pytest.approx(12.7692, abs=1e-4)

    mov_compra = kardex[-1]
    assert mov_compra["tipo"] == "ENTRADA"
    assert mov_compra["proveedor"] == "Lacteos Los Andes"
    assert mov_compra["numeroFacturaCompra"] == "F-500"
    assert mov_compra["valorTotalUsd"] == 200.0


def test_entrada_excel_valorada_y_reporte_art_177_json_y_xlsx(entorno_costos):
    api = entorno_costos["api"]
    emp_id = entorno_costos["empresaId"]
    alm_a = entorno_costos["almacenA"]
    crear_producto = entorno_costos["crear_producto"]

    p_excel = crear_producto(nombre="YOGURT GRIEGO CAJA", grupo="LACTEOS")

    libro = openpyxl.Workbook()
    hoja = libro.active
    hoja.append(["Codigo", "Cajas", "Lote", "Vencimiento", "Costo USD"])
    hoja.append([p_excel["codigo"], 10, "LOT-X1", "15/11/2027", "15,50"])

    buf = io.BytesIO()
    libro.save(buf)
    contenido_xlsx = buf.getvalue()

    # Vista previa (confirmar=false)
    prev = api.post(
        f"/inventario/entradas/excel?empresaId={emp_id}&almacenId={alm_a}&referencia=Recepcion+Excel&confirmar=false",
        files={"archivo": ("entrada.xlsx", contenido_xlsx, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )
    assert prev.status_code == 200, prev.text
    datos_prev = prev.json()
    assert datos_prev["confirmado"] is False
    assert datos_prev["problemas"] == []
    assert datos_prev["renglones"][0]["costoUsd"] == 15.5
    # Aun no se aplico en BD
    assert [e for e in api.get(f"/inventario/existencias?empresaId={emp_id}").json() if e["productoId"] == p_excel["id"]] == []

    # Confirmar carga Excel
    conf = api.post(
        f"/inventario/entradas/excel?empresaId={emp_id}&almacenId={alm_a}&referencia=Recepcion+Excel&confirmar=true&proveedor=Lacteos+Excel&numeroFacturaCompra=FE-77",
        files={"archivo": ("entrada.xlsx", contenido_xlsx, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )
    assert conf.status_code == 200, conf.text
    assert conf.json()["confirmado"] is True

    # Retiro de 3 cajas para que aparezca en columna Retiros/Autoconsumo del Art. 177
    assert (
        api.post(
            "/inventario/retiros",
            json={
                "empresaId": emp_id,
                "almacenId": alm_a,
                "tipo": "RETIRO",
                "motivo": "Merma control de calidad",
                "productoId": p_excel["id"],
                "cajas": 3,
            },
        ).status_code
        == 201
    )

    mes_actual = hoy_caracas().strftime("%Y-%m")
    rep_resp = api.get(f"/inventario/reportes/art-177?empresaId={emp_id}&mes={mes_actual}&formato=json")
    assert rep_resp.status_code == 200, rep_resp.text
    rep = rep_resp.json()
    assert rep["empresaId"] == emp_id and rep["mes"] == mes_actual

    fila = next(f for f in rep["filas"] if f["productoId"] == p_excel["id"])
    assert fila["invInicialCajas"] == 0.0
    assert fila["entradasCajas"] == 10.0
    assert fila["entradasUsd"] == 155.0
    assert fila["entradasBs"] == 15500.0
    assert fila["retirosAutoconsumoCajas"] == 3.0
    assert fila["retirosAutoconsumoUsd"] == 46.5
    assert fila["invFinalCajas"] == 7.0
    assert fila["costoPromedioFinalUsd"] == 15.5
    assert fila["invFinalUsd"] == 108.5
    assert fila["invFinalBs"] == 10850.0

    # Exportacion Excel (.xlsx) del libro Art. 177
    xlsx_resp = api.get(f"/inventario/reportes/art-177?empresaId={emp_id}&mes={mes_actual}&formato=xlsx")
    assert xlsx_resp.status_code == 200
    assert "spreadsheetml" in xlsx_resp.headers["content-type"]
    wb_out = openpyxl.load_workbook(io.BytesIO(xlsx_resp.content))
    ws_out = wb_out.active
    assert "Art. 177 RISLR" in str(ws_out.cell(1, 1).value)
    assert "J-98765432-1" in str(ws_out.cell(1, 1).value)
    assert ws_out.cell(ws_out.max_row, 1).value == "TOTALES"


def test_costo_presupuestario_masivo_y_listas_precios_margenes(entorno_costos):
    api = entorno_costos["api"]
    emp_id = entorno_costos["empresaId"]
    alm_a = entorno_costos["almacenA"]
    crear_producto = entorno_costos["crear_producto"]
    suf = entorno_costos["sufijo"]

    p_a = crear_producto(nombre="BARQUILLA CHOCO", grupo="G-CHOCO")
    p_b = crear_producto(nombre="BARQUILLA FRESA", grupo="G-FRUTA")
    p_sin_costo = crear_producto(nombre="PRODUCTO NUEVO SIN COMPRA", grupo="G-CHOCO")

    # Entradas valoradas: p_a cuesta $10, p_b cuesta $20 (p_sin_costo queda sin costo)
    assert (
        api.post(
            "/inventario/entradas",
            json={
                "empresaId": emp_id,
                "almacenId": alm_a,
                "referencia": "Costos base",
                "items": [
                    {"productoId": p_a["id"], "cajas": 5, "costoCajaUsd": 10},
                    {"productoId": p_b["id"], "cajas": 5, "costoCajaUsd": 20},
                ],
            },
        ).status_code
        == 201
    )

    # Configuracion masiva solo para grupo G-CHOCO: SOBRE_PROMEDIO +25% -> p_a presupuestario = $12.50
    r_masivo = api.post(
        "/inventario/costos-presupuestarios/masivo",
        json={
            "empresaId": emp_id,
            "grupo": "G-CHOCO",
            "modo": "SOBRE_PROMEDIO",
            "porcentaje": 25,
        },
    )
    assert r_masivo.status_code == 200, r_masivo.text
    assert r_masivo.json()["actualizados"] == 2
    prods = {p["id"]: p for p in api.get(f"/catalogo/productos?empresaId={emp_id}").json()}
    assert prods[p_a["id"]]["costoPresupuestarioCajaUsd"] == 12.5
    assert prods[p_b["id"]]["modoPresupuestario"] == "MANUAL"

    # Crear y configurar lista de precios
    lista = api.post(
        f"/catalogo/listas?empresaId={emp_id}",
        json={"codigo": f"L-MARGEN-{suf}", "nombre": "Lista Rentabilidad"},
    ).json()
    assert lista["baseCostoPorDefecto"] == "ULTIMO"

    # Margen sobre venta >= 100% se rechaza
    assert (
        api.put(
            f"/catalogo/listas/{lista['id']}",
            json={"baseCostoPorDefecto": "PROMEDIO", "metodoMargen": "SOBRE_VENTA", "margenObjetivoPct": 100},
        ).status_code
        == 400
    )

    # Configurar lista con base PROMEDIO, metodo SOBRE_COSTO, objetivo 30%
    r_cfg = api.put(
        f"/catalogo/listas/{lista['id']}",
        json={"baseCostoPorDefecto": "PROMEDIO", "metodoMargen": "SOBRE_COSTO", "margenObjetivoPct": 30},
    )
    assert r_cfg.status_code == 200, r_cfg.text
    assert r_cfg.json()["baseCostoPorDefecto"] == "PROMEDIO"
    assert r_cfg.json()["margenObjetivoPct"] == 30.0
    assert r_cfg.json()["metodoMargen"] == "SOBRE_COSTO"

    # Fijar precios manuales: p_a = $9.00 (bajo costo $10!) y p_b = $24.00 (margen 20% < objetivo 30%!)
    api.put(
        f"/catalogo/listas/{lista['id']}/precios",
        json={
            "precios": [
                {"productoId": p_a["id"], "precioCajaUsd": 9},
                {"productoId": p_b["id"], "precioCajaUsd": 24},
            ]
        },
    )

    precios_sc = {p["id"]: p for p in api.get(f"/catalogo/listas/{lista['id']}/precios").json()}
    # p_a ($9 vs costo prom $10, pres $12.5): bajoCosto = True, utilidad = -1.0, margen SOBRE_COSTO = -10%
    assert precios_sc[p_a["id"]]["bajoCosto"] is True
    assert precios_sc[p_a["id"]]["bajoMargenObjetivo"] is True
    assert precios_sc[p_a["id"]]["margenPromedioPct"] == -10.0
    assert precios_sc[p_a["id"]]["utilidadPromedioUsd"] == -1.0
    assert precios_sc[p_a["id"]]["margenPresupuestarioPct"] == -28.0  # (9 - 12.5) / 12.5 * 100

    # p_b ($24 vs costo prom $20): bajoCosto = False, margen SOBRE_COSTO = 20% < 30% -> bajoMargenObjetivo = True
    assert precios_sc[p_b["id"]]["bajoCosto"] is False
    assert precios_sc[p_b["id"]]["bajoMargenObjetivo"] is True
    assert precios_sc[p_b["id"]]["margenPromedioPct"] == 20.0
    assert precios_sc[p_b["id"]]["utilidadPromedioUsd"] == 4.0

    # Cambiar lista a SOBRE_VENTA con objetivo 15%: p_b tiene (24 - 20)/24 = 16.67% >= 15% -> sin alerta!
    api.put(
        f"/catalogo/listas/{lista['id']}",
        json={"baseCostoPorDefecto": "PROMEDIO", "metodoMargen": "SOBRE_VENTA", "margenObjetivoPct": 15},
    )
    precios_sv = {p["id"]: p for p in api.get(f"/catalogo/listas/{lista['id']}/precios").json()}
    assert precios_sv[p_b["id"]]["margenPromedioPct"] == 16.67
    assert precios_sv[p_b["id"]]["bajoMargenObjetivo"] is False

    # Recalculo masivo desde costo:
    # 1) Vista previa (confirmar=false) con SOBRE_VENTA al 20% sobre PRESUPUESTARIO para G-CHOCO:
    # p_a tiene costo presupuestario $12.50 -> nuevo precio = 12.50 / (1 - 0.20) = $15.625
    prev_rec = api.post(
        f"/catalogo/listas/{lista['id']}/recalcular-precios",
        json={
            "baseCosto": "PRESUPUESTARIO",
            "metodoMargen": "SOBRE_VENTA",
            "margenPct": 20,
            "grupo": "G-CHOCO",
            "confirmar": False,
        },
    )
    assert prev_rec.status_code == 200, prev_rec.text
    d_prev = prev_rec.json()
    assert d_prev["confirmado"] is False
    assert d_prev["actualizados"] == 0
    assert d_prev["omitidosSinCosto"] >= 1  # p_sin_costo no tiene costo presupuestario
    reng_a = next(r for r in d_prev["renglones"] if r["productoId"] == p_a["id"])
    assert reng_a["costoBaseUsd"] == 12.5
    assert reng_a["precioAnteriorUsd"] == 9.0
    assert reng_a["nuevoPrecioUsd"] == 15.625
    assert reng_a["utilidadUsd"] == 3.125

    # Aun sigue $9.00 en BD porque confirmar=False
    assert {p["id"]: p for p in api.get(f"/catalogo/listas/{lista['id']}/precios").json()}[p_a["id"]]["precioCajaUsd"] == 9.0

    # 2) Aplicar recalculo (confirmar=true)
    conf_rec = api.post(
        f"/catalogo/listas/{lista['id']}/recalcular-precios",
        json={
            "baseCosto": "PRESUPUESTARIO",
            "metodoMargen": "SOBRE_VENTA",
            "margenPct": 20,
            "grupo": "G-CHOCO",
            "confirmar": True,
        },
    )
    assert conf_rec.status_code == 200, conf_rec.text
    assert conf_rec.json()["confirmado"] is True
    assert conf_rec.json()["actualizados"] >= 1

    post_precios = {p["id"]: p for p in api.get(f"/catalogo/listas/{lista['id']}/precios").json()}
    assert post_precios[p_a["id"]]["precioCajaUsd"] == 15.625
    assert post_precios[p_a["id"]]["baseCostoUsada"] == "PRESUPUESTARIO"
    assert post_precios[p_a["id"]]["precioFijo"] is False
    assert post_precios[p_a["id"]]["bajoCosto"] is False


def test_aislamiento_rls_historial_costo_producto(entorno_costos, db):
    crear_producto = entorno_costos["crear_producto"]
    api = entorno_costos["api"]

    p = crear_producto(nombre="PROD RLS COSTOS")
    api.put(
        f"/inventario/productos/{p['id']}/costo-presupuestario",
        json={"modo": "MANUAL", "costoPresupuestarioCajaUsd": 9.99},
    )

    rol_rls = f"rls_costos_{uuid.uuid4().hex[:8]}"
    with db.cursor() as cur:
        cur.execute(f'CREATE ROLE "{rol_rls}" NOLOGIN NOSUPERUSER NOBYPASSRLS')
        cur.execute(f'GRANT USAGE ON SCHEMA public TO "{rol_rls}"')
        cur.execute(f'GRANT SELECT ON "HistorialCostoProducto" TO "{rol_rls}"')
        cur.execute(f'SET LOCAL ROLE "{rol_rls}"')

        con_organizacion(cur, "org-principal")
        cur.execute('SELECT count(*) AS n FROM "HistorialCostoProducto" WHERE "productoId" = %s', (p["id"],))
        assert cur.fetchone()["n"] == 1

        con_organizacion(cur, "org-ajena-aislada")
        cur.execute('SELECT count(*) AS n FROM "HistorialCostoProducto" WHERE "productoId" = %s', (p["id"],))
        assert cur.fetchone()["n"] == 0
    db.rollback()
