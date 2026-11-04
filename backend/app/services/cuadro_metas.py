"""Cuadro de metas en litros: el que el cliente llevaba en Excel ("Ventas de
Ice Cream"), ahora calculado solo con las ventas cargadas. Cuenta todos los
litros vendidos, pizzas incluidas (decision del cliente; en las pizzas el
sistema de ventas pone sus kilos en esa misma columna).

Por ruta, en el mes:

- Tendencia = vendido / meta.
- Litros = meta - vendido (lo que falta; negativo si ya la paso).
- Necesidad = lo que falta / dias de venta restantes (litros por dia).
- Proyeccion = vendido / dias transcurridos * dias de venta del mes.
- Variacion = proyeccion / meta.

Dias de venta = lunes a viernes menos los feriados (DiaFeriado). Los
transcurridos se cuentan hasta la ULTIMA VENTA CARGADA, no hasta hoy: el
extracto se sube al dia siguiente, y contar hoy bajaria el ritmo de todas las
rutas sin que hayan vendido menos (asi lo hace tambien el cuadro del
cliente: al domingo 4/10 cuenta 2 dias, el 1 y el 2).

El semaforo compara la tendencia con el phasing (lo que ya deberia estar
vendido si se vendiera parejo): las flechas del Excel eran los iconos
automaticos, que comparan cada ruta con las demas y no con su meta.
"""

from __future__ import annotations

from datetime import date, timedelta

from app.services.indicadores_venta import FUENTE, _fin_de_mes, es_de_baja, fecha_max_vigente, orden_ruta

# Semaforo: verde al ritmo o mejor; amarillo desde este tanto del ritmo.
AMARILLO_DESDE = 0.8
# Con menos dias la proyeccion se infla o se hunde con un solo dia de venta.
DIAS_PROYECCION_CONFIABLE = 5
SIN_RUTA = "SIN RUTA"


def feriados_entre(cur, desde: date, hasta: date) -> list[dict]:
    cur.execute(
        'SELECT "fecha", "nombre" FROM "DiaFeriado" WHERE "fecha" BETWEEN %s AND %s ORDER BY "fecha"',
        (desde, hasta),
    )
    return cur.fetchall()


def dias_de_venta(desde: date, hasta: date, feriados: set[date]) -> int:
    """Lunes a viernes entre las dos fechas (incluidas), sin los feriados."""
    dias, dia = 0, desde
    while dia <= hasta:
        if dia.weekday() < 5 and dia not in feriados:
            dias += 1
        dia += timedelta(days=1)
    return dias


def _div(a: float | None, b: float | None) -> float | None:
    return a / b if a is not None and b else None


def _fila(ruta: str, litros: float, meta: float | None, total: int, transcurridos: int, phasing: float | None) -> dict:
    restantes = total - transcurridos
    faltante = meta - litros if meta is not None else None
    proyeccion = litros / transcurridos * total if transcurridos else None
    tendencia = _div(litros, meta)
    semaforo = None
    if tendencia is not None and phasing:
        ritmo = tendencia / phasing
        semaforo = "verde" if ritmo >= 1 else "amarillo" if ritmo >= AMARILLO_DESDE else "rojo"
    return {
        "ruta": ruta,
        "litros": round(litros, 2),
        "meta": meta,
        "tendencia": tendencia,
        "faltante": round(faltante, 2) if faltante is not None else None,
        "necesidad": round(faltante / restantes, 2) if faltante is not None and restantes > 0 else None,
        "proyeccion": round(proyeccion, 2) if proyeccion is not None else None,
        "variacion": _div(proyeccion, meta),
        "semaforo": semaforo,
    }


def cuadro(cur, empresa: str, mes: date) -> dict:
    inicio = mes.replace(day=1)
    fin = _fin_de_mes(inicio)
    feriados = feriados_entre(cur, inicio, fin)
    fechas_feriado = {f["fecha"] for f in feriados}
    total = dias_de_venta(inicio, fin, fechas_feriado)

    ultima_venta = fecha_max_vigente(cur, empresa)
    corte = min(ultima_venta, fin) if ultima_venta and ultima_venta >= inicio else None
    transcurridos = dias_de_venta(inicio, corte, fechas_feriado) if corte else 0
    phasing = _div(transcurridos, total)

    cur.execute(
        f"""
        SELECT COALESCE(vc."ruta", %(sin_ruta)s) AS "ruta", SUM(v."litros")::float AS "litros"
        {FUENTE}
        WHERE v."empresa" = %(empresa)s AND v."reemplazadaPorCargaId" IS NULL
          AND v."fecha" BETWEEN %(desde)s AND %(hasta)s
        GROUP BY 1
        """,
        {"empresa": empresa, "desde": inicio, "hasta": fin, "sin_ruta": SIN_RUTA},
    )
    # La ruta de baja (77) no entra en el cuadro, ni con sus litros ni con una
    # meta que le haya quedado de antes.
    litros = {fila["ruta"]: fila["litros"] for fila in cur.fetchall() if not es_de_baja(fila["ruta"])}
    cur.execute(
        'SELECT "ruta", "litros"::float AS "litros" FROM "MetaLitros" WHERE "empresa" = %s AND "mes" = %s',
        (empresa, inicio),
    )
    metas = {fila["ruta"]: fila["litros"] for fila in cur.fetchall() if not es_de_baja(fila["ruta"])}

    rutas = sorted(set(litros) | set(metas), key=orden_ruta)
    filas = [_fila(r, litros.get(r, 0.0), metas.get(r), total, transcurridos, phasing) for r in rutas]
    # El total compara contra la suma de las metas cargadas con los litros de
    # esas mismas rutas: una ruta sin meta suma sus litros a la columna, pero
    # no infla la tendencia ni la proyeccion de la empresa.
    meta_total = sum(metas.values()) if metas else None
    con_meta = sum(litros.get(r, 0.0) for r in metas)
    fila_total = _fila("Total", con_meta, meta_total, total, transcurridos, phasing)
    fila_total["litros"] = round(sum(litros.values()), 2)
    fila_total["litrosSinMeta"] = round(sum(litros.values()) - con_meta, 2)
    return {
        "empresa": empresa,
        "mes": inicio,
        "diasVenta": total,
        "diasTranscurridos": transcurridos,
        "diasRestantes": total - transcurridos,
        "phasing": phasing,
        "ventasHasta": corte,
        "ultimaVenta": ultima_venta,
        "proyeccionConfiable": transcurridos >= DIAS_PROYECCION_CONFIABLE,
        "feriados": feriados,
        "filas": filas,
        "total": fila_total,
    }
