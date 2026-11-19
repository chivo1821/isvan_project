"""Costo historico por fila de venta: las piezas que comparten la API
(confirmar_carga, revertir_carga) y el backfill
(scripts/sellar_costos_historicos.py), para que los dos sigan exactamente
la misma regla.

Regla del sello (Venta.costoCajaUsd), en orden de prioridad:

1. Si el archivo de la carga trae costo para el producto, manda ese.
2. Si no lo trae y la fila reemplaza a otra del mismo dia y producto que ya
   estaba sellada, hereda ese sello: re-subir un mes cerrado (o el extracto
   diario que repite los dias anteriores) sin hoja de costos NO le cambia el
   costo a los dias que ya se habian vendido.
3. Si no, el costo vigente del producto al confirmar.
4. Si tampoco hay, queda NULL y se reporta como "venta sin costo".
"""

from __future__ import annotations


def eventos_de_costo(cur, empresa: str) -> list[dict]:
    """Cargas confirmadas y listas de precios de la empresa, en el orden en
    que entraron: la linea de tiempo del costo vigente.

    Cada evento trae {"cargaId", "datos", "esLista", "en"}: en una carga
    "datos" son sus dimensiones ({clientes, productos}); en una lista, la
    lista de productos. Si una carga y una lista tienen el mismo instante
    (en la practica no pasa: es un timestamp), va primero la carga y despues
    la lista, que queda como vigente.
    """
    cur.execute(
        'SELECT "id" AS "cargaId", "dimensiones" AS "datos", FALSE AS "esLista", "confirmadaEn" AS "en" '
        'FROM "VentaCarga" WHERE "empresa" = %(empresa)s AND "estado" = \'CONFIRMADA\' '
        'UNION ALL '
        'SELECT NULL, "productos", TRUE, "subidaEn" FROM "ListaPrecioCarga" WHERE "empresa" = %(empresa)s '
        'ORDER BY "en", "esLista"',
        {"empresa": empresa},
    )
    return cur.fetchall()


def costos_propios(productos: list[dict]) -> dict[int, float]:
    """codigo -> costo de los productos que traen costo en el archivo. Los
    que no lo traen no cuentan: un extracto sin hoja de costos no borra lo
    que ya se sabia (misma regla que _aplicar_dimensiones)."""
    return {int(p["codigo"]): float(p["costoCajaUsd"]) for p in productos if p.get("costoCajaUsd") is not None}


def heredar_sellos_reemplazados(cur, carga_id: str, con_costo_propio: list[int], solo_vacios: bool) -> None:
    """Paso 2 de la regla: las filas de la carga cuyo producto NO trae costo
    en el archivo toman el sello de la fila que reemplazaron (mismo dia y
    producto). Si por algun motivo hubiera varias reemplazadas con sellos
    distintos para el mismo dia y producto, se toma el mayor (conservador
    para el margen).

    solo_vacios=True no toca las filas que ya tienen sello (backfill)."""
    cur.execute(
        'UPDATE "Venta" v SET "costoCajaUsd" = r."costo" FROM ('
        '  SELECT o."fecha", o."codigoProducto", MAX(o."costoCajaUsd") AS "costo" FROM "Venta" o '
        '  WHERE o."reemplazadaPorCargaId" = %(id)s AND o."costoCajaUsd" IS NOT NULL '
        '  GROUP BY o."fecha", o."codigoProducto"'
        ') r '
        'WHERE v."cargaId" = %(id)s AND v."fecha" = r."fecha" AND v."codigoProducto" = r."codigoProducto" '
        '  AND NOT (v."codigoProducto" = ANY(%(propios)s::bigint[])) '
        + ('  AND v."costoCajaUsd" IS NULL' if solo_vacios else ''),
        {"id": carga_id, "propios": con_costo_propio},
    )
