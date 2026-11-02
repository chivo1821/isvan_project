"""Activacion del mes con la MAESTRA como cartera (tablero del censo).

Es la misma idea que la activacion de Indicadores de venta
(indicadores_venta.activacion), pero la cartera no sale de los clientes del
sistema de ventas sino de la maestra vigente de logistica, sin la ruta 77:
los clientes que los vendedores tienen que atender. Por cada uno se cruza:

- las ventas cargadas (solo cargas confirmadas y no reemplazadas): si compro
  en el mes, su ultima compra y cuanto compro este mes y el anterior. Los
  grupos (atendidos, sin compra hace 2-4 semanas...) salen de aca, como en
  ventas;
- las visitas de los vendedores en el mes: cuantas, la ultima y quien.

Los codigos se cruzan sin ceros a la izquierda: la maestra trae 324 y ventas
"000324" (ver maestra_import.codigo_normalizado)."""

from __future__ import annotations

import calendar
from collections import defaultdict
from datetime import date

from app.core.fechas import dias_caracas_en_utc, hoy_caracas
from app.schemas import en_utc
from app.services import censo_tablero as ct
from app.services import indicadores_venta as iv
from app.services.maestra_import import codigo_normalizado


def _ventas(cur, empresa: str, desde: date, hasta: date, ant_desde: date, ant_hasta: date) -> dict[str, dict]:
    """Por codigo normalizado: ultima compra hasta `hasta`, venta del mes y
    del mes anterior. Un mismo cliente puede venir con y sin ceros: se suman."""
    condicion, params = iv.where(iv.Filtros(empresa, date(1900, 1, 1), hasta))
    params.update(desde_mes=desde, ant_desde=ant_desde, ant_hasta=ant_hasta)
    cur.execute(
        f"""
        SELECT v."codigoCliente" AS "codigo", MAX(v."fecha") AS "ultimaCompra",
               COALESCE(SUM(v."montoUsd") FILTER (WHERE v."fecha" >= %(desde_mes)s), 0) AS "ventaPeriodo",
               COALESCE(SUM(v."montoUsd") FILTER (
                   WHERE v."fecha" BETWEEN %(ant_desde)s AND %(ant_hasta)s), 0) AS "ventaAnterior"
        {iv.FUENTE_VIGENTE} {condicion}
        GROUP BY v."codigoCliente"
        """,
        params,
    )
    por_codigo: dict[str, dict] = {}
    for f in cur.fetchall():
        codigo = codigo_normalizado(f["codigo"])
        previo = por_codigo.get(codigo)
        if previo is None:
            por_codigo[codigo] = {
                "ultimaCompra": f["ultimaCompra"],
                "ventaPeriodo": float(f["ventaPeriodo"]),
                "ventaAnterior": float(f["ventaAnterior"]),
            }
        else:
            previo["ultimaCompra"] = max(previo["ultimaCompra"], f["ultimaCompra"])
            previo["ventaPeriodo"] += float(f["ventaPeriodo"])
            previo["ventaAnterior"] += float(f["ventaAnterior"])
    return por_codigo


def _visitas(cur, empresa: str, desde: date, hasta: date) -> dict[str, dict]:
    """Por codigo normalizado: visitas del mes (dias de Caracas), la ultima y
    quien la hizo."""
    inicio, fin = dias_caracas_en_utc(desde, hasta)
    cur.execute(
        'SELECT v."codigoCliente", v."llegadaEn", u."nombre" AS "vendedor" FROM "Visita" v '
        'JOIN "Usuario" u ON u."id" = v."vendedorId" '
        'WHERE v."empresa"::text = %s AND v."llegadaEn" >= %s AND v."llegadaEn" < %s ORDER BY v."llegadaEn"',
        (empresa, inicio, fin),
    )
    por_codigo: dict[str, dict] = {}
    for f in cur.fetchall():
        codigo = codigo_normalizado(f["codigoCliente"])
        anterior = por_codigo.get(codigo, {"visitas": 0})
        # Ordenadas por llegada: la ultima que pasa es la mas reciente.
        por_codigo[codigo] = {
            "visitas": anterior["visitas"] + 1,
            "ultimaVisita": en_utc(f["llegadaEn"]),
            "visitadoPor": f["vendedor"],
        }
    return por_codigo


def _vendedores_por_ruta(cur, empresa: str) -> dict[str, list[str]]:
    """Ruta comparable -> nombres de los vendedores activos que la tienen."""
    cur.execute(
        'SELECT vr."ruta", u."nombre" FROM "VendedorRuta" vr JOIN "Usuario" u ON u."id" = vr."usuarioId" '
        'WHERE vr."empresa"::text = %s AND u."activo" ORDER BY u."nombre"',
        (empresa,),
    )
    por_ruta: dict[str, list[str]] = defaultdict(list)
    for f in cur.fetchall():
        por_ruta[iv.ruta_comparable(f["ruta"])].append(f["nombre"])
    return por_ruta


def activacion(cur, empresa: str, mes: date, rutas: list[str] | None = None) -> dict:
    """La activacion de `empresa` en el mes de `mes` (cualquier dia del mes).
    `rutas` filtra la cartera (se comparan como en el resto del censo: "R4",
    "4" y "Ruta 4" son la misma)."""
    desde = mes.replace(day=1)
    hasta = mes.replace(day=calendar.monthrange(mes.year, mes.month)[1])
    ant_desde, ant_hasta, _ = iv.periodo_anterior(desde, hasta)
    # Dias sin compra hasta el fin del mes o hasta hoy, lo que llegue antes
    # (igual que en ventas: el mes en curso todavia no termino).
    corte = min(hasta, hoy_caracas())

    filtro = {iv.ruta_comparable(r) for r in rutas or []}
    cartera = [
        c for c in ct._maestra(cur, (empresa,)).get(empresa, []) if not filtro or c["rutaNumero"] in filtro
    ]
    ventas = _ventas(cur, empresa, desde, hasta, ant_desde, ant_hasta)
    visitas = _visitas(cur, empresa, desde, hasta)
    vendedores = _vendedores_por_ruta(cur, empresa)

    atendidos: list[dict] = []
    por_grupo: dict[str, list[dict]] = {clave: [] for clave, *_ in iv.GRUPOS_INACTIVIDAD}
    sin_compras: list[dict] = []
    visitados = visitados_sin_compra = ni_compra_ni_visita = 0
    for c in cartera:
        codigo = codigo_normalizado(c["codigo"])
        venta = ventas.get(codigo)
        visita = visitas.get(codigo)
        ultima = venta["ultimaCompra"] if venta else None
        cliente = {
            "codigo": codigo,
            "nombre": c["razonSocial"],
            "ruta": c["ruta"],
            "vendedores": vendedores.get(c["rutaNumero"], []),
            "ultimaCompra": ultima,
            # max(0): una venta fechada despues de hoy no da dias negativos.
            "diasSinCompra": max((corte - ultima).days, 0) if ultima else None,
            "ventaPeriodo": venta["ventaPeriodo"] if venta else 0.0,
            "ventaAnterior": venta["ventaAnterior"] if venta else 0.0,
            "visitas": visita["visitas"] if visita else 0,
            "ultimaVisita": visita["ultimaVisita"] if visita else None,
            "visitadoPor": visita["visitadoPor"] if visita else None,
        }
        compro = ultima is not None and ultima >= desde
        if visita:
            visitados += 1
            if not compro:
                visitados_sin_compra += 1
        elif not compro:
            ni_compra_ni_visita += 1

        if ultima is None:
            sin_compras.append(cliente)
        elif compro:
            atendidos.append(cliente)
        else:
            por_grupo[iv.grupo_de_inactividad(cliente["diasSinCompra"])].append(cliente)

    atendidos.sort(key=lambda c: (-c["ventaPeriodo"], c["nombre"]))
    listas = [{"clave": "atendidos", "etiqueta": "Atendidos", "clientes": atendidos}]
    for clave, etiqueta, *_ in iv.GRUPOS_INACTIVIDAD:
        # Primero los que mas compraban el mes anterior: los que mas conviene recuperar.
        clientes = sorted(por_grupo[clave], key=lambda c: (-c["ventaAnterior"], c["diasSinCompra"], c["nombre"]))
        listas.append({"clave": clave, "etiqueta": f"Sin compra hace {etiqueta}", "clientes": clientes})
    listas.append(
        {
            "clave": "sinCompras",
            "etiqueta": "Sin compras registradas",
            "clientes": sorted(sin_compras, key=lambda c: c["nombre"]),
        }
    )

    cur.execute(
        f'SELECT MAX(v."fecha") AS "ultima" {iv.FUENTE_VIGENTE} '
        'WHERE v."empresa" = %s AND v."reemplazadaPorCargaId" IS NULL',
        (empresa,),
    )
    total = len(cartera)
    return {
        "empresa": empresa,
        "desde": desde,
        "hasta": hasta,
        "ultimaVentaCargada": cur.fetchone()["ultima"],
        "cartera": total,
        "compraron": len(atendidos),
        "visitados": visitados,
        "visitadosSinCompra": visitados_sin_compra,
        "niCompraNiVisita": ni_compra_ni_visita,
        "pctActivacion": iv._div(len(atendidos), total),
        "listas": [{**lista, "total": len(lista["clientes"])} for lista in listas],
    }
