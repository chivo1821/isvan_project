"""Fase 4.2: Segunda fuente de respaldo para la tasa BCV (BCV_DIRECTO) y
proteccion de tasas cargadas a mano (MANUAL)."""

from __future__ import annotations

import ssl
from datetime import date
from decimal import Decimal

import httpx
import pytest

from app.services import tasa_bcv


class _RespuestaFake:
    def __init__(
        self,
        url: str,
        *,
        status_code: int = 200,
        json_data=None,
        text: str = "",
    ) -> None:
        self.url = url
        self.status_code = status_code
        self._json_data = json_data
        self.text = text
        self.request = httpx.Request("GET", url)

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise httpx.HTTPStatusError(
                f"HTTP {self.status_code} para {self.url}",
                request=self.request,
                response=httpx.Response(self.status_code, request=self.request),
            )

    def json(self):
        if self._json_data is None:
            raise ValueError("Sin JSON")
        return self._json_data


@pytest.fixture(autouse=True)
def limpiar_tasas_y_entorno(db, monkeypatch):
    monkeypatch.delenv("TASA_BCV_URL_RESPALDO", raising=False)
    monkeypatch.delenv("TASA_BCV_VERIFICAR_SSL", raising=False)
    db.execute('DELETE FROM "TasaCambio"')
    db.commit()
    try:
        yield
    finally:
        db.rollback()
        db.execute('DELETE FROM "TasaCambio"')
        db.commit()


def test_primaria_dolarapi_exitosa_guarda_dolarapi(db, monkeypatch):
    urls_consultadas: list[str] = []

    def fake_get(url: str, **kwargs):
        urls_consultadas.append(url)
        if url == tasa_bcv.URL_HISTORICO:
            return _RespuestaFake(
                url,
                json_data=[
                    {"fecha": "2026-11-19", "promedio": 53.10},
                    {"fecha": "2026-11-20", "promedio": 53.45},
                ],
            )
        if url == tasa_bcv.URL_ACTUAL:
            return _RespuestaFake(
                url,
                json_data={
                    "promedio": 53.89,
                    "fechaActualizacion": "2026-11-21T00:00:00-04:00",
                },
            )
        raise AssertionError(f"No debio consultar respaldo: {url}")

    monkeypatch.setattr(httpx, "get", fake_get)

    with db.cursor() as cur:
        cambios = tasa_bcv.actualizar(cur)
    db.commit()

    assert cambios == 3
    assert tasa_bcv.URL_BCV not in urls_consultadas
    filas = db.execute('SELECT "fecha", "tasa", "fuente" FROM "TasaCambio" ORDER BY "fecha"').fetchall()
    assert [(f["fecha"], f["tasa"], f["fuente"]) for f in filas] == [
        (date(2026, 11, 19), Decimal("53.10000000"), "DOLARAPI"),
        (date(2026, 11, 20), Decimal("53.45000000"), "DOLARAPI"),
        (date(2026, 11, 21), Decimal("53.89000000"), "DOLARAPI"),
    ]


def test_respaldo_bcv_html_cuando_dolarapi_falla(db, monkeypatch):
    html_bcv = """
    <html>
      <body>
        <div id="dolar" class="col-sm-12">
          <div class="row recuadrotsmc">
            <div class="col-sm-6"><span> USD</span></div>
            <div class="col-sm-6 centrado"><strong> 54,12340000 </strong></div>
          </div>
        </div>
        <div class="pull-right dinpro center">
          Fecha Valor:
          <span property="dc:date" datatype="xsd:dateTime"
                content="2026-11-21T00:00:00-04:00"
                class="date-display-single">Sábado, 21 Noviembre, 2026</span>
        </div>
      </body>
    </html>
    """

    def fake_get(url: str, **kwargs):
        if url in (tasa_bcv.URL_HISTORICO, tasa_bcv.URL_ACTUAL):
            raise httpx.ConnectError("DolarApi caido", request=httpx.Request("GET", url))
        if url == tasa_bcv.URL_BCV:
            return _RespuestaFake(url, text=html_bcv)
        raise AssertionError(f"URL inesperada: {url}")

    monkeypatch.setattr(httpx, "get", fake_get)

    with db.cursor() as cur:
        cambios = tasa_bcv.actualizar(cur)
    db.commit()

    assert cambios == 1
    fila = db.execute('SELECT "fecha", "tasa", "fuente" FROM "TasaCambio"').fetchone()
    assert fila == {
        "fecha": date(2026, 11, 21),
        "tasa": Decimal("54.12340000"),
        "fuente": "BCV_DIRECTO",
    }


def test_respaldo_bcv_html_fechasvalor_y_dolarapi_vacio(db, monkeypatch):
    html_bcv = """
    <html>
      <body>
        <div id="dolar"><img src="usd.png"><strong> 1.234,5678 </strong></div>
        <div class="fechasValor">Fecha Valor: 22/11/2026</div>
      </body>
    </html>
    """

    def fake_get(url: str, **kwargs):
        if url == tasa_bcv.URL_HISTORICO:
            return _RespuestaFake(url, json_data=[])
        if url == tasa_bcv.URL_ACTUAL:
            return _RespuestaFake(url, json_data={})
        if url == tasa_bcv.URL_BCV:
            return _RespuestaFake(url, text=html_bcv)
        raise AssertionError(f"URL inesperada: {url}")

    monkeypatch.setattr(httpx, "get", fake_get)

    with db.cursor() as cur:
        cambios = tasa_bcv.actualizar(cur)
    db.commit()

    assert cambios == 1
    fila = db.execute('SELECT "fecha", "tasa", "fuente" FROM "TasaCambio"').fetchone()
    assert fila == {
        "fecha": date(2026, 11, 22),
        "tasa": Decimal("1234.56780000"),
        "fuente": "BCV_DIRECTO",
    }


def test_respaldo_json_env_cuando_dolarapi_falla(db, monkeypatch):
    url_json = "https://respaldo.ejemplo.test/bcv.json"
    monkeypatch.setenv("TASA_BCV_URL_RESPALDO", url_json)

    def fake_get(url: str, **kwargs):
        if url in (tasa_bcv.URL_HISTORICO, tasa_bcv.URL_ACTUAL):
            return _RespuestaFake(url, status_code=503)
        if url == url_json:
            return _RespuestaFake(
                url,
                json_data={"tasa": "55.4321", "fechaValor": "2026-11-24"},
            )
        raise AssertionError(f"URL inesperada: {url}")

    monkeypatch.setattr(httpx, "get", fake_get)

    with db.cursor() as cur:
        cambios = tasa_bcv.actualizar(cur)
    db.commit()

    assert cambios == 1
    fila = db.execute('SELECT "fecha", "tasa", "fuente" FROM "TasaCambio"').fetchone()
    assert fila == {
        "fecha": date(2026, 11, 24),
        "tasa": Decimal("55.43210000"),
        "fuente": "BCV_DIRECTO",
    }


def test_regla_de_oro_no_pisa_manual_pero_actualiza_automaticas(db, usuario, monkeypatch):
    usr = usuario("COBRANZAS")
    fecha_manual = date(2026, 11, 18)
    fecha_dolarapi = date(2026, 11, 19)
    fecha_bcv = date(2026, 11, 20)
    fecha_nueva = date(2026, 11, 21)

    with db.cursor() as cur:
        tasa_bcv.guardar_manual(cur, fecha_manual, Decimal("99.99"), usr["id"])
    db.execute(
        'INSERT INTO "TasaCambio" ("fecha", "tasa", "fuente") VALUES '
        "(%s, 50.00, 'DOLARAPI'), (%s, 51.00, 'BCV_DIRECTO')",
        (fecha_dolarapi, fecha_bcv),
    )
    db.commit()

    # 1. Primaria DOLARAPI: inserta nueva, actualiza DOLARAPI y BCV_DIRECTO, pero NO toca MANUAL
    def fake_dolarapi(url: str, **kwargs):
        if url == tasa_bcv.URL_HISTORICO:
            return _RespuestaFake(
                url,
                json_data=[
                    {"fecha": "2026-11-18", "promedio": 40.00},
                    {"fecha": "2026-11-19", "promedio": 52.00},
                    {"fecha": "2026-11-20", "promedio": 52.50},
                ],
            )
        if url == tasa_bcv.URL_ACTUAL:
            return _RespuestaFake(
                url,
                json_data={"promedio": 53.00, "fechaActualizacion": "2026-11-21T00:00:00-04:00"},
            )
        raise AssertionError(f"URL inesperada: {url}")

    monkeypatch.setattr(httpx, "get", fake_dolarapi)
    with db.cursor() as cur:
        cambios_1 = tasa_bcv.actualizar(cur)
    db.commit()

    assert cambios_1 == 3
    filas = {
        f["fecha"]: f
        for f in db.execute('SELECT "fecha", "tasa", "fuente", "registradoPorId" FROM "TasaCambio"').fetchall()
    }
    assert filas[fecha_manual]["tasa"] == Decimal("99.99000000")
    assert filas[fecha_manual]["fuente"] == "MANUAL"
    assert filas[fecha_manual]["registradoPorId"] == usr["id"]
    assert filas[fecha_dolarapi]["tasa"] == Decimal("52.00000000")
    assert filas[fecha_dolarapi]["fuente"] == "DOLARAPI"
    assert filas[fecha_bcv]["tasa"] == Decimal("52.50000000")
    assert filas[fecha_bcv]["fuente"] == "DOLARAPI"
    assert filas[fecha_nueva]["tasa"] == Decimal("53.00000000")
    assert filas[fecha_nueva]["fuente"] == "DOLARAPI"

    # 2. Respaldo BCV_DIRECTO cuando DolarApi cae: sigue sin tocar MANUAL, pero si actualiza DOLARAPI
    url_json = "https://respaldo.ejemplo.test/tasas.json"
    monkeypatch.setenv("TASA_BCV_URL_RESPALDO", url_json)

    def fake_respaldo(url: str, **kwargs):
        if url in (tasa_bcv.URL_HISTORICO, tasa_bcv.URL_ACTUAL):
            raise httpx.TimeoutException("timeout")
        if url == url_json:
            return _RespuestaFake(
                url,
                json_data=[
                    {"fecha": "2026-11-18", "tasa": 41.00},
                    {"fecha": "2026-11-19", "tasa": 54.00},
                ],
            )
        raise AssertionError(f"URL inesperada: {url}")

    monkeypatch.setattr(httpx, "get", fake_respaldo)
    with db.cursor() as cur:
        cambios_2 = tasa_bcv.actualizar(cur)
    db.commit()

    assert cambios_2 == 1
    filas_2 = {
        f["fecha"]: f
        for f in db.execute('SELECT "fecha", "tasa", "fuente" FROM "TasaCambio"').fetchall()
    }
    assert filas_2[fecha_manual]["tasa"] == Decimal("99.99000000")
    assert filas_2[fecha_manual]["fuente"] == "MANUAL"
    assert filas_2[fecha_dolarapi]["tasa"] == Decimal("54.00000000")
    assert filas_2[fecha_dolarapi]["fuente"] == "BCV_DIRECTO"


def test_ambas_fuentes_fallan_lanza_tasa_no_disponible(db, monkeypatch):
    def fake_fallo_red(url: str, **kwargs):
        raise httpx.ConnectError("Sin red", request=httpx.Request("GET", url))

    monkeypatch.setattr(httpx, "get", fake_fallo_red)
    with db.cursor() as cur:
        with pytest.raises(tasa_bcv.TasaNoDisponible):
            tasa_bcv.actualizar(cur)

    # Tambien cuando BCV devuelve HTML invalido/incompleto
    def fake_html_invalido(url: str, **kwargs):
        if url in (tasa_bcv.URL_HISTORICO, tasa_bcv.URL_ACTUAL):
            return _RespuestaFake(url, status_code=500)
        return _RespuestaFake(url, text="<html><body>Sin datos</body></html>")

    monkeypatch.setattr(httpx, "get", fake_html_invalido)
    with db.cursor() as cur:
        with pytest.raises(tasa_bcv.TasaNoDisponible):
            tasa_bcv.actualizar(cur)


def test_respaldo_bcv_reintenta_sin_verificacion_ssl(monkeypatch):
    intentos: list[dict] = []
    html_bcv = """
    <html><body>
      <div id="dolar"><strong>56,7890</strong></div>
      <span class="date-display-single" content="2026-11-25T00:00:00-04:00">Miércoles, 25 Noviembre, 2026</span>
    </body></html>
    """

    def fake_get(url: str, **kwargs):
        intentos.append({"url": url, "verify": kwargs.get("verify", True)})
        if kwargs.get("verify", True):
            err = httpx.ConnectError("SSL error", request=httpx.Request("GET", url))
            err.__cause__ = ssl.SSLCertVerificationError("certificate verify failed")
            raise err
        return _RespuestaFake(url, text=html_bcv)

    monkeypatch.setattr(httpx, "get", fake_get)
    tasas = tasa_bcv.leer_respaldo()

    assert tasas == [(date(2026, 11, 25), Decimal("56.7890"))]
    assert intentos == [
        {"url": tasa_bcv.URL_BCV, "verify": True},
        {"url": tasa_bcv.URL_BCV, "verify": False},
    ]


def _fake_bcv_con(monkeypatch, fecha_iso: str, tasa: str) -> None:
    html = f'<div id="dolar"><strong>{tasa}</strong></div><div class="fechasValor">Fecha Valor: {fecha_iso}</div>'

    def fake_get(url: str, **kwargs):
        if url == tasa_bcv.URL_BCV:
            return _RespuestaFake(url, text=html)
        raise httpx.ConnectError("caido", request=httpx.Request("GET", url))

    monkeypatch.setattr(httpx, "get", fake_get)


def test_respaldo_rechaza_fecha_futura(db, monkeypatch):
    futura = (tasa_bcv.hoy_caracas() + tasa_bcv.timedelta(days=10)).isoformat()
    _fake_bcv_con(monkeypatch, futura, "54,12")
    with db.cursor() as cur:
        with pytest.raises(tasa_bcv.TasaNoDisponible):
            tasa_bcv.actualizar(cur)
    assert db.execute('SELECT count(*) AS n FROM "TasaCambio"').fetchone()["n"] == 0


def test_respaldo_rechaza_desviacion_mayor_30(db, monkeypatch):
    hoy = tasa_bcv.hoy_caracas()
    db.execute(
        'INSERT INTO "TasaCambio" ("fecha", "tasa", "fuente", "registradoEn") VALUES (%s, 50, \'DOLARAPI\', now())',
        (hoy - tasa_bcv.timedelta(days=1),),
    )
    db.commit()
    _fake_bcv_con(monkeypatch, hoy.isoformat(), "80,00")
    with db.cursor() as cur:
        with pytest.raises(tasa_bcv.TasaNoDisponible):
            tasa_bcv.actualizar(cur)


def test_sin_respaldo_no_consulta_bcv(db, monkeypatch):
    def fake_get(url: str, **kwargs):
        if url == tasa_bcv.URL_BCV:
            raise AssertionError("no debio consultar el BCV")
        raise httpx.ConnectError("caido", request=httpx.Request("GET", url))

    monkeypatch.setattr(httpx, "get", fake_get)
    with db.cursor() as cur:
        with pytest.raises(tasa_bcv.TasaNoDisponible):
            tasa_bcv.actualizar(cur, con_respaldo=False)
