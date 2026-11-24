"""Pruebas integrales del Módulo de Bancos, Tesorería, Conciliación de
Estados de Cuenta Venezolanos, Flujo de Caja e integración con Cobranzas."""

from __future__ import annotations

import io
import sys
import threading
import uuid
from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path

import openpyxl
import psycopg
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.fechas import hoy_caracas
from app.services import extracto_bancario


@pytest.fixture()
def entorno_bancos(db, usuario, cliente_api):
    """Empresa fiscal aislada con módulo `bancos` encendido y tasa BCV = 50 Bs/USD."""
    tag = uuid.uuid4().hex[:8]
    emp_id = f"emp-bnc-{tag}"
    codigo = f"BNC{tag[:4].upper()}"
    hoy = hoy_caracas()

    admin = usuario("ADMIN")
    cobranzas = usuario("COBRANZAS")
    vendedor = usuario("VENDEDOR")

    db.execute(
        'INSERT INTO "EmpresaFiscal" ("id", "organizacionId", "codigo", "rif", "razonSocial") '
        "VALUES (%s, 'org-principal', %s, 'J-40123456-7', %s)",
        (emp_id, codigo, f"Distribuidora Bancos {tag}"),
    )
    db.execute(
        'INSERT INTO "TasaCambio" ("fecha", "tasa", "fuente") VALUES (%s, 50.00, \'MANUAL\') '
        'ON CONFLICT ("fecha") DO UPDATE SET "tasa" = 50.00',
        (hoy,),
    )
    db.execute(
        'INSERT INTO "TasaCambio" ("fecha", "tasa", "fuente") VALUES (%s, 50.00, \'MANUAL\') '
        'ON CONFLICT ("fecha") DO UPDATE SET "tasa" = 50.00',
        (hoy - timedelta(days=30),),
    )
    db.commit()

    api_adm = cliente_api(admin)
    r_mod = api_adm.put(f"/empresas/{emp_id}/modulos/bancos", json={"activo": True})
    assert r_mod.status_code == 200, r_mod.text
    assert r_mod.json()["bancos"] is True

    return {
        "emp_id": emp_id,
        "hoy": hoy,
        "admin": admin,
        "cobranzas": cobranzas,
        "vendedor": vendedor,
        "api_adm": api_adm,
        "api_cob": cliente_api(cobranzas),
        "api_ven": cliente_api(vendedor),
    }


# ---------- 1. Módulo apagado y permisos por rol ----------


def test_modulo_apagado_y_permisos_granulares(entorno_bancos, cliente_api, usuario, db):
    emp_id = entorno_bancos["emp_id"]
    api_adm = entorno_bancos["api_adm"]
    api_cob = entorno_bancos["api_cob"]
    api_ven = entorno_bancos["api_ven"]
    api_desp = cliente_api(usuario("DESPACHOS"))

    # Apagar módulo bancos -> 409
    api_adm.put(f"/empresas/{emp_id}/modulos/bancos", json={"activo": False})
    assert api_adm.get(f"/bancos/resumen?empresaId={emp_id}").status_code == 409
    assert api_adm.get(f"/bancos/cuentas?empresaId={emp_id}").status_code == 409

    # Volver a encender
    api_adm.put(f"/empresas/{emp_id}/modulos/bancos", json={"activo": True})
    assert api_adm.get(f"/bancos/resumen?empresaId={emp_id}").status_code == 200

    # VENDEDOR y DESPACHOS no tienen acceso a /bancos -> 403
    assert api_ven.get(f"/bancos/resumen?empresaId={emp_id}").status_code == 403
    assert api_desp.get(f"/bancos/resumen?empresaId={emp_id}").status_code == 403

    # COBRANZAS tiene bancos.ver, bancos.operar y bancos.conciliar, pero NO bancos.administrar
    assert api_cob.get(f"/bancos/resumen?empresaId={emp_id}").status_code == 200
    r_crear_cob = api_cob.post(
        "/bancos/cuentas",
        json={"empresaId": emp_id, "nombre": "Banesco Bs", "tipo": "BANCO_CORRIENTE", "moneda": "VES"},
    )
    assert r_crear_cob.status_code == 403

    # ADMIN crea la cuenta y COBRANZAS puede operar sobre ella, pero no anular movimientos
    cta = api_adm.post(
        "/bancos/cuentas",
        json={
            "empresaId": emp_id,
            "nombre": "Banesco Operativa",
            "tipo": "BANCO_CORRIENTE",
            "moneda": "VES",
            "numeroCuenta": "0134-0001-23-0012345678",
            "saldoInicial": 1000,
        },
    ).json()
    assert cta["bancoCodigo"] == "0134"
    assert cta["bancoNombre"] == "Banesco"
    assert cta["numeroCuenta"] == "01340001230012345678"

    r_mov_cob = api_cob.post(
        "/bancos/movimientos",
        json={
            "empresaId": emp_id,
            "cuentaId": cta["id"],
            "tipo": "INGRESO",
            "metodo": "PAGO_MOVIL",
            "categoria": "COBRANZA_CLIENTES",
            "concepto": "Cobro cliente ruta 1",
            "monto": 500,
        },
    )
    assert r_mov_cob.status_code == 201, r_mov_cob.text
    mov_id = r_mov_cob.json()["id"]

    # COBRANZAS puede conciliar en lote pero no anular
    assert api_cob.post("/bancos/movimientos/conciliar", json={"movimientoIds": [mov_id]}).status_code == 200
    assert api_cob.post(f"/bancos/movimientos/{mov_id}/anular", json={"motivo": "Error"}).status_code == 403


# ---------- 2. Cuentas, sobregiro (enNegativo), concurrencia y edición ----------


def test_sobregiro_permitido_edicion_y_bloqueo_concurrente(entorno_bancos, base_url, db):
    emp_id = entorno_bancos["emp_id"]
    api = entorno_bancos["api_adm"]

    # Prefijo SUDEBAN incoherente da 400
    r_bad = api.post(
        "/bancos/cuentas",
        json={
            "empresaId": emp_id,
            "nombre": "Cuenta Mala",
            "tipo": "BANCO_CORRIENTE",
            "moneda": "VES",
            "bancoCodigo": "0105",
            "numeroCuenta": "01340001230012345678",
        },
    )
    assert r_bad.status_code == 400

    cta_usd = api.post(
        "/bancos/cuentas",
        json={
            "empresaId": emp_id,
            "nombre": "Caja Divisas Principal",
            "tipo": "CAJA_EFECTIVO",
            "moneda": "USD",
            "saldoInicial": 200,
        },
    ).json()
    assert cta_usd["saldoActual"] == 200.0
    assert cta_usd["enNegativo"] is False

    # Egreso de $350 sobre saldo de $200 -> NO lanza error, deja saldo en -$150 y enNegativo=True
    r_egreso = api.post(
        "/bancos/movimientos",
        json={
            "empresaId": emp_id,
            "cuentaId": cta_usd["id"],
            "tipo": "EGRESO",
            "metodo": "DIVISAS",
            "categoria": "COMPRA_INVENTARIO",
            "concepto": "Anticipo proveedor urgente",
            "monto": -350,
        },
    )
    assert r_egreso.status_code == 201, r_egreso.text
    mov_eg = r_egreso.json()
    assert mov_eg["monto"] == -350.0
    assert mov_eg["saldoResultante"] == -150.0
    assert mov_eg["enNegativo"] is True
    assert mov_eg["montoBs"] == -17500.0  # -350 * tasa 50

    # El resumen refleja la cuenta en negativo y el disponible consolidado
    resumen = api.get(f"/bancos/resumen?empresaId={emp_id}").json()
    assert resumen["cuentasEnNegativo"] == 1
    assert resumen["disponibleUsd"] == -150.0
    assert resumen["cuentas"][0]["enNegativo"] is True

    # No permite cambiar la moneda de una cuenta con movimientos (409), pero sí editar nombre
    assert api.put(f"/bancos/cuentas/{cta_usd['id']}", json={"moneda": "VES"}).status_code == 409
    r_edit = api.put(f"/bancos/cuentas/{cta_usd['id']}", json={"nombre": "Caja Chica USD Principal"})
    assert r_edit.status_code == 200 and r_edit.json()["nombre"] == "Caja Chica USD Principal"

    # Concurrencia real con SELECT ... FOR UPDATE: 10 ingresos paralelos de $10 -> +$100 exactos (saldo final = -50)
    from app.services import tesoreria

    errores: list[Exception] = []

    def abonar(i: int):
        try:
            with psycopg.connect(base_url, row_factory=psycopg.rows.dict_row) as conn:
                with conn.cursor() as cur:
                    tesoreria.registrar_movimiento(
                        cur,
                        cuenta_id=cta_usd["id"],
                        empresa_id=emp_id,
                        tipo="INGRESO",
                        metodo="DIVISAS",
                        categoria="COBRANZA_CLIENTES",
                        concepto=f"Abono concurrente {i}",
                        monto=Decimal("10.00"),
                        usuario_id=entorno_bancos["admin"]["id"],
                    )
                conn.commit()
        except Exception as e:  # noqa: BLE001
            errores.append(e)

    hilos = [threading.Thread(target=abonar, args=(i,)) for i in range(10)]
    for h in hilos:
        h.start()
    for h in hilos:
        h.join()
    assert not errores
    cuentas = api.get(f"/bancos/cuentas?empresaId={emp_id}").json()
    assert cuentas[0]["saldoActual"] == -50.0

    # Verificar auditoría en Bitacora
    n_bitacora = db.execute(
        'SELECT COUNT(*) AS n FROM "Bitacora" WHERE "entidad" IN (\'CuentaTesoreria\', \'MovimientoBancario\')'
    ).fetchone()["n"]
    assert n_bitacora >= 12


# ---------- 3. Transferencias, cambio de divisas, anulación y flujo de caja ----------


def test_transferencias_cambio_divisas_anulacion_y_flujo_caja(entorno_bancos, db):
    emp_id = entorno_bancos["emp_id"]
    hoy = entorno_bancos["hoy"]
    api = entorno_bancos["api_adm"]

    cta_bs = api.post(
        "/bancos/cuentas",
        json={
            "empresaId": emp_id,
            "nombre": "Mercantil Bs",
            "tipo": "BANCO_CORRIENTE",
            "moneda": "VES",
            "bancoCodigo": "0105",
            "saldoInicial": 10000,
            "fechaSaldoInicial": (hoy - timedelta(days=10)).isoformat(),
        },
    ).json()
    cta_usd1 = api.post(
        "/bancos/cuentas",
        json={
            "empresaId": emp_id,
            "nombre": "Custodia Banesco USD",
            "tipo": "BANCO_CUSTODIA_USD",
            "moneda": "USD",
            "saldoInicial": 500,
            "fechaSaldoInicial": (hoy - timedelta(days=10)).isoformat(),
        },
    ).json()
    cta_usd2 = api.post(
        "/bancos/cuentas",
        json={
            "empresaId": emp_id,
            "nombre": "Zelle Operativo",
            "tipo": "BILLETERA_DIGITAL",
            "moneda": "USD",
            "saldoInicial": 0,
            "fechaSaldoInicial": (hoy - timedelta(days=10)).isoformat(),
        },
    ).json()

    # 1) Traspaso misma moneda (USD -> USD): $200
    r_trf_igual = api.post(
        "/bancos/transferencias",
        json={
            "empresaId": emp_id,
            "cuentaOrigenId": cta_usd1["id"],
            "cuentaDestinoId": cta_usd2["id"],
            "fecha": hoy.isoformat(),
            "monto": 200,
            "concepto": "Fondeo Zelle",
            "referencia": "TRF-001",
        },
    )
    assert r_trf_igual.status_code == 201, r_trf_igual.text
    trf1 = r_trf_igual.json()
    assert trf1["salida"]["monto"] == -200.0
    assert trf1["entrada"]["monto"] == 200.0
    assert trf1["salida"]["transferenciaGrupoId"] == trf1["entrada"]["transferenciaGrupoId"]

    # 2) Cambio de divisas (VES -> USD): Bs. 5.500 a tasa pactada 55 Bs/USD -> $100 USD
    r_fx = api.post(
        "/bancos/transferencias",
        json={
            "empresaId": emp_id,
            "cuentaOrigenId": cta_bs["id"],
            "cuentaDestinoId": cta_usd1["id"],
            "fecha": hoy.isoformat(),
            "monto": 5500,
            "tasaPactada": 55,
            "concepto": "Compra mesa de cambio",
            "referencia": "FX-900",
        },
    )
    assert r_fx.status_code == 201, r_fx.text
    fx = r_fx.json()
    assert fx["salida"]["monto"] == -5500.0 and fx["salida"]["montoUsd"] == -100.0
    assert fx["entrada"]["monto"] == 100.0 and fx["entrada"]["montoBs"] == 5500.0

    # Saldos tras ambos traspasos: Bs = 4.500, USD1 = 400, USD2 = 200
    por_id = {c["id"]: c for c in api.get(f"/bancos/cuentas?empresaId={emp_id}").json()}
    assert por_id[cta_bs["id"]]["saldoActual"] == 4500.0
    assert por_id[cta_usd1["id"]]["saldoActual"] == 400.0
    assert por_id[cta_usd2["id"]]["saldoActual"] == 200.0

    # 3) Anular una pata del cambio de divisas anula AMBAS patas con contra-asientos (nunca DELETE)
    filas_antes = db.execute(
        'SELECT COUNT(*) AS n FROM "MovimientoBancario" WHERE "empresaId" = %s', (emp_id,)
    ).fetchone()["n"]
    r_anul = api.post(
        f"/bancos/movimientos/{fx['salida']['id']}/anular",
        json={"motivo": "Operación cambiaria reversada por mesa"},
    )
    assert r_anul.status_code == 200, r_anul.text
    anul = r_anul.json()
    assert anul["anulado"]["anuladoEn"] is not None
    assert len(anul["reversos"]) == 2
    assert all(rv["reversoDeId"] is not None for rv in anul["reversos"])

    filas_despues = db.execute(
        'SELECT COUNT(*) AS n FROM "MovimientoBancario" WHERE "empresaId" = %s', (emp_id,)
    ).fetchone()["n"]
    assert filas_despues == filas_antes + 2  # Nunca se borran filas

    # Re-anular el original o intentar anular el contra-asiento -> 409
    assert api.post(f"/bancos/movimientos/{fx['salida']['id']}/anular", json={"motivo": "Otra vez"}).status_code == 409
    reverso_id = anul["reverso"]["id"]
    assert api.post(f"/bancos/movimientos/{reverso_id}/anular", json={"motivo": "Reverso"}).status_code == 409

    # Saldos restaurados: Bs = 10.000, USD1 = 300, USD2 = 200
    por_id = {c["id"]: c for c in api.get(f"/bancos/cuentas?empresaId={emp_id}").json()}
    assert por_id[cta_bs["id"]]["saldoActual"] == 10000.0
    assert por_id[cta_usd1["id"]]["saldoActual"] == 300.0
    assert por_id[cta_usd2["id"]]["saldoActual"] == 200.0

    # 4) Registrar un ingreso ($120) y un egreso (Bs. 2.500 = $50 a tasa BCV 50) para probar flujo de caja
    api.post(
        "/bancos/movimientos",
        json={
            "empresaId": emp_id,
            "cuentaId": cta_usd2["id"],
            "fecha": hoy.isoformat(),
            "tipo": "INGRESO",
            "metodo": "ZELLE",
            "categoria": "COBRANZA_CLIENTES",
            "concepto": "Pago factura 501",
            "monto": 120,
        },
    )
    api.post(
        "/bancos/movimientos",
        json={
            "empresaId": emp_id,
            "cuentaId": cta_bs["id"],
            "fecha": hoy.isoformat(),
            "tipo": "EGRESO",
            "metodo": "PAGO_MOVIL",
            "categoria": "DELIVERY",
            "concepto": "Flete motorizados",
            "monto": -2500,
        },
    )

    desde = (hoy - timedelta(days=5)).isoformat()
    hasta = hoy.isoformat()
    flujo = api.get(f"/bancos/flujo-caja?empresaId={emp_id}&desde={desde}&hasta={hasta}&agrupacion=dia").json()
    # Apertura: Bs 10.000 / 50 = $200 + USD1 $500 + USD2 $0 = $700 (traspasos internos se excluyen del consolidado)
    assert flujo["saldoInicialUsd"] == pytest.approx(700.0)
    assert flujo["totalIngresosUsd"] == pytest.approx(120.0)
    assert flujo["totalEgresosUsd"] == pytest.approx(50.0)
    assert flujo["flujoNetoUsd"] == pytest.approx(70.0)
    assert flujo["saldoFinalUsd"] == pytest.approx(770.0)
    assert len(flujo["series"]) == 1
    assert {c["categoria"] for c in flujo["porCategoria"]} == {"COBRANZA_CLIENTES", "DELIVERY"}

    # Exportación Excel (.xlsx)
    r_xlsx = api.get(
        f"/bancos/flujo-caja?empresaId={emp_id}&desde={desde}&hasta={hasta}&agrupacion=mes&formato=xlsx"
    )
    assert r_xlsx.status_code == 200
    assert "spreadsheetml" in r_xlsx.headers["content-type"]
    wb = openpyxl.load_workbook(io.BytesIO(r_xlsx.content))
    assert wb.sheetnames == ["Flujo de Caja", "Por Categoría"]


# ---------- 4. Parser de extractos venezolanos y conciliación con Gastos ----------


def test_parser_decimales_y_encabezados_bancos_venezuela():
    # CSV estilo Banesco/Mercantil con metadatos arriba, separador `;` y decimales `1.234,56`
    csv_banesco = (
        "BANESCO BANCO UNIVERSAL C.A.\n"
        "RIF: J-07013380-5\n"
        "Cuenta Corriente: 0134-0001-23-0012345678\n"
        "Estado de Cuenta del Mes\n"
        "\n"
        "Fecha Operación;Referencia;Descripción;Débito;Crédito;Saldo Disponible\n"
        "10/11/2026;00987654;PAGO MOVIL CLIENTE SUR;;12.500,75;62.500,75\n"
        "11/11/2026;00445566;TRANSF PROVEEDOR LACTEOS;2.500,50;;60.000,25\n"
        "12/11/2026;00001122;COMISION IGTF 2%;50,01;;59.950,24\n"
        "TOTALES;;;2.550,51;12.500,75;\n"
    ).encode("cp1252")

    leido = extracto_bancario.parsear_extracto(csv_banesco, "banesco_noviembre.csv")
    assert len(leido.lineas) == 3
    assert leido.periodo_desde == date(2026, 11, 10)
    assert leido.periodo_hasta == date(2026, 11, 12)
    assert leido.saldo_final == Decimal("59950.24")
    assert leido.lineas[0].monto == Decimal("12500.75")
    assert leido.lineas[1].monto == Decimal("-2500.50")
    assert leido.lineas[2].monto == Decimal("-50.01")

    # Formato columna única con indicador Tipo (BDV / Provincial) y signo al final
    csv_bdv = (
        "Banco de Venezuela\n"
        "Fecha,Nro. Operacion,Concepto,Naturaleza,Monto,Saldo\n"
        "2026-11-15,778899,NOTA DE DEBITO POS,ND,\"1.200,00\",\"8.800,00\"\n"
        "2026-11-16,778900,ABONO TRANSFERENCIA,NC,\"3.000,00\",\"11.800,00\"\n"
    ).encode("utf-8-sig")
    leido_bdv = extracto_bancario.parsear_extracto(csv_bdv, "bdv.csv")
    assert [ln.monto for ln in leido_bdv.lineas] == [Decimal("-1200.00"), Decimal("3000.00")]
    assert leido_bdv.saldo_final == Decimal("11800.00")


def test_conciliacion_cruce_4_estados_confirmacion_e_idempotencia_gasto(db, usuario, cliente_api):
    """Usa `emp-tralog` (`TRALOG`) para cruzar contra `Gasto` (`GastoCarga` CONFIRMADA vs REVERTIDA)
    y restaurar el estado del interruptor al terminar."""
    hoy = hoy_caracas()
    f_base = hoy - timedelta(days=5)
    admin = usuario("ADMIN")
    api = cliente_api(admin)

    db.execute(
        'INSERT INTO "TasaCambio" ("fecha", "tasa", "fuente") VALUES (%s, 50.00, \'MANUAL\') '
        'ON CONFLICT ("fecha") DO UPDATE SET "tasa" = 50.00',
        (f_base - timedelta(days=10),),
    )
    db.execute(
        'INSERT INTO "TasaCambio" ("fecha", "tasa", "fuente") VALUES (%s, 50.00, \'MANUAL\') '
        'ON CONFLICT ("fecha") DO UPDATE SET "tasa" = 50.00',
        (hoy,),
    )
    db.commit()

    api.put("/empresas/emp-tralog/modulos/bancos", json={"activo": True})
    carga_conf_id = f"gc-conf-{uuid.uuid4().hex[:8]}"
    carga_rev_id = f"gc-rev-{uuid.uuid4().hex[:8]}"
    gasto_ok_id = f"gasto-ok-{uuid.uuid4().hex[:8]}"
    gasto_idem_id = f"gasto-idem-{uuid.uuid4().hex[:8]}"
    gasto_rev_id = f"gasto-rev-{uuid.uuid4().hex[:8]}"
    cta_id = None

    try:
        cta = api.post(
            "/bancos/cuentas",
            json={
                "empresaId": "emp-tralog",
                "nombre": f"Provincial Conciliación {carga_conf_id}",
                "tipo": "BANCO_CORRIENTE",
                "moneda": "VES",
                "bancoCodigo": "0108",
                "saldoInicial": 100000,
                "fechaSaldoInicial": (f_base - timedelta(days=5)).isoformat(),
            },
        ).json()
        cta_id = cta["id"]

        # 1) Movimiento ya registrado en el sistema que SÍ saldrá en el extracto (+2 días dentro de ±3)
        mov_en_banco = api.post(
            "/bancos/movimientos",
            json={
                "empresaId": "emp-tralog",
                "cuentaId": cta_id,
                "fecha": f_base.isoformat(),
                "tipo": "INGRESO",
                "metodo": "TRANSFERENCIA",
                "categoria": "COBRANZA_CLIENTES",
                "concepto": "Cobro Distribuidora Norte",
                "referencia": "889900",
                "monto": 15000.00,
            },
        ).json()

        # 2) Movimiento en el sistema (cheque en tránsito) que NO saldrá en el extracto -> SOLO_EN_SISTEMA
        mov_transito = api.post(
            "/bancos/movimientos",
            json={
                "empresaId": "emp-tralog",
                "cuentaId": cta_id,
                "fecha": (f_base + timedelta(days=1)).isoformat(),
                "tipo": "EGRESO",
                "metodo": "CHEQUE",
                "categoria": "GASTO_OPERATIVO",
                "concepto": "Cheque no cobrado aún",
                "referencia": "CHQ-7711",
                "monto": -4200.00,
            },
        ).json()

        # 3) Gastos en GastoCarga CONFIRMADA vs REVERTIDA
        db.execute(
            'INSERT INTO "GastoCarga" ("id", "empresa", "archivo", "periodoDesde", "periodoHasta", "filas", '
            '"totalUsd", "estado", "subidaPorId") VALUES (%s, \'TRALOG\', \'gastos_nov.xlsx\', %s, %s, 2, 180, \'CONFIRMADA\', %s)',
            (carga_conf_id, f_base, f_base + timedelta(days=3), admin["id"]),
        )
        db.execute(
            'INSERT INTO "Gasto" ("id", "cargaId", "empresa", "fecha", "categoria", "descripcion", "proveedor", '
            '"referencia", "montoUsd", "montoBs", "moneda", "tasa") VALUES '
            "(%s, %s, 'TRALOG', %s, 'Combustible', 'Gasoil flota', 'Estacion Central', '554433', 100.00, 5000.00, 'BS', 50.00), "
            "(%s, %s, 'TRALOG', %s, 'Servicios', 'Internet fibra', 'NetUno', '991122', 80.00, 4000.00, 'BS', 50.00)",
            (gasto_ok_id, carga_conf_id, f_base, gasto_idem_id, carga_conf_id, f_base + timedelta(days=1)),
        )

        db.execute(
            'INSERT INTO "GastoCarga" ("id", "empresa", "archivo", "periodoDesde", "periodoHasta", "filas", '
            '"totalUsd", "estado", "subidaPorId") VALUES (%s, \'TRALOG\', \'revertida.xlsx\', %s, %s, 1, 60, \'REVERTIDA\', %s)',
            (carga_rev_id, f_base, f_base + timedelta(days=3), admin["id"]),
        )
        db.execute(
            'INSERT INTO "Gasto" ("id", "cargaId", "empresa", "fecha", "categoria", "descripcion", "proveedor", '
            '"referencia", "montoUsd", "montoBs", "moneda", "tasa") VALUES '
            "(%s, %s, 'TRALOG', %s, 'Otros', 'Gasto revertido', 'Proveedor X', '332211', 60.00, 3000.00, 'BS', 50.00)",
            (gasto_rev_id, carga_rev_id, f_base + timedelta(days=1)),
        )
        db.commit()

        # Armar Excel (.xlsx) del banco con 4 filas bancarias:
        # - Fila 1: +15.000,00 ref 00889900 (f_base + 2d -> dentro de ±3d de mov_en_banco) -> COINCIDE_MOVIMIENTO
        # - Fila 2: -5.000,00 ref 00554433 (f_base + 1d -> cruza gasto_ok_id) -> COINCIDE_GASTO
        # - Fila 3: -4.000,00 ref 00991122 (f_base + 2d -> cruza gasto_idem_id) -> COINCIDE_GASTO
        # - Fila 4: -3.000,00 ref 00332211 (carga REVERTIDA -> NO debe cruzar gasto, queda SOLO_EN_BANCO)
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "Extracto Provincial"
        ws.append(["BBVA PROVINCIAL - ESTADO DE CUENTA EMPRESAS"])
        ws.append(["Cuenta:", "0108-0001-00-0000001234"])
        ws.append([])
        ws.append(["Fecha Operación", "Referencia", "Concepto", "Cargos", "Abonos", "Saldo Disponible"])
        ws.append([(f_base).strftime("%d/%m/%Y"), "00889900", "TRANSF RECIBIDA NORTE", None, "15.000,00", "115.000,00"])
        ws.append([(f_base + timedelta(days=1)).strftime("%d/%m/%Y"), "00554433", "PAGO ESTACION CENTRAL", "5.000,00", None, "110.000,00"])
        ws.append([(f_base + timedelta(days=2)).strftime("%d/%m/%Y"), "00991122", "DOMICILIACION NETUNO", "4.000,00", None, "106.000,00"])
        ws.append([(f_base + timedelta(days=2)).strftime("%d/%m/%Y"), "00332211", "COMISION BANCARIA / OTRO", "3.000,00", None, "103.000,00"])

        buf = io.BytesIO()
        wb.save(buf)

        r_ana = api.post(
            "/bancos/conciliaciones/analizar",
            data={"cuentaId": cta_id, "empresaId": "emp-tralog"},
            files={"archivo": ("provincial.xlsx", buf.getvalue(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        )
        assert r_ana.status_code == 201, r_ana.text
        conc = r_ana.json()
        assert conc["estado"] == "BORRADOR"
        assert conc["saldoExtractoFinal"] == 103000.0
        res = conc["resumen"]
        assert res["totalLineasBanco"] == 4
        assert res["coincideMovimiento"] == 1
        assert res["coincideGasto"] == 2
        assert res["soloEnBanco"] == 1
        assert res["soloEnSistema"] == 1
        assert res["totalIngresosBanco"] == 15000.0
        assert res["totalEgresosBanco"] == 12000.0

        # Verificar que mov_transito quedó clasificado como SOLO_EN_SISTEMA
        solo_sis = [l for l in conc["lineas"] if l["estado"] == "SOLO_EN_SISTEMA"]
        assert len(solo_sis) == 1 and solo_sis[0]["movimientoId"] == mov_transito["id"]

        # Probar IDEMPOTENCIA en gastoId: antes de confirmar la conciliación, alguien registra
        # manualmente el movimiento de gasto_idem_id; al confirmar el lote NO debe fallar ni duplicar!
        mov_manual_idem = api.post(
            "/bancos/movimientos",
            json={
                "empresaId": "emp-tralog",
                "cuentaId": cta_id,
                "fecha": (f_base + timedelta(days=1)).isoformat(),
                "tipo": "EGRESO",
                "metodo": "TRANSFERENCIA",
                "categoria": "GASTO_OPERATIVO",
                "concepto": "Pago manual previo NetUno",
                "gastoId": gasto_idem_id,
                "monto": -4000.00,
            },
        )
        assert mov_manual_idem.status_code == 201, mov_manual_idem.text

        # Confirmar seleccionando las 4 líneas del banco con registrarFaltantes=True
        r_conf = api.post(
            f"/bancos/conciliaciones/{conc['id']}/confirmar",
            json={"lineasSeleccionadas": [1, 2, 3, 4], "registrarFaltantes": True},
        )
        assert r_conf.status_code == 200, r_conf.text
        confirmada = r_conf.json()
        assert confirmada["estado"] == "CONFIRMADA"
        assert confirmada["confirmadaEn"] is not None

        # Verificar que existe exactamente 1 movimiento activo para cada gastoId (sin duplicados)
        for gid in (gasto_ok_id, gasto_idem_id):
            cnt = db.execute(
                'SELECT COUNT(*) AS n, BOOL_AND("conciliado") AS conc FROM "MovimientoBancario" '
                'WHERE "gastoId" = %s AND "anuladoEn" IS NULL',
                (gid,),
            ).fetchone()
            assert cnt["n"] == 1 and cnt["conc"] is True

        # mov_en_banco quedó conciliado, y mov_transito sigue sin conciliar
        movs_cta = {m["id"]: m for m in api.get(f"/bancos/movimientos?empresaId=emp-tralog&cuentaId={cta_id}").json()}
        assert movs_cta[mov_en_banco["id"]]["conciliado"] is True
        assert movs_cta[mov_transito["id"]]["conciliado"] is False

        # Re-confirmar la misma conciliación devuelve 409
        assert api.post(
            f"/bancos/conciliaciones/{conc['id']}/confirmar",
            json={"lineasSeleccionadas": [1]},
        ).status_code == 409

        # Historial GET /bancos/conciliaciones
        hist = api.get(f"/bancos/conciliaciones?empresaId=emp-tralog&cuentaId={cta_id}").json()
        assert any(h["id"] == conc["id"] and h["estado"] == "CONFIRMADA" for h in hist)
    finally:
        # Limpieza para no contaminar otras pruebas sobre emp-tralog
        if cta_id:
            db.execute('DELETE FROM "ConciliacionBancaria" WHERE "cuentaId" = %s', (cta_id,))
            db.execute('DELETE FROM "MovimientoBancario" WHERE "cuentaId" = %s', (cta_id,))
            db.execute('DELETE FROM "CuentaTesoreria" WHERE "id" = %s', (cta_id,))
        db.execute('DELETE FROM "GastoCarga" WHERE "id" IN (%s, %s)', (carga_conf_id, carga_rev_id))
        db.commit()
        api.put("/empresas/emp-tralog/modulos/bancos", json={"activo": False})


# ---------- 5. Enlace opcional desde Cobranzas (`cuentaTesoreriaId`) ----------


def test_verificar_pago_cobranzas_con_cuenta_tesoreria(db, usuario, cliente_api):
    hoy = hoy_caracas()
    tag = uuid.uuid4().hex[:8]
    cod_cli = f"CB{tag[:6].upper()}"
    doc_id = f"dcob-{tag}"
    pago_id_1 = f"pago-rep1-{tag}"
    pago_id_2 = f"pago-rep2-{tag}"
    cta_id = None

    admin = usuario("ADMIN")
    cob = usuario("COBRANZAS")
    api_adm = cliente_api(admin)
    api_cob = cliente_api(cob)

    db.execute(
        'INSERT INTO "TasaCambio" ("fecha", "tasa", "fuente") VALUES (%s, 50.00, \'MANUAL\') '
        'ON CONFLICT ("fecha") DO UPDATE SET "tasa" = 50.00',
        (hoy,),
    )
    db.execute(
        'INSERT INTO "VentaCliente" ("id", "empresa", "codigo", "nombre", "tipo", "ruta") '
        "VALUES (%s, 'ISVAN', %s, 'Abasto El Sol', 'TRADICIONAL', 'R1')",
        (f"vc-{tag}", cod_cli),
    )
    db.execute(
        'INSERT INTO "DocumentoCobro" ("id", "empresa", "codigoCliente", "tipoDoc", "numero", '
        '"fecha", "vencimiento", "montoUsd", "montoBs", "origen") '
        "VALUES (%s, 'ISVAN', %s, 'FA', %s, %s, %s, 200.00, 10000.00, 'SISTEMA')",
        (doc_id, cod_cli, f"FA-{tag}", hoy - timedelta(days=5), hoy + timedelta(days=10)),
    )
    # Dos pagos reportados por portal: uno de Bs. 5.000 ($100) y otro de Bs. 2.500 ($50)
    db.execute(
        'INSERT INTO "Pago" ("id", "numero", "empresa", "codigoCliente", "metodo", "bancoCodigo", '
        '"telefono", "cedulaRif", "referencia", "fechaPago", "montoBs", "tasa", "montoUsd", "estado") VALUES '
        "(%s, %s, 'ISVAN', %s, 'PAGO_MOVIL', '0134', '04141234567', 'V12345678', %s, %s, 5000.00, 50.00, 100.00, 'REPORTADO'), "
        "(%s, %s, 'ISVAN', %s, 'PAGO_MOVIL', '0134', '04141234567', 'V12345678', %s, %s, 2500.00, 50.00, 50.00, 'REPORTADO')",
        (pago_id_1, f"P-91{tag[:4]}", cod_cli, f"REF1{tag[:4]}", hoy, pago_id_2, f"P-92{tag[:4]}", cod_cli, f"REF2{tag[:4]}", hoy),
    )
    db.commit()

    try:
        # Caso A: Módulo bancos APAGADO en emp-isvan -> verificar pago funciona sin crear MovimientoBancario
        api_adm.put("/empresas/emp-isvan/modulos/bancos", json={"activo": False})
        r_off = api_cob.post(
            f"/cobranzas/pagos/{pago_id_2}/verificar",
            json={"cuentaTesoreriaId": "ctes-inexistente"},
        )
        assert r_off.status_code == 200, r_off.text
        assert r_off.json()["estado"] == "VERIFICADO"
        mov_off = db.execute('SELECT 1 FROM "MovimientoBancario" WHERE "pagoId" = %s', (pago_id_2,)).fetchone()
        assert mov_off is None

        # Caso B: Módulo bancos ACTIVO en emp-isvan -> verificar pago con cuentaTesoreriaId crea INGRESO vinculado
        api_adm.put("/empresas/emp-isvan/modulos/bancos", json={"activo": True})
        cta = api_adm.post(
            "/bancos/cuentas",
            json={
                "empresaId": "emp-isvan",
                "nombre": f"Banesco Cobranzas {tag}",
                "tipo": "BANCO_CORRIENTE",
                "moneda": "VES",
                "bancoCodigo": "0134",
                "saldoInicial": 1000,
            },
        ).json()
        cta_id = cta["id"]

        r_on = api_cob.post(
            f"/cobranzas/pagos/{pago_id_1}/verificar",
            json={"cuentaTesoreriaId": cta_id},
        )
        assert r_on.status_code == 200, r_on.text
        verif = r_on.json()
        assert verif["estado"] == "VERIFICADO"
        assert verif["cuentaTesoreriaId"] == cta_id

        movs = api_cob.get(f"/bancos/movimientos?empresaId=emp-isvan&cuentaId={cta_id}").json()
        assert len(movs) == 1
        assert movs[0]["pagoId"] == pago_id_1
        assert movs[0]["tipo"] == "INGRESO"
        assert movs[0]["categoria"] == "COBRANZA_CLIENTES"
        assert movs[0]["monto"] == 5000.0
        assert movs[0]["montoUsd"] == 100.0
        assert movs[0]["saldoResultante"] == 6000.0

        # Si se anula el movimiento en tesorería, limpia cuentaTesoreriaId en Pago y restaura saldo
        r_anul = api_adm.post(
            f"/bancos/movimientos/{movs[0]['id']}/anular",
            json={"motivo": "Reclasificación de cuenta bancaria"},
        )
        assert r_anul.status_code == 200, r_anul.text
        fila_pago = db.execute('SELECT "cuentaTesoreriaId" FROM "Pago" WHERE "id" = %s', (pago_id_1,)).fetchone()
        assert fila_pago["cuentaTesoreriaId"] is None
    finally:
        db.execute('DELETE FROM "PagoAplicacion" WHERE "pagoId" IN (%s, %s)', (pago_id_1, pago_id_2))
        if cta_id:
            db.execute('DELETE FROM "MovimientoBancario" WHERE "cuentaId" = %s', (cta_id,))
            db.execute('DELETE FROM "CuentaTesoreria" WHERE "id" = %s', (cta_id,))
        db.execute('DELETE FROM "Pago" WHERE "id" IN (%s, %s)', (pago_id_1, pago_id_2))
        db.execute('DELETE FROM "DocumentoCobro" WHERE "id" = %s', (doc_id,))
        db.execute('DELETE FROM "VentaCliente" WHERE "id" = %s', (f"vc-{tag}",))
        db.commit()
        api_adm.put("/empresas/emp-isvan/modulos/bancos", json={"activo": False})
