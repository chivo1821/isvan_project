"""Tablero de cobranzas: la cartera de hoy y lo cobrado en un periodo,
contrastado con lo vendido (FA + NE - DV - DN del mismo extracto que usan los
indicadores de venta, asi que las cifras cuadran con ese tablero)."""

from __future__ import annotations

from collections import defaultdict
from datetime import date
from decimal import Decimal

from app.services import cartera

TRAMOS = [
    ("por_vencer", "Por vencer", None, 0),
    ("1_15", "1 a 15 días", 1, 15),
    ("16_30", "16 a 30 días", 16, 30),
    ("31_60", "31 a 60 días", 31, 60),
    ("mas_60", "Más de 60 días", 61, None),
]


def _tramo(dias_atraso: int) -> str:
    for clave, _, desde, hasta in TRAMOS:
        if desde is None:
            if dias_atraso <= 0:
                return clave
        elif dias_atraso >= desde and (hasta is None or dias_atraso <= hasta):
            return clave
    return "mas_60"


def _mes(fecha: date) -> date:
    return fecha.replace(day=1)


def tablero(cur, empresa: str | None, desde: date, hasta: date, ruta: str | None) -> dict:
    p = cartera.parametros(cur)
    estados = cartera.estados(cur, empresa=empresa, p=p)
    datos = cartera.datos_clientes(cur, empresa=empresa)

    def ruta_de(clave) -> str:
        return (datos.get(clave) or {}).get("ruta") or "Sin ruta"

    if ruta:
        estados = {k: v for k, v in estados.items() if ruta_de(k) == ruta}

    filtro_empresa = 'AND "empresa" = %(empresa)s' if empresa else ""
    params = {"empresa": empresa, "desde": desde, "hasta": hasta}
    # Lo vendido en el periodo, por cliente y mes (neto de devoluciones).
    cur.execute(
        'SELECT "empresa"::text AS "empresa", "codigoCliente", date_trunc(\'month\', "fecha")::date AS "mes", '
        'sum("montoUsd") AS "usd" FROM "DocumentoCobro" '
        f'WHERE "vigente" AND "fecha" BETWEEN %(desde)s AND %(hasta)s {filtro_empresa} GROUP BY 1, 2, 3',
        params,
    )
    vendido = cur.fetchall()
    cur.execute(
        'SELECT "empresa"::text AS "empresa", "codigoCliente", date_trunc(\'month\', "fechaPago")::date AS "mes", '
        'sum("montoUsd") AS "usd", count(*) AS "n" FROM "Pago" '
        f"WHERE \"estado\" = 'VERIFICADO' AND \"fechaPago\" BETWEEN %(desde)s AND %(hasta)s {filtro_empresa} "
        "GROUP BY 1, 2, 3",
        params,
    )
    cobrado = cur.fetchall()
    cur.execute(
        "SELECT count(*) AS \"n\", COALESCE(sum(\"montoUsd\"), 0) AS \"usd\" FROM \"Pago\" "
        f"WHERE \"estado\" = 'REPORTADO' {filtro_empresa}",
        params,
    )
    por_verificar = cur.fetchone()

    if ruta:
        vendido = [v for v in vendido if ruta_de((v["empresa"], v["codigoCliente"])) == ruta]
        cobrado = [c for c in cobrado if ruta_de((c["empresa"], c["codigoCliente"])) == ruta]

    # ---- KPIs de la cartera de hoy ----
    cartera_usd = sum((e.saldo_usd() for e in estados.values()), Decimal(0))
    vencido_usd = sum((e.vencido_usd(p.hoy) for e in estados.values()), Decimal(0))
    vendido_usd = sum((Decimal(v["usd"]) for v in vendido), Decimal(0))
    cobrado_usd = sum((Decimal(c["usd"]) for c in cobrado), Decimal(0))
    dias_periodo = (hasta - desde).days + 1
    # Dias de venta en la calle: cartera / venta diaria promedio del periodo.
    dias_cobro = float(cartera_usd / (vendido_usd / dias_periodo)) if vendido_usd > 0 else None

    # ---- Antiguedad de saldos ----
    tramos = {clave: {"clave": clave, "etiqueta": etiqueta, "usd": Decimal(0), "documentos": 0}
              for clave, etiqueta, _, _ in TRAMOS}
    for est in estados.values():
        for doc in est.pendientes():
            t = tramos[_tramo(doc.dias_atraso(p.hoy))]
            t["usd"] += doc.saldoUsd
            t["documentos"] += 1

    # ---- Serie mensual ----
    meses: dict[date, dict] = defaultdict(lambda: {"vendidoUsd": Decimal(0), "cobradoUsd": Decimal(0)})
    mes = _mes(desde)
    while mes <= hasta:
        meses[mes]
        mes = date(mes.year + (mes.month == 12), mes.month % 12 + 1, 1)
    for v in vendido:
        meses[v["mes"]]["vendidoUsd"] += Decimal(v["usd"])
    for c in cobrado:
        meses[c["mes"]]["cobradoUsd"] += Decimal(c["usd"])

    # ---- Por ruta ----
    rutas: dict[str, dict] = defaultdict(lambda: {
        "saldoUsd": Decimal(0), "vencidoUsd": Decimal(0), "vendidoUsd": Decimal(0), "cobradoUsd": Decimal(0),
        "clientes": 0, "bloqueados": 0,
    })
    for clave, est in estados.items():
        r = rutas[ruta_de(clave)]
        saldo = est.saldo_usd()
        r["saldoUsd"] += saldo
        r["vencidoUsd"] += est.vencido_usd(p.hoy)
        r["clientes"] += 1 if saldo > 0 else 0
        r["bloqueados"] += 1 if est.bloqueado(p) else 0
    for v in vendido:
        rutas[ruta_de((v["empresa"], v["codigoCliente"]))]["vendidoUsd"] += Decimal(v["usd"])
    for c in cobrado:
        rutas[ruta_de((c["empresa"], c["codigoCliente"]))]["cobradoUsd"] += Decimal(c["usd"])

    # ---- Deudores ----
    deudores = sorted(
        (
            {**est.resumen(p), "nombre": (datos.get(clave) or {}).get("nombre") or f"Cliente {clave[1]}",
             "ruta": ruta_de(clave)}
            for clave, est in estados.items() if est.vencido_usd(p.hoy) > 0
        ),
        key=lambda d: -d["vencidoUsd"],
    )[:15]

    con_saldo = [e for e in estados.values() if e.saldo_usd() > 0]
    compradores = {(v["empresa"], v["codigoCliente"]) for v in vendido}
    bloqueados = {k for k, e in estados.items() if e.bloqueado(p)}
    return {
        "parametros": {"inicioCartera": p.inicio, "diasTolerancia": p.tolerancia, "bloqueoActivo": p.bloqueo_activo,
                       "desde": desde, "hasta": hasta},
        "kpis": {
            "carteraUsd": float(cartera_usd),
            "vencidoUsd": float(vencido_usd),
            "pctVencido": float(vencido_usd / cartera_usd) if cartera_usd > 0 else 0.0,
            "clientesConSaldo": len(con_saldo),
            "clientesBloqueados": len(bloqueados),
            # Compraron en el periodo y hoy se les puede despachar.
            "clientesDisponibles": len(compradores - bloqueados),
            "vendidoUsd": float(vendido_usd),
            "cobradoUsd": float(cobrado_usd),
            "pctCobrado": float(cobrado_usd / vendido_usd) if vendido_usd > 0 else None,
            "pagosCobrados": sum(c["n"] for c in cobrado),
            "pagosPorVerificar": por_verificar["n"],
            "porVerificarUsd": float(por_verificar["usd"]),
            "diasCobro": round(dias_cobro, 1) if dias_cobro is not None else None,
        },
        "antiguedad": [{**t, "usd": float(t["usd"])} for t in tramos.values()],
        "serie": [
            {"mes": m, "vendidoUsd": float(v["vendidoUsd"]), "cobradoUsd": float(v["cobradoUsd"])}
            for m, v in sorted(meses.items())
        ],
        "rutas": sorted(
            ({"ruta": nombre, **{k: float(v) if isinstance(v, Decimal) else v for k, v in r.items()}}
             for nombre, r in rutas.items() if r["saldoUsd"] or r["vendidoUsd"] or r["cobradoUsd"]),
            key=lambda r: -r["vencidoUsd"],
        ),
        "deudores": deudores,
        "rutasDisponibles": sorted({d.get("ruta") or "Sin ruta" for d in datos.values()}),
    }
