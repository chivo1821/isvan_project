"""Pruebas de la plantilla de gastos con las 13 columnas solicitadas por el cliente."""

from __future__ import annotations

import io
from datetime import date

import openpyxl

ENCABEZADOS_ESPERADOS = [
    "Fecha",
    "Empresa",
    "Categoría",
    "Descripción",
    "Proveedor",
    "Tipo de Documento",
    "Numero Documento Proveedor",
    "Referencia",
    "Monto USD",
    "Monto Bs",
    "Tasa",
    "Banco",
    "Retención",
]


def _excel_bytes(filas: list[list]) -> bytes:
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "gastos"
    for fila in filas:
        ws.append(fila)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def test_plantilla_gastos_tiene_las_13_columnas_del_cliente(cliente_api, usuario, db):
    admin = usuario()
    api = cliente_api(admin)

    # Tasa BCV para la fila de ejemplo en Bs (2026-11-05)
    db.execute(
        'INSERT INTO "TasaCambio" ("fecha", "tasa", "fuente") VALUES (%s, %s, \'DOLARAPI\') '
        'ON CONFLICT ("fecha") DO NOTHING',
        (date(2026, 11, 5), 50.0),
    )
    db.commit()

    r = api.get("/gastos/plantilla")
    assert r.status_code == 200, r.text

    wb = openpyxl.load_workbook(io.BytesIO(r.content), data_only=True)
    ws = wb.active
    encabezados = [c.value for c in ws[1]]
    assert encabezados == ENCABEZADOS_ESPERADOS

    # La plantilla descargada se puede analizar y cargar sin errores
    prev = api.post(
        "/gastos/cargas/preview",
        files={"archivo": ("plantilla_gastos.xlsx", r.content,
                           "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )
    assert prev.status_code == 200, prev.text
    body = prev.json()
    assert body["problemas"] == []
    assert body["empresas"][0]["empresa"] == "TRALOG"
    assert body["empresas"][0]["filas"] == 3
    for clave in ("tipo_documento", "numero_documento_proveedor", "banco", "retencion"):
        assert clave in body["columnas"]


def test_cargar_gastos_guarda_y_devuelve_las_4_columnas_nuevas(cliente_api, usuario):
    admin = usuario()
    api = cliente_api(admin)

    contenido = _excel_bytes([
        ENCABEZADOS_ESPERADOS,
        [
            date(2026, 11, 12), "TRALOG", "Servicios", "Flete externo", "Transporte Sur C.A.",
            "Factura", "FAC-00881", "TRF-9921", 450.00, None, None, "Banesco", "75% IVA",
        ],
    ])

    r = api.post(
        "/gastos/cargas",
        files={"archivo": ("gastos_nov.xlsx", contenido,
                           "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )
    assert r.status_code == 200, r.text
    assert len(r.json()["cargas"]) == 1

    lst = api.get("/gastos", params={"desde": "2026-11-12", "hasta": "2026-11-12", "empresa": "TRALOG"})
    assert lst.status_code == 200, lst.text
    gastos = lst.json()["gastos"]
    assert len(gastos) == 1
    g = gastos[0]
    assert g["tipoDocumento"] == "Factura"
    assert g["numeroDocumentoProveedor"] == "FAC-00881"
    assert g["referencia"] == "TRF-9921"
    assert g["banco"] == "Banesco"
    assert g["retencion"] == "75% IVA"
    assert g["montoUsd"] == 450.0


def test_compatibilidad_con_excel_sin_columnas_nuevas(cliente_api, usuario):
    admin = usuario()
    api = cliente_api(admin)

    contenido = _excel_bytes([
        ["Fecha", "Empresa", "Categoría", "Descripción", "Proveedor", "Referencia", "Monto USD"],
        [date(2026, 11, 13), "ISVAN", "Papelería", "Resmas de papel", "Librería Central", "REC-11", 35.0],
    ])

    r = api.post(
        "/gastos/cargas",
        files={"archivo": ("viejo.xlsx", contenido,
                           "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )
    assert r.status_code == 200, r.text

    lst = api.get("/gastos", params={"desde": "2026-11-13", "hasta": "2026-11-13", "empresa": "ISVAN"})
    assert lst.status_code == 200, lst.text
    g = lst.json()["gastos"][0]
    assert g["tipoDocumento"] is None
    assert g["numeroDocumentoProveedor"] is None
    assert g["banco"] is None
    assert g["retencion"] is None
    assert g["montoUsd"] == 35.0
