"""Definicion unica de los indicadores de venta.

Cada indicador del modulo sale de aca y de ningun otro lado: los endpoints
(app/api/indicadores.py) solo eligen el periodo, los filtros y por que se
agrupa. Las definiciones son las que pidio el cliente
(CONTEXTO_MODULO_INDICADORES.md) y reproducen al centavo las cifras de
control de su archivo de junio-agosto 2026.

Todo en USD: los bolivares quedan solo como referencia.
"""

from __future__ import annotations

import calendar
import re
from dataclasses import dataclass, field, replace
from datetime import date, timedelta

# ---------- Filtros ----------


@dataclass
class Filtros:
    """Los filtros del modulo: periodo, ruta, grupo de producto, tipo de
    cliente, cliente, producto (SKU) y tipo de documento. Listas vacias =
    sin filtrar."""

    empresa: str
    desde: date
    hasta: date
    rutas: list[str] = field(default_factory=list)
    grupos: list[str] = field(default_factory=list)
    tipos_cliente: list[str] = field(default_factory=list)
    clientes: list[str] = field(default_factory=list)
    productos: list[int] = field(default_factory=list)
    tipos_documento: list[str] = field(default_factory=list)


# Solo cuentan las filas de cargas CONFIRMADAS que ninguna carga posterior
# reemplazo (ver app/api/indicadores.py: el archivo nuevo manda en su
# periodo). Ruta y tipo de cliente salen del cliente segun ventas; grupo y
# costo, del producto.
FUENTE = """
    FROM "Venta" v
    JOIN "VentaCarga" c ON c."id" = v."cargaId" AND c."estado" = 'CONFIRMADA'
    LEFT JOIN "VentaCliente" vc ON vc."empresa" = v."empresa" AND vc."codigo" = v."codigoCliente"
    LEFT JOIN "VentaProducto" vp ON vp."empresa" = v."empresa" AND vp."codigo" = v."codigoProducto"
"""


# Solo las filas de cargas confirmadas, sin los cruces con cliente y producto:
# para contar dias y filas no hacen falta.
FUENTE_VIGENTE = """
    FROM "Venta" v
    JOIN "VentaCarga" c ON c."id" = v."cargaId" AND c."estado" = 'CONFIRMADA'
"""

def where(f: Filtros) -> tuple[str, dict]:
    condiciones = [
        'v."empresa" = %(empresa)s',
        'v."reemplazadaPorCargaId" IS NULL',
        'v."fecha" BETWEEN %(desde)s AND %(hasta)s',
    ]
    params: dict = {"empresa": f.empresa, "desde": f.desde, "hasta": f.hasta}
    if f.rutas:
        condiciones.append('vc."ruta" = ANY(%(rutas)s)')
        params["rutas"] = f.rutas
    if f.grupos:
        condiciones.append('vp."grupo" = ANY(%(grupos)s)')
        params["grupos"] = f.grupos
    if f.tipos_cliente:
        condiciones.append('vc."tipo" = ANY(%(tipos)s)')
        params["tipos"] = f.tipos_cliente
    if f.clientes:
        condiciones.append('v."codigoCliente" = ANY(%(clientes)s)')
        params["clientes"] = f.clientes
    if f.productos:
        condiciones.append('v."codigoProducto" = ANY(%(productos)s)')
        params["productos"] = f.productos
    if f.tipos_documento:
        condiciones.append('v."codTipoDoc" = ANY(%(tipos_documento)s)')
        params["tipos_documento"] = f.tipos_documento
    return "WHERE " + " AND ".join(condiciones), params


def orden_ruta(ruta: str):
    """R1..R8 primero y despues las numericas (10, 11, 77), cada grupo en
    orden natural — no "R1, R10, R2"."""
    digitos = "".join(c for c in ruta if c.isdigit())
    return (not ruta.startswith("R"), int(digitos) if digitos else 0, ruta)


# ---------- Indicadores ----------

# Sumas que se calculan en la base. COALESCE a 0: en un periodo con ventas
# pero sin devoluciones (o sin productos con costo) la suma vale 0, no NULL.
# Si el periodo no tiene ninguna fila, "filas" = 0 y el periodo entero es
# None (ver calcular).
_DOCUMENTO_DISTINTO = """COUNT(DISTINCT v."codTipoDoc" || '-' || v."numDoc")"""

SUMAS: dict[str, str] = {
    "filas": "COUNT(*)",
    "ventaNeta": 'COALESCE(SUM(v."montoUsd"), 0)',
    "ventaBruta": """COALESCE(SUM(v."montoUsd") FILTER (WHERE v."tipoMovimiento" = 'VENTA'), 0)""",
    # Las devoluciones vienen en negativo; el indicador se muestra en positivo.
    "devoluciones": """COALESCE(-SUM(v."montoUsd") FILTER (WHERE v."tipoMovimiento" = 'DEVOLUCION'), 0)""",
    "ventaNetaBs": 'COALESCE(SUM(v."montoBs"), 0)',
    "litros": 'COALESCE(SUM(v."litros"), 0)',
    "cajas": 'COALESCE(SUM(v."cajas"), 0)',
    "unidades": 'COALESCE(SUM(v."unidades"), 0)',
    # El costo es por CAJA, nunca por unidad. Las filas de productos sin
    # costo cargado no suman (SUM ignora el NULL) y se reportan aparte.
    "costo": 'COALESCE(SUM(v."cajas" * vp."costoCajaUsd"), 0)',
    # Indicador de calidad obligatorio: cuanta venta no tiene costo, es
    # decir, cuanto del margen es en realidad desconocido.
    "ventaSinCosto": 'COALESCE(SUM(v."montoUsd") FILTER (WHERE vp."costoCajaUsd" IS NULL), 0)',
    "clientes": 'COUNT(DISTINCT v."codigoCliente")',
    # Una cadena con varias sucursales tiene un codigo por sucursal y un
    # mismo nombre: por nombre se cuentan cadenas, por codigo tiendas.
    "cadenas": 'COUNT(DISTINCT vc."nombre")',
    # Un documento es tipo + numero: cada tipo lleva su propia numeracion y
    # la factura 100 y la nota de entrega 100 son documentos distintos (de
    # clientes distintos). Contar solo el numero los juntaba: en jun-ago eran
    # 1.590 numeros pero 2.676 documentos.
    "documentos": _DOCUMENTO_DISTINTO,
    "documentosVenta": f"{_DOCUMENTO_DISTINTO} FILTER (WHERE v.\"tipoMovimiento\" = 'VENTA')",
    "facturas": """COUNT(DISTINCT v."numDoc") FILTER (WHERE v."codTipoDoc" = 'FA')""",
    "notasEntrega": """COUNT(DISTINCT v."numDoc") FILTER (WHERE v."codTipoDoc" = 'NE')""",
    "documentosDevolucion": f"{_DOCUMENTO_DISTINTO} FILTER (WHERE v.\"tipoMovimiento\" = 'DEVOLUCION')",
}
SELECT_SUMAS = ", ".join(f'{expr} AS "{nombre}"' for nombre, expr in SUMAS.items())

# Indicadores que son un porcentaje (fraccion 0..1): su variacion entre
# periodos se expresa en puntos, no en % de cambio.
PORCENTAJES = {"pctDevolucion", "margenPct"}


def _div(numerador: float | None, denominador: float | None) -> float | None:
    if numerador is None or not denominador:
        return None
    return numerador / denominador


def completar(fila: dict) -> dict:
    """De las sumas de la base a los indicadores del modulo."""
    r = {k: float(fila[k]) for k in SUMAS if k != "filas"}
    r["filas"] = int(fila["filas"])
    r["pctDevolucion"] = _div(r["devoluciones"], r["ventaBruta"])
    r["precioLitro"] = _div(r["ventaNeta"], r["litros"])
    # Margen tal como lo define el documento: neta - costo, sobre la venta
    # neta TOTAL (incluida la que no tiene costo). Por eso la pantalla lo
    # muestra siempre junto a "venta sin costo".
    r["margen"] = r["ventaNeta"] - r["costo"]
    r["margenPct"] = _div(r["margen"], r["ventaNeta"])
    # Venta por documento de venta (facturas y notas de entrega): una
    # devolucion no es una compra y no debe bajar el promedio.
    r["ticketPromedio"] = _div(r["ventaNeta"], r["documentosVenta"])
    return r


def calcular(cur, f: Filtros) -> dict | None:
    """Indicadores del periodo, o None si no hay ninguna venta en el."""
    condicion, params = where(f)
    cur.execute(f"SELECT {SELECT_SUMAS} {FUENTE} {condicion}", params)
    fila = cur.fetchone()
    return completar(fila) if fila and fila["filas"] else None


def variacion(actual: dict, anterior: dict | None) -> dict:
    """Cambio contra el periodo anterior. None (nunca 0) cuando no hay con
    que comparar: un 0 diria "no cambio" y seria mentira."""
    resultado: dict[str, float | None] = {}
    for clave, valor in actual.items():
        previo = anterior.get(clave) if anterior else None
        if valor is None or previo is None:
            resultado[clave] = None
        elif clave in PORCENTAJES:
            resultado[clave] = valor - previo
        else:
            resultado[clave] = (valor - previo) / abs(previo) if previo else None
    return resultado


# ---------- Periodos ----------


def _fin_de_mes(d: date) -> date:
    return d.replace(day=calendar.monthrange(d.year, d.month)[1])


def _primero_del_mes(d: date, desplazamiento: int = 0) -> date:
    anio, mes = divmod(d.month - 1 + desplazamiento, 12)
    return date(d.year + anio, mes + 1, 1)


def periodo_anterior(desde: date, hasta: date) -> tuple[date, date, str]:
    """Con que se compara un periodo.

    - Meses completos: los mismos meses justo antes (julio contra junio,
      aunque uno tenga 31 dias y el otro 30).
    - Semanas ISO completas (lunes a domingo): las mismas semanas antes.
    - Cualquier otro rango: un rango de igual largo justo antes.
    """
    if desde.day == 1 and hasta == _fin_de_mes(hasta):
        meses = (hasta.year - desde.year) * 12 + hasta.month - desde.month + 1
        return _primero_del_mes(desde, -meses), desde - timedelta(days=1), "mes"
    dias = (hasta - desde).days + 1
    tipo = "semana" if desde.weekday() == 0 and hasta.weekday() == 6 else "periodo"
    return desde - timedelta(days=dias), desde - timedelta(days=1), tipo


def inicio_de_periodo(d: date, granularidad: str) -> date:
    # date_trunc('week') de Postgres tambien empieza en lunes (semana ISO).
    return d.replace(day=1) if granularidad == "mes" else d - timedelta(days=d.weekday())


def periodo_previo(inicio: date, granularidad: str) -> date:
    return _primero_del_mes(inicio, -1) if granularidad == "mes" else inicio - timedelta(days=7)


# Cuanto contexto muestra el grafico de evolucion. El periodo elegido se
# resalta dentro de una ventana mas larga para poder saltar a otro mes (o
# semana) con un clic; si la serie siguiera al filtro, con un solo mes
# elegido quedaria una sola barra y no habria nada que elegir.
PERIODOS_EN_LA_SERIE = {"mes": 12, "semana": 26}


def fecha_max_vigente(cur, empresa: str) -> date | None:
    """Ultimo dia con ventas que cuentan (cargas confirmadas, sin reemplazar)."""
    cur.execute(
        f'SELECT MAX(v."fecha") AS "hasta" {FUENTE} '
        'WHERE v."empresa" = %s AND v."reemplazadaPorCargaId" IS NULL',
        (empresa,),
    )
    return cur.fetchone()["hasta"]


def ventana_de_serie(desde: date, hasta: date, fecha_max: date | None, granularidad: str) -> tuple[date, date]:
    """Los ultimos PERIODOS_EN_LA_SERIE meses/semanas hasta el ultimo dia con
    ventas, estirada hacia atras si el periodo elegido es mas viejo: el
    periodo elegido siempre queda adentro."""
    fin = max(hasta, fecha_max) if fecha_max else hasta
    inicio = inicio_de_periodo(fin, granularidad)
    for _ in range(PERIODOS_EN_LA_SERIE[granularidad] - 1):
        inicio = periodo_previo(inicio, granularidad)
    return min(inicio, inicio_de_periodo(desde, granularidad)), fin


def serie(cur, f: Filtros, granularidad: str) -> list[dict]:
    """Indicadores por mes o por semana ISO dentro de la ventana de contexto
    (ver ventana_de_serie), con los filtros de ruta, grupo y tipo de cliente.
    Cada punto trae su variacion contra el anterior; se pide un periodo mas
    hacia atras para que el primero tambien tenga con que compararse."""
    unidad = "month" if granularidad == "mes" else "week"
    inicio, fin = ventana_de_serie(f.desde, f.hasta, fecha_max_vigente(cur, f.empresa), granularidad)
    condicion, params = where(replace(f, desde=periodo_previo(inicio, granularidad), hasta=fin))
    cur.execute(
        f'SELECT date_trunc(\'{unidad}\', v."fecha")::date AS "periodo", {SELECT_SUMAS} '
        f"{FUENTE} {condicion} GROUP BY 1 ORDER BY 1",
        params,
    )
    por_periodo = {fila["periodo"]: completar(fila) for fila in cur.fetchall()}
    return [
        {"periodo": periodo, **datos, "variacion": variacion(datos, por_periodo.get(periodo_previo(periodo, granularidad)))}
        for periodo, datos in por_periodo.items()
        if periodo >= inicio
    ]


# ---------- Desgloses ----------

# dimension -> (clave, nombre visible, dato de apoyo)
DIMENSIONES: dict[str, tuple[str, str, str | None]] = {
    "ruta": ('vc."ruta"', 'vc."ruta"', None),
    "grupo": ('vp."grupo"', 'vp."grupo"', None),
    "tipo_cliente": ('vc."tipo"', 'vc."tipo"', None),
    "producto": ('v."codigoProducto"::text', 'MAX(vp."nombre")', 'MAX(vp."grupo")'),
    "cliente": ('v."codigoCliente"', 'MAX(vc."nombre")', 'MAX(vc."ruta")'),
}
# Productos y clientes pueden ser cientos: se muestran los que mas venden.
LIMITE_POR_DIMENSION = {"producto": 50, "cliente": 50}


def desglose(cur, f: Filtros, dimension: str) -> tuple[list[dict], int]:
    """Los mismos indicadores, uno por ruta / grupo / tipo / producto /
    cliente. Devuelve las filas (ordenadas por venta neta) y cuantos grupos
    hay en total, para poder decir "top 50 de 527"."""
    clave, nombre, detalle = DIMENSIONES[dimension]
    nombre_sql = nombre if nombre.startswith("MAX(") else f"MAX({nombre})"
    detalle_sql = detalle or "NULL"
    limite = LIMITE_POR_DIMENSION.get(dimension)
    condicion, params = where(f)
    cur.execute(
        f'SELECT {clave} AS "clave", {nombre_sql} AS "nombre", {detalle_sql} AS "detalle", '
        f'COUNT(*) OVER () AS "totalGrupos", {SELECT_SUMAS} '
        f'{FUENTE} {condicion} GROUP BY {clave} ORDER BY "ventaNeta" DESC'
        + (f" LIMIT {int(limite)}" if limite else ""),
        params,
    )
    filas = cur.fetchall()
    total = int(filas[0]["totalGrupos"]) if filas else 0
    return (
        [
            {"clave": fila["clave"] or "(sin dato)", "nombre": fila["nombre"] or "(sin dato)", "detalle": fila["detalle"], **completar(fila)}
            for fila in filas
        ],
        total,
    )


# ---------- Alertas de calidad ----------

# Un producto cuyo margen se aleja tanto del de su grupo casi siempre tiene
# el costo mal cargado (el caso real: TIO RICO TRISABOR 1X2L a 81% en un
# grupo que ronda el 40%). Por debajo de esa venta no vale la pena alertar.
DESVIO_MARGEN_ALERTA = 0.20
VENTA_MINIMA_PARA_ALERTA_USD = 100.0


def desvios_de_margen(productos: list[dict]) -> list[dict]:
    """productos: [{codigo, nombre, grupo, ventaNeta, costo, tieneCosto}].
    Compara el margen % de cada producto con costo contra el de su grupo
    (ponderado por venta, solo productos con costo)."""
    por_grupo: dict[str, list[dict]] = {}
    for p in productos:
        if p["tieneCosto"] and p["ventaNeta"] > 0:
            por_grupo.setdefault(p["grupo"], []).append(p)

    desvios = []
    for grupo, lista in por_grupo.items():
        if len(lista) < 2:
            continue  # sin otros productos no hay contra que comparar
        neta = sum(p["ventaNeta"] for p in lista)
        margen_grupo = (neta - sum(p["costo"] for p in lista)) / neta
        for p in lista:
            if p["ventaNeta"] < VENTA_MINIMA_PARA_ALERTA_USD:
                continue
            margen = (p["ventaNeta"] - p["costo"]) / p["ventaNeta"]
            if abs(margen - margen_grupo) >= DESVIO_MARGEN_ALERTA:
                desvios.append({
                    "codigo": str(p["codigo"]),
                    "nombre": p["nombre"],
                    "grupo": grupo,
                    "ventaNeta": p["ventaNeta"],
                    "margenPct": margen,
                    "margenGrupoPct": margen_grupo,
                })
    return sorted(desvios, key=lambda d: -abs(d["margenPct"] - d["margenGrupoPct"]))


def _nombre_comparable(nombre: str) -> str:
    return " ".join(nombre.upper().split())


def productos_duplicados(productos: dict) -> list[dict]:
    """productos: {codigo: nombre}. El mismo producto con dos codigos
    (MAGNUM ALMENDRAS 18X90ML: 65646885 y 68539142) parte en dos su venta
    en los desgloses."""
    por_nombre: dict[str, list[str]] = {}
    for codigo, nombre in productos.items():
        por_nombre.setdefault(_nombre_comparable(nombre), []).append(str(codigo))
    return [
        {"nombre": nombre, "codigos": sorted(codigos)}
        for nombre, codigos in sorted(por_nombre.items())
        if len(codigos) > 1
    ]


def productos_del_periodo(cur, f: Filtros) -> list[dict]:
    condicion, params = where(f)
    cur.execute(
        'SELECT v."codigoProducto" AS "codigo", MAX(vp."nombre") AS "nombre", MAX(vp."grupo") AS "grupo", '
        'BOOL_OR(vp."costoCajaUsd" IS NOT NULL) AS "tieneCosto", '
        'COALESCE(SUM(v."montoUsd"), 0) AS "ventaNeta", '
        'COALESCE(SUM(v."cajas" * vp."costoCajaUsd"), 0) AS "costo" '
        f'{FUENTE} {condicion} GROUP BY v."codigoProducto"',
        params,
    )
    return [
        {**p, "codigo": str(p["codigo"]), "ventaNeta": float(p["ventaNeta"]), "costo": float(p["costo"])}
        for p in cur.fetchall()
    ]


# ---------- Opciones de los filtros ----------

# Filtro -> (valor que muestra la lista, campo de Filtros que lo filtra).
_OPCIONES_FILTRO: dict[str, tuple[str, str]] = {
    "rutas": ('vc."ruta"', "rutas"),
    "grupos": ('vp."grupo"', "grupos"),
    "tiposCliente": ('vc."tipo"', "tipos_cliente"),
    "clientes": ('v."codigoCliente"', "clientes"),
    "productos": ('v."codigoProducto"::text', "productos"),
    "tiposDocumento": ('v."codTipoDoc"', "tipos_documento"),
}


def opciones_disponibles(cur, f: Filtros) -> dict[str, list[str]]:
    """Para cada filtro, los valores que tienen ventas en el periodo con los
    DEMAS filtros aplicados (el propio no: si no, al elegir R3 la lista de
    rutas quedaria solo con R3 y no se podria sumar otra). Con la ruta R3
    elegida, la lista de productos trae solo los que se vendieron en R3."""
    disponibles: dict[str, list[str]] = {}
    for clave, (valor, campo) in _OPCIONES_FILTRO.items():
        condicion, params = where(replace(f, **{campo: []}))
        cur.execute(f'SELECT DISTINCT {valor} AS "valor" {FUENTE} {condicion}', params)
        disponibles[clave] = sorted(str(r["valor"]) for r in cur.fetchall() if r["valor"] is not None)
    return disponibles


# ---------- Activacion de clientes ----------
#
# La cartera son los clientes del sistema de ventas que ya habian comprado
# alguna vez al cierre del periodo (un cliente cuya primera compra es
# posterior todavia no era cliente). Sobre ella se aplican los filtros que
# son del cliente: ruta, tipo de cliente y cliente.
#
# Un cliente esta atendido si tuvo movimiento en el periodo con TODOS los
# filtros: con un grupo o un producto elegido, la activacion es "por marca".
# Asi el numero de atendidos es exactamente el de "Clientes atendidos".
#
# A los no atendidos se los agrupa por el tiempo desde su ultima compra
# (con los mismos filtros), contado hasta el ultimo dia del periodo.

# (clave, etiqueta, dias minimos sin comprar, dias maximos o None)
GRUPOS_INACTIVIDAD: list[tuple[str, str, int, int | None]] = [
    ("menos2", "menos de 2 semanas", 0, 13),
    ("de2a4", "2 a 4 semanas", 14, 27),
    ("de4a8", "4 a 8 semanas", 28, 55),
    ("mas8", "más de 8 semanas", 56, None),
]
_DESDE_SIEMPRE = date(1900, 1, 1)


def _grupo_de_inactividad(dias: int) -> str:
    return next(
        clave
        for clave, _, minimo, maximo in GRUPOS_INACTIVIDAD
        if dias >= minimo and (maximo is None or dias <= maximo)
    )


def activacion(cur, f: Filtros) -> dict:
    desde_ant, hasta_ant, _ = periodo_anterior(f.desde, f.hasta)
    condicion, params = where(replace(f, desde=_DESDE_SIEMPRE))
    params.update(periodo_desde=f.desde, periodo_hasta=f.hasta, ant_desde=desde_ant, ant_hasta=hasta_ant)

    cartera = ['vc."empresa" = %(empresa)s']
    if f.rutas:
        cartera.append('vc."ruta" = ANY(%(rutas)s)')
    if f.tipos_cliente:
        cartera.append('vc."tipo" = ANY(%(tipos)s)')
    if f.clientes:
        cartera.append('vc."codigo" = ANY(%(clientes)s)')

    en_periodo = 'v."fecha" BETWEEN %(periodo_desde)s AND %(periodo_hasta)s'
    cur.execute(
        f"""
        WITH movimientos AS (
            SELECT v."codigoCliente" AS "codigo",
                   MAX(v."fecha") AS "ultimaCompra",
                   COALESCE(SUM(v."montoUsd") FILTER (WHERE {en_periodo}), 0) AS "ventaPeriodo",
                   COALESCE(SUM(v."montoUsd") FILTER (
                       WHERE v."fecha" BETWEEN %(ant_desde)s AND %(ant_hasta)s), 0) AS "ventaAnterior",
                   {_DOCUMENTO_DISTINTO} FILTER (WHERE {en_periodo}) AS "documentos"
            {FUENTE} {condicion}
            GROUP BY v."codigoCliente"
        )
        SELECT vc."codigo", vc."nombre", vc."ruta", vc."tipo",
               m."ultimaCompra", m."ventaPeriodo", m."ventaAnterior", m."documentos"
        FROM "VentaCliente" vc
        LEFT JOIN movimientos m ON m."codigo" = vc."codigo"
        WHERE {" AND ".join(cartera)}
          AND EXISTS (
              SELECT 1 FROM "Venta" v2
              JOIN "VentaCarga" c2 ON c2."id" = v2."cargaId" AND c2."estado" = 'CONFIRMADA'
              WHERE v2."empresa" = vc."empresa" AND v2."codigoCliente" = vc."codigo"
                AND v2."reemplazadaPorCargaId" IS NULL AND v2."fecha" <= %(hasta)s
          )
        """,
        params,
    )

    atendidos: list[dict] = []
    por_grupo: dict[str, list[dict]] = {clave: [] for clave, *_ in GRUPOS_INACTIVIDAD}
    nunca: list[dict] = []
    for fila in cur.fetchall():
        ultima = fila["ultimaCompra"]
        cliente = {
            "codigo": fila["codigo"],
            "nombre": fila["nombre"],
            "ruta": fila["ruta"],
            "tipo": fila["tipo"],
            "ultimaCompra": ultima,
            "diasSinCompra": (f.hasta - ultima).days if ultima else None,
            "ventaPeriodo": float(fila["ventaPeriodo"] or 0),
            "ventaAnterior": float(fila["ventaAnterior"] or 0),
            "documentos": fila["documentos"] or 0,
        }
        if ultima is None:
            nunca.append(cliente)
        elif ultima >= f.desde:
            atendidos.append(cliente)
        else:
            por_grupo[_grupo_de_inactividad(cliente["diasSinCompra"])].append(cliente)

    atendidos.sort(key=lambda c: (-c["ventaPeriodo"], c["nombre"]))
    listas = [{"clave": "atendidos", "etiqueta": "Atendidos", "clientes": atendidos}]
    for clave, etiqueta, *_ in GRUPOS_INACTIVIDAD:
        # Primero los que mas compraban en el periodo anterior: son los que
        # mas conviene recuperar.
        clientes = sorted(por_grupo[clave], key=lambda c: (-c["ventaAnterior"], c["diasSinCompra"], c["nombre"]))
        listas.append({"clave": clave, "etiqueta": f"Sin compra hace {etiqueta}", "clientes": clientes})
    if nunca:
        # Solo pasa con filtros de grupo, producto o documento: clientes de la
        # cartera que nunca compraron eso.
        listas.append(
            {
                "clave": "nunca",
                "etiqueta": "Nunca compraron con estos filtros",
                "clientes": sorted(nunca, key=lambda c: c["nombre"]),
            }
        )

    total = sum(len(lista["clientes"]) for lista in listas)
    return {
        "cartera": total,
        "atendidos": len(atendidos),
        "noAtendidos": total - len(atendidos),
        "pctActivacion": _div(len(atendidos), total),
        "comparacion": {"desde": desde_ant, "hasta": hasta_ant},
        "listas": [{**lista, "total": len(lista["clientes"])} for lista in listas],
    }


# ---------- Cruce con logistica ----------


def ruta_comparable(ruta: str | None) -> str:
    """Solo el numero de la ruta: el sistema de ventas escribe "R3" y el
    maestro de clientes de logistica "Ruta 3" (tambien "R-03", "010")."""
    limpia = re.sub(r"[^A-Z0-9]", "", (ruta or "").upper())
    sin_prefijo = re.sub(r"^(RUTA|R)(?=[0-9])", "", limpia)
    return sin_prefijo.lstrip("0") or sin_prefijo
