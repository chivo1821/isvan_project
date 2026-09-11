"""Lectura del extracto de ventas (ISVAN / TRALOG) para el modulo de
indicadores.

Acepta los archivos tal como los arma el negocio, sin pedir una plantilla:

- El mensual: hoja "data" con el encabezado en la fila 1, mas la hoja
  "precio de compras" con el costo por caja (encabezado en la fila 10,
  debajo del membrete).
- El libro de cierre: la misma hoja "data" pero con totales encima del
  encabezado, y decenas de hojas de tablas dinamicas alrededor.
- El extracto diario: una sola hoja con los encabezados en minuscula
  ("num docum", "divisas", ...) y a veces el costo en una columna "pc".

Este modulo solo lee y normaliza. Lo que depende de la base (clientes
nuevos, solapes con otras cargas, costos ya cargados) lo resuelve
app/api/indicadores.py.
"""

from __future__ import annotations

import io
from collections import Counter
from dataclasses import dataclass
from datetime import date, datetime

import openpyxl
from fastapi import HTTPException

from app.core.excel_utils import mapear_columnas, normalizar_encabezado, valor_a_texto

# Los alias ya vienen normalizados (minusculas, sin acentos, espacios -> _).
# Cubren los tres formatos, incluidas las erratas reales de los archivos
# ("provedor", "tipo de cloente").
ALIAS_COLUMNAS: dict[str, list[str]] = {
    "ruta": ["ruta", "numero_ruta"],
    "codigo_cliente": ["cod_cte", "codigo_cliente", "cod_cliente"],
    "cliente": ["cliente", "nombre_cliente"],
    "codigo_producto": ["cod_producto", "codigo_producto"],
    "producto": ["producto", "nombre_producto"],
    "grupo": ["grupo"],
    "num_doc": ["num_doc", "num_docum", "numero_documento"],
    "fecha": ["fecha"],
    "cajas": ["cajas"],
    "unidades": ["und", "unidades"],
    "litros": ["litros"],
    "monto_bs": ["bolivares", "monto_bs"],
    "monto_usd": ["divisas", "monto_usd"],
    "tipo_doc": ["tp_doc", "tipo_de_documento", "cod_tipo_doc"],
    "tipo_cliente": ["tipo_de_cliente", "tipo_de_cloente", "tipo_cliente"],
    "lista_precio": ["precio", "lista_precio"],
    "proveedor": ["proveedor", "provedor", "codigo_proveedor"],
    "costo_caja": ["pc", "costo_caja_usd"],
}
CAMPOS_REQUERIDOS = [
    "ruta", "codigo_cliente", "cliente", "codigo_producto", "producto", "grupo",
    "num_doc", "fecha", "cajas", "unidades", "litros", "monto_bs", "monto_usd",
    "tipo_doc", "tipo_cliente",
]

# FA (factura) y NE (nota de entrega) son ventas; DV y DN, devoluciones con
# montos negativos. Cualquier otro codigo es un dato que no sabemos leer.
TIPO_MOVIMIENTO_POR_DOC = {"FA": "VENTA", "NE": "VENTA", "DV": "DEVOLUCION", "DN": "DEVOLUCION"}

# Hasta donde se busca la fila de encabezado: el libro de cierre trae
# totales arriba y la hoja de costos, un membrete de 9 filas.
FILAS_ANTES_DEL_ENCABEZADO = 15


@dataclass
class FilaVenta:
    fila: int
    fecha: date
    num_doc: str
    cod_tipo_doc: str
    tipo_movimiento: str
    codigo_cliente: str
    codigo_producto: int
    cajas: float
    unidades: int
    litros: float
    monto_bs: float
    monto_usd: float


@dataclass
class ExtractoVentas:
    hoja: str
    # Otras hojas del libro con el mismo formato que no se leyeron: si el
    # usuario esperaba que se sumaran, tiene que saberlo antes de confirmar.
    otras_hojas_con_formato: list[str]
    filas: list[FilaVenta]
    errores: list[dict]
    # codigo -> {nombre, tipo, ruta, listaPrecio}
    clientes: dict[str, dict]
    # codigo -> {nombre, grupo, codigoProveedor, unidadesPorCaja, litrosPorUnidad, costoCajaUsd}
    productos: dict[int, dict]
    # De donde salio el costo por caja (None: el archivo no lo trae).
    fuente_costo: str | None


def _texto(valor: object) -> str:
    """Quita los espacios de relleno: los nombres vienen completados con
    blancos hasta 120 caracteres y los encabezados con espacios al final."""
    return " ".join(str(valor).split()) if valor is not None else ""


def _a_numero(valor: object) -> float | None:
    if valor is None or (isinstance(valor, str) and not valor.strip()):
        return None
    if isinstance(valor, (int, float)):
        return float(valor)
    try:
        return float(str(valor).strip().replace(",", "."))
    except ValueError:
        return None


def _a_fecha(valor: object) -> date | None:
    # En el archivo mensual la fecha viene como TEXTO ("2026-06-12"); en
    # otros extractos, como fecha de Excel.
    if isinstance(valor, datetime):
        return valor.date()
    if isinstance(valor, date):
        return valor
    texto = _texto(valor)
    for formato in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y"):
        try:
            return datetime.strptime(texto[:10], formato).date()
        except ValueError:
            continue
    return None


def _codigo_producto(valor: object) -> int | None:
    try:
        return int(valor_a_texto(valor))
    except ValueError:
        return None


def _num_doc(valor: object) -> str:
    # "000001237" en el mensual, 1237 en el diario: sin ceros a la izquierda
    # los dos formatos quedan iguales (y como en Despacho.numeroDocumento).
    texto = valor_a_texto(valor)
    return texto.lstrip("0") or ("0" if texto else "")


def _es_encabezado_de_ventas(fila: tuple) -> bool:
    nombres = {normalizar_encabezado(v) for v in fila if v is not None}
    return "fecha" in nombres and bool(nombres & {"divisas", "monto_usd"})


def _buscar_encabezado(hoja, es_encabezado) -> tuple[int, tuple] | None:
    for i, fila in enumerate(hoja.iter_rows(values_only=True, max_row=FILAS_ANTES_DEL_ENCABEZADO)):
        if fila and es_encabezado(fila):
            return i, fila
    return None


def _hojas_por_prioridad(libro) -> list:
    """La hoja "data" primero (asi se llama en el mensual y en el cierre);
    despues el resto, en el orden del libro."""
    return sorted(libro.worksheets, key=lambda h: normalizar_encabezado(h.title) != "data")


def _leer_costos(libro, hoja_ventas) -> dict[int, float]:
    """Costo por CAJA desde la hoja "precio de compras" (columnas codigo y
    "Pc"). Vacio si el libro no la trae."""

    def es_encabezado(fila: tuple) -> bool:
        nombres = {normalizar_encabezado(v) for v in fila if v is not None}
        return "pc" in nombres and any(n.startswith("codigo") for n in nombres)

    candidatas = sorted(
        (h for h in libro.worksheets if h.title != hoja_ventas.title),
        key=lambda h: not normalizar_encabezado(h.title).startswith("precio_de_compra"),
    )
    for hoja in candidatas:
        encontrado = _buscar_encabezado(hoja, es_encabezado)
        if not encontrado:
            continue
        indice, encabezado = encontrado
        nombres = [normalizar_encabezado(v) for v in encabezado]
        col_codigo = next(i for i, n in enumerate(nombres) if n.startswith("codigo"))
        col_costo = nombres.index("pc")
        costos: dict[int, float] = {}
        for fila in hoja.iter_rows(values_only=True, min_row=indice + 2):
            if not fila or len(fila) <= max(col_codigo, col_costo):
                continue
            codigo = _codigo_producto(fila[col_codigo])
            costo = _a_numero(fila[col_costo])
            if codigo is not None and costo is not None and costo > 0:
                costos[codigo] = costo
        if costos:
            return costos
    return {}


def leer_extracto(contenido: bytes) -> ExtractoVentas:
    try:
        libro = openpyxl.load_workbook(io.BytesIO(contenido), read_only=True, data_only=True)
    except Exception:
        raise HTTPException(400, "No se pudo leer el archivo — verifica que sea un Excel (.xlsx) valido")

    try:
        return _leer_libro(libro)
    finally:
        libro.close()


def _leer_libro(libro) -> ExtractoVentas:
    hoja = None
    encabezado: tuple = ()
    indice_encabezado = 0
    otras: list[str] = []
    for candidata in _hojas_por_prioridad(libro):
        encontrado = _buscar_encabezado(candidata, _es_encabezado_de_ventas)
        if not encontrado:
            continue
        if hoja is None:
            hoja = candidata
            indice_encabezado, encabezado = encontrado
        else:
            otras.append(candidata.title)
    if hoja is None:
        raise HTTPException(
            400,
            "No se encontro la hoja de ventas: ninguna hoja tiene en sus primeras filas un "
            "encabezado con las columnas de fecha y divisas.",
        )

    mapa = mapear_columnas(encabezado, ALIAS_COLUMNAS, CAMPOS_REQUERIDOS)
    costos_hoja = _leer_costos(libro, hoja)

    filas: list[FilaVenta] = []
    errores: list[dict] = []
    clientes: dict[str, dict] = {}
    fecha_cliente: dict[str, date] = {}
    productos: dict[int, dict] = {}
    unidades_por_caja: dict[int, Counter] = {}
    litros_por_unidad: dict[int, Counter] = {}
    costo_columna: dict[int, float] = {}

    primera_fila_de_datos = indice_encabezado + 2  # 1-based, como la ve el usuario en Excel
    for n, fila in enumerate(hoja.iter_rows(values_only=True, min_row=primera_fila_de_datos), start=primera_fila_de_datos):
        if not fila or all(v is None or (isinstance(v, str) and not v.strip()) for v in fila):
            continue

        def val(campo: str):
            idx = mapa.get(campo)
            return fila[idx] if idx is not None and idx < len(fila) else None

        codigo_cliente = valor_a_texto(val("codigo_cliente"))
        codigo_producto = _codigo_producto(val("codigo_producto"))
        num_doc = _num_doc(val("num_doc"))
        fecha = _a_fecha(val("fecha"))
        cod_tipo_doc = _texto(val("tipo_doc")).upper()
        tipo_movimiento = TIPO_MOVIMIENTO_POR_DOC.get(cod_tipo_doc)
        monto_usd = _a_numero(val("monto_usd"))
        cajas = _a_numero(val("cajas"))
        unidades = _a_numero(val("unidades"))

        error: tuple[str, str] | None = None
        if not codigo_cliente:
            error = ("codigo cliente", "Falta el codigo de cliente")
        elif codigo_producto is None:
            error = ("codigo producto", f'Codigo de producto invalido "{_texto(val("codigo_producto"))}"')
        elif not num_doc:
            error = ("num doc", "Falta el numero de documento")
        elif fecha is None:
            error = ("fecha", f'Fecha invalida "{_texto(val("fecha"))}"')
        elif tipo_movimiento is None:
            error = ("tipo de documento", f'Tipo de documento desconocido "{cod_tipo_doc}" (se esperan FA, NE, DV o DN)')
        elif monto_usd is None:
            error = ("divisas", "Falta el monto en divisas")
        elif cajas is None or unidades is None:
            error = ("cajas/unidades", "Faltan las cajas o las unidades")
        if error:
            errores.append({"fila": n, "columna": error[0], "motivo": error[1]})
            continue

        litros = _a_numero(val("litros")) or 0.0
        filas.append(
            FilaVenta(
                fila=n,
                fecha=fecha,
                num_doc=num_doc,
                cod_tipo_doc=cod_tipo_doc,
                tipo_movimiento=tipo_movimiento,
                codigo_cliente=codigo_cliente,
                codigo_producto=codigo_producto,
                cajas=cajas,
                unidades=int(round(unidades)),
                litros=litros,
                monto_bs=_a_numero(val("monto_bs")) or 0.0,
                monto_usd=monto_usd,
            )
        )

        # El cliente queda con los datos de su fila mas reciente: si en el
        # periodo le cambiaron la ruta, manda la ultima.
        if codigo_cliente not in fecha_cliente or fecha >= fecha_cliente[codigo_cliente]:
            fecha_cliente[codigo_cliente] = fecha
            clientes[codigo_cliente] = {
                "nombre": _texto(val("cliente")),
                "tipo": _texto(val("tipo_cliente")).upper(),
                "ruta": _texto(val("ruta")).upper(),
                "listaPrecio": _texto(val("lista_precio")) or None,
            }

        productos.setdefault(
            codigo_producto,
            {
                "nombre": _texto(val("producto")),
                "grupo": _texto(val("grupo")).upper(),
                "codigoProveedor": valor_a_texto(val("proveedor")) or None,
            },
        )
        if cajas and unidades:
            unidades_por_caja.setdefault(codigo_producto, Counter())[round(abs(unidades / cajas))] += 1
        if unidades and litros:
            litros_por_unidad.setdefault(codigo_producto, Counter())[round(abs(litros / unidades), 4)] += 1
        costo = _a_numero(val("costo_caja"))
        if costo:
            costo_columna[codigo_producto] = costo

    if not filas and not errores:
        raise HTTPException(400, f'La hoja "{hoja.title}" no tiene filas de ventas')

    if costos_hoja:
        fuente_costo = 'hoja "precio de compras"'
        costos = costos_hoja
    elif costo_columna:
        fuente_costo = 'columna "pc"'
        costos = costo_columna
    else:
        fuente_costo = None
        costos = {}

    for codigo, producto in productos.items():
        producto["unidadesPorCaja"] = (
            unidades_por_caja[codigo].most_common(1)[0][0] if codigo in unidades_por_caja else None
        )
        producto["litrosPorUnidad"] = (
            litros_por_unidad[codigo].most_common(1)[0][0] if codigo in litros_por_unidad else None
        )
        producto["costoCajaUsd"] = costos.get(codigo)

    return ExtractoVentas(
        hoja=hoja.title,
        otras_hojas_con_formato=otras,
        filas=filas,
        errores=errores,
        clientes=clientes,
        productos=productos,
        fuente_costo=fuente_costo,
    )
