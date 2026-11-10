"""Gastos y estado de resultados.

Los gastos llegan en un Excel por empresa (pedido del cliente, 2026-11-09;
todavia sin el archivo real). El lector es flexible: busca la fila de
encabezados y reconoce varios nombres por columna (ALIAS). Lo minimo es la
fecha y un monto (en USD, en Bs, o "monto" con su moneda). Lo que viene en
Bs se pasa a USD con la tasa del Excel o, si no la trae, con la tasa BCV
guardada de esa fecha (o la ultima anterior).

El resultado de las operaciones, por mes:
  venta neta - costo de lo vendido = margen bruto (los mismos numeros de los
  indicadores de venta) - gastos = resultado.
"""

from __future__ import annotations

import io
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

import openpyxl

from app.core.excel_utils import normalizar_encabezado, valor_a_texto
from app.services import indicadores_venta as iv

EMPRESAS = ("ISVAN", "TRALOG")
SIN_CATEGORIA = "SIN CATEGORÍA"
CENTAVO = Decimal("0.01")

ALIAS = {
    "fecha": ["fecha", "fecha_gasto", "fecha_del_gasto", "fecha_pago", "fecha_de_pago", "dia", "fecha_factura"],
    "categoria": ["categoria", "concepto", "tipo", "tipo_de_gasto", "tipo_gasto", "cuenta", "rubro", "clasificacion",
                  "partida", "centro_de_costo"],
    "descripcion": ["descripcion", "detalle", "observacion", "observaciones", "nota", "notas", "glosa"],
    "proveedor": ["proveedor", "beneficiario", "pagado_a", "razon_social", "acreedor"],
    "referencia": ["referencia", "factura", "nro_factura", "n°_factura", "numero_factura", "documento", "comprobante",
                   "nro", "numero"],
    "monto_usd": ["monto_usd", "monto_$", "monto_en_usd", "monto_en_dolares", "usd", "$", "dolares", "monto_dolares",
                  "total_usd", "total_$", "importe_usd"],
    "monto_bs": ["monto_bs", "monto_en_bs", "monto_bolivares", "monto_en_bolivares", "bs", "bolivares", "total_bs",
                 "importe_bs", "monto_ves"],
    "monto": ["monto", "total", "importe", "valor", "monto_total"],
    "moneda": ["moneda", "divisa", "moneda_de_pago"],
    "tasa": ["tasa", "tasa_bcv", "tasa_de_cambio", "tasa_cambio"],
    "empresa": ["empresa", "compania", "compañia"],
}
MONEDA_USD = {"USD", "$", "US$", "DOLAR", "DOLARES", "DIVISA", "DIVISAS"}
MONEDA_BS = {"BS", "BS.", "VES", "BSD", "BOLIVAR", "BOLIVARES", "BS.S", "BSS"}


def redondear(valor: Decimal) -> Decimal:
    return valor.quantize(CENTAVO, rounding=ROUND_HALF_UP)


# ---------- Lectura del Excel ----------


@dataclass
class FilaGasto:
    fila: int
    empresa: str
    fecha: date
    categoria: str
    descripcion: str | None
    proveedor: str | None
    referencia: str | None
    moneda: str
    montoUsd: Decimal
    montoBs: Decimal | None
    tasa: Decimal | None


@dataclass
class Lectura:
    filas: list[FilaGasto] = field(default_factory=list)
    problemas: list[dict] = field(default_factory=list)
    columnas: dict[str, str] = field(default_factory=dict)


def _numero(valor) -> Decimal | None:
    if valor is None or valor == "":
        return None
    if isinstance(valor, (int, float)):
        return Decimal(str(valor))
    texto = str(valor).strip().replace(" ", "").replace("$", "").replace("Bs", "").replace("bs", "")
    # 1.234,56 (venezolano) o 1,234.56: el ultimo separador es el decimal.
    if "," in texto and "." in texto:
        texto = texto.replace(".", "").replace(",", ".") if texto.rfind(",") > texto.rfind(".") else texto.replace(",", "")
    elif "," in texto:
        texto = texto.replace(",", ".")
    try:
        return Decimal(texto)
    except InvalidOperation:
        return None


def _corto(texto: str | None, largo: int) -> str | None:
    return texto[:largo] if texto else None


def _fecha(valor) -> date | None:
    if isinstance(valor, datetime):
        return valor.date()
    if isinstance(valor, date):
        return valor
    texto = valor_a_texto(valor).strip()
    for formato in ("%d/%m/%Y", "%d-%m-%Y", "%Y-%m-%d", "%d/%m/%y", "%d.%m.%Y"):
        try:
            return datetime.strptime(texto, formato).date()
        except ValueError:
            continue
    return None


def _encabezados(filas: list[tuple]) -> tuple[int, dict[str, int]] | None:
    """La primera fila (de las 15 primeras) que trae fecha y algun monto."""
    for n, fila in enumerate(filas[:15]):
        normalizados = {normalizar_encabezado(v): i for i, v in enumerate(fila) if v not in (None, "")}
        mapa = {}
        for campo, alias in ALIAS.items():
            for a in alias:
                if a in normalizados:
                    mapa[campo] = normalizados[a]
                    break
        if "fecha" in mapa and ({"monto_usd", "monto_bs", "monto"} & mapa.keys()):
            return n, mapa
    return None


def leer_excel(contenido: bytes, empresa_por_defecto: str | None, moneda_por_defecto: str, tasas: "Tasas") -> Lectura:
    try:
        libro = openpyxl.load_workbook(io.BytesIO(contenido), read_only=True, data_only=True)
    except Exception as e:  # noqa: BLE001
        raise ValueError("No se pudo leer el Excel") from e
    lectura = Lectura()
    for hoja in libro.worksheets:
        filas = list(hoja.iter_rows(values_only=True))
        encontrado = _encabezados(filas)
        if encontrado:
            break
    else:
        raise ValueError(
            "No encontré la fila de encabezados: el Excel necesita al menos una columna de fecha y una de monto "
            "(Monto USD, Monto Bs, o Monto con Moneda)"
        )
    n_enc, mapa = encontrado
    lectura.columnas = {campo: str(filas[n_enc][i]) for campo, i in mapa.items()}
    if "empresa" not in mapa and not empresa_por_defecto:
        raise ValueError("El Excel no trae la columna Empresa: elige a qué empresa son estos gastos")

    def celda(fila: tuple, campo: str):
        i = mapa.get(campo)
        return fila[i] if i is not None and i < len(fila) else None

    for numero, fila in enumerate(filas[n_enc + 1:], start=n_enc + 2):
        if not fila or all(v in (None, "") for v in fila):
            continue
        texto = lambda campo: (valor_a_texto(celda(fila, campo)).strip() or None)  # noqa: E731
        fecha = _fecha(celda(fila, "fecha"))
        if not fecha:
            # Filas de totales o notas al pie: sin fecha no son un gasto.
            if any(_numero(celda(fila, c)) for c in ("monto_usd", "monto_bs", "monto")):
                lectura.problemas.append({"fila": numero, "motivo": "sin fecha válida"})
            continue
        empresa = (texto("empresa") or empresa_por_defecto or "").upper()
        if empresa not in EMPRESAS:
            lectura.problemas.append({"fila": numero, "motivo": f"empresa desconocida: {texto('empresa')}"})
            continue
        usd, bs, monto = _numero(celda(fila, "monto_usd")), _numero(celda(fila, "monto_bs")), _numero(celda(fila, "monto"))
        moneda_txt = (texto("moneda") or "").upper().replace(" ", "")
        if usd is None and bs is None and monto is not None:
            moneda = "BS" if moneda_txt in MONEDA_BS else "USD" if moneda_txt in MONEDA_USD else moneda_por_defecto
            usd, bs = (monto, None) if moneda == "USD" else (None, monto)
        tasa = _numero(celda(fila, "tasa"))
        if usd is not None:
            moneda = "USD"
        elif bs is not None:
            moneda = "BS"
            tasa = tasa or tasas.de(fecha)
            if not tasa:
                lectura.problemas.append({"fila": numero, "motivo": f"monto en Bs y no hay tasa BCV del {fecha:%d/%m/%Y}"})
                continue
            usd = bs / tasa
        else:
            lectura.problemas.append({"fila": numero, "motivo": "sin monto"})
            continue
        if usd <= 0:
            lectura.problemas.append({"fila": numero, "motivo": "monto en cero o negativo"})
            continue
        lectura.filas.append(FilaGasto(
            fila=numero, empresa=empresa, fecha=fecha,
            categoria=(texto("categoria") or SIN_CATEGORIA).upper()[:80],
            descripcion=_corto(texto("descripcion"), 300),
            proveedor=_corto(texto("proveedor"), 200),
            referencia=_corto(texto("referencia"), 80),
            moneda=moneda, montoUsd=redondear(usd), montoBs=redondear(bs) if bs is not None else None, tasa=tasa,
        ))
    return lectura


class Tasas:
    """La tasa BCV de una fecha (o la ultima anterior), leida una sola vez."""

    def __init__(self, cur):
        cur.execute('SELECT "fecha", "tasa" FROM "TasaCambio" ORDER BY "fecha"')
        self._tasas = [(f["fecha"], Decimal(f["tasa"])) for f in cur.fetchall()]

    def de(self, fecha: date) -> Decimal | None:
        anterior = None
        for f, tasa in self._tasas:
            if f > fecha:
                break
            anterior = tasa
        return anterior


def resumen_lectura(cur, lectura: Lectura) -> dict:
    """Vista previa: totales por empresa, mes y categoria, problemas y
    posibles duplicados de gastos ya cargados."""
    por_empresa: dict[str, dict] = {}
    for f in lectura.filas:
        e = por_empresa.setdefault(f.empresa, {"filas": 0, "totalUsd": Decimal(0), "porCategoria": defaultdict(Decimal),
                                               "porMes": defaultdict(Decimal), "desde": f.fecha, "hasta": f.fecha})
        e["filas"] += 1
        e["totalUsd"] += f.montoUsd
        e["porCategoria"][f.categoria] += f.montoUsd
        e["porMes"][f.fecha.strftime("%Y-%m")] += f.montoUsd
        e["desde"], e["hasta"] = min(e["desde"], f.fecha), max(e["hasta"], f.fecha)
    duplicados = []
    if lectura.filas:
        cur.execute(
            'SELECT g."empresa"::text AS "empresa", g."fecha", g."montoUsd", g."categoria" FROM "Gasto" g '
            'JOIN "GastoCarga" c ON c."id" = g."cargaId" AND c."estado" = \'CONFIRMADA\' '
            'WHERE g."fecha" BETWEEN %s AND %s',
            (min(f.fecha for f in lectura.filas), max(f.fecha for f in lectura.filas)),
        )
        ya = {(r["empresa"], r["fecha"], Decimal(r["montoUsd"]), r["categoria"]) for r in cur.fetchall()}
        duplicados = [f.fila for f in lectura.filas if (f.empresa, f.fecha, f.montoUsd, f.categoria) in ya]
    return {
        "columnas": lectura.columnas,
        "empresas": [
            {"empresa": k, "filas": v["filas"], "totalUsd": float(v["totalUsd"]), "desde": v["desde"], "hasta": v["hasta"],
             "porCategoria": sorted(({"categoria": c, "totalUsd": float(m)} for c, m in v["porCategoria"].items()),
                                    key=lambda x: -x["totalUsd"]),
             "porMes": [{"mes": m, "totalUsd": float(t)} for m, t in sorted(v["porMes"].items())]}
            for k, v in sorted(por_empresa.items())
        ],
        "problemas": lectura.problemas[:300],
        "duplicados": duplicados[:300],
        "enBs": sum(1 for f in lectura.filas if f.moneda == "BS"),
    }


# ---------- Estado de resultados ----------


def _primero(d: date) -> date:
    return d.replace(day=1)


def resultados(cur, empresas: list[str], desde: date, hasta: date) -> dict:
    """Por mes: venta neta, costo, margen bruto, gastos por categoria y
    resultado, sumando las empresas pedidas."""
    meses: dict[date, dict] = {}

    def mes(d: date) -> dict:
        return meses.setdefault(_primero(d), {
            "ventaBruta": 0.0, "devoluciones": 0.0, "ventaNeta": 0.0, "costo": 0.0, "ventaSinCosto": 0.0,
            "gastos": defaultdict(float), "totalGastos": 0.0,
        })

    for empresa in empresas:
        condicion, params = iv.where(iv.Filtros(empresa=empresa, desde=desde, hasta=hasta))
        cur.execute(
            f'SELECT date_trunc(\'month\', v."fecha")::date AS "mes", {iv.SELECT_SUMAS} {iv.FUENTE} {condicion} '
            "GROUP BY 1 ORDER BY 1",
            params,
        )
        for fila in cur.fetchall():
            datos = iv.completar(fila)
            m = mes(fila["mes"])
            for clave in ("ventaBruta", "devoluciones", "ventaNeta", "costo", "ventaSinCosto"):
                m[clave] += float(datos.get(clave) or 0)
        cur.execute(
            'SELECT date_trunc(\'month\', g."fecha")::date AS "mes", g."categoria", SUM(g."montoUsd") AS "total" '
            'FROM "Gasto" g JOIN "GastoCarga" c ON c."id" = g."cargaId" AND c."estado" = \'CONFIRMADA\' '
            'WHERE g."empresa"::text = %s AND g."fecha" BETWEEN %s AND %s GROUP BY 1, 2',
            (empresa, desde, hasta),
        )
        for fila in cur.fetchall():
            m = mes(fila["mes"])
            m["gastos"][fila["categoria"]] += float(fila["total"])
            m["totalGastos"] += float(fila["total"])

    categorias = sorted({c for m in meses.values() for c in m["gastos"]},
                        key=lambda c: -sum(m["gastos"].get(c, 0) for m in meses.values()))

    def cerrar(m: dict) -> dict:
        margen = m["ventaNeta"] - m["costo"]
        resultado = margen - m["totalGastos"]
        return {
            **{k: round(v, 2) for k, v in m.items() if k != "gastos"},
            "gastos": {c: round(m["gastos"].get(c, 0.0), 2) for c in categorias},
            "margenBruto": round(margen, 2),
            "resultado": round(resultado, 2),
            "margenBrutoPct": round(margen / m["ventaNeta"], 4) if m["ventaNeta"] else None,
            "resultadoPct": round(resultado / m["ventaNeta"], 4) if m["ventaNeta"] else None,
        }

    filas = [{"mes": k, **cerrar(v)} for k, v in sorted(meses.items())]
    total = {"ventaBruta": 0.0, "devoluciones": 0.0, "ventaNeta": 0.0, "costo": 0.0, "ventaSinCosto": 0.0,
             "gastos": defaultdict(float), "totalGastos": 0.0}
    for v in meses.values():
        for k in ("ventaBruta", "devoluciones", "ventaNeta", "costo", "ventaSinCosto", "totalGastos"):
            total[k] += v[k]
        for c, x in v["gastos"].items():
            total["gastos"][c] += x
    return {"empresas": empresas, "desde": desde, "hasta": hasta, "categorias": categorias, "meses": filas,
            "total": cerrar(total)}

