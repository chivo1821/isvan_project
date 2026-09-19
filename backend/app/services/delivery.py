"""Pago a los motorizados por entrega, segun la distancia.

Todo el modulo sale de aca: los endpoints (app/api/delivery.py) solo eligen
el periodo y el motorizado. Las reglas las fijo el cliente:

- Se paga por PARADA, no por documento: un cliente con tres facturas en el
  mismo viaje se paga una vez.
- Solo paradas con marca de entrega, y solo en rutas de vehiculos MOTO.
- La distancia es la del ALMACEN AL CLIENTE (ida, por vialidad), no la del
  tramo recorrido: asi el pago no depende del orden del viaje ni de que el
  motorizado haya agrupado varias entregas. Se calcula una vez por cliente y
  queda guardada en DistanciaCliente.
- El monto sale del tabulador por rangos (TabuladorDelivery), editable desde
  la app. Al liquidar se congelan los km y el monto usados, para que un
  cambio posterior del tabulador no altere lo ya pagado.
"""

from __future__ import annotations

from datetime import date

from app.core.conductor import CONDUCTOR_DEL_VEHICULO, REPARTIDOR_DEL_VEHICULO
from app.services.route_analysis import LatLng, calcular_mejor_ruta

# Los km se guardan con un decimal: es la precision con la que el servicio de
# rutas devuelve la distancia y con la que se le explica el pago al
# motorizado.
DECIMALES_KM = 1


def tabulador(cur) -> list[dict]:
    cur.execute('SELECT "id", "orden", "hastaKm", "montoUsd" FROM "TabuladorDelivery" ORDER BY "orden"')
    return [{**t, "montoUsd": float(t["montoUsd"])} for t in cur.fetchall()]


def etiqueta_rango(tabla: list[dict], indice: int) -> str:
    """Como se le muestra el rango al usuario: "0 a 10 km", "10 a 16 km",
    "mas de 35 km"."""
    desde = tabla[indice - 1]["hastaKm"] if indice > 0 else 0
    hasta = tabla[indice]["hastaKm"]
    if hasta is None:
        return f"más de {_km(desde)} km"
    return f"{_km(desde)} a {_km(hasta)} km"


def _km(valor: float | None) -> str:
    if valor is None:
        return "—"
    return f"{valor:g}".replace(".", ",")


def monto_de(km: float | None, tabla: list[dict]) -> tuple[float | None, str | None]:
    """(monto, rango) para una distancia. El primer rango que la alcanza; el
    ultimo, sin tope, atrapa todo lo que quede por encima. Sin distancia
    todavia calculada no hay monto: el reporte lo muestra como pendiente."""
    if km is None or not tabla:
        return None, None
    for indice, rango in enumerate(tabla):
        if rango["hastaKm"] is None or km <= rango["hastaKm"]:
            return rango["montoUsd"], etiqueta_rango(tabla, indice)
    ultimo = len(tabla) - 1
    return tabla[ultimo]["montoUsd"], etiqueta_rango(tabla, ultimo)


def validar_tabulador(rangos: list[dict]) -> None:
    """Los topes tienen que subir y el ultimo no lleva tope: asi no quedan
    huecos ni distancias sin rango (el tabulador en papel del cliente tenia
    huecos entre 10-11, 16-17 y 20-20,1 km)."""
    from fastapi import HTTPException

    if not rangos:
        raise HTTPException(400, "El tabulador necesita al menos un rango")
    topes = [r["hastaKm"] for r in rangos]
    if topes[-1] is not None:
        raise HTTPException(400, "El último rango no lleva tope: es el que cubre las distancias más largas")
    if any(t is None for t in topes[:-1]):
        raise HTTPException(400, "Solo el último rango puede ir sin tope")
    if any(a >= b for a, b in zip(topes, topes[1:-1])):
        raise HTTPException(400, "Los topes tienen que ir de menor a mayor, sin repetirse")
    if any(t <= 0 for t in topes[:-1]):
        raise HTTPException(400, "Los topes tienen que ser mayores que cero")
    if any(r["montoUsd"] < 0 for r in rangos):
        raise HTTPException(400, "Los montos no pueden ser negativos")


# ---------- Distancia del almacen al cliente ----------


def distancia_guardada(cur, almacen_id: str, clientes: list[str]) -> dict[str, dict]:
    if not clientes:
        return {}
    cur.execute(
        'SELECT "clienteId", "km", "fuente" FROM "DistanciaCliente" '
        'WHERE "almacenId" = %s AND "clienteId" = ANY(%s)',
        (almacen_id, clientes),
    )
    return {d["clienteId"]: d for d in cur.fetchall()}


def calcular_y_guardar_distancias(cur, almacen: dict, clientes: list[dict]) -> dict[str, dict]:
    """Calcula la distancia de los clientes que todavia no la tienen y la
    guarda. Usa el mismo servicio de rutas que el resto de la app, que ya cae
    solo a la linea recta por un factor si el servicio no responde; por eso
    se guarda tambien de donde salio."""
    ids = [c["id"] for c in clientes]
    ya_guardadas = distancia_guardada(cur, almacen["id"], ids)
    faltantes = [c for c in clientes if c["id"] not in ya_guardadas]
    if not faltantes:
        return ya_guardadas
    origen = LatLng(lat=almacen["lat"], lng=almacen["lng"])
    for cliente in faltantes:
        if cliente["lat"] is None or cliente["lng"] is None:
            continue
        destino = LatLng(lat=cliente["lat"], lng=cliente["lng"])
        ruta = calcular_mejor_ruta(f"delivery-{cliente['id']}", origen, destino)
        fuente = ruta.fuente
        cur.execute(
            'INSERT INTO "DistanciaCliente" ("id", "almacenId", "clienteId", "km", "fuente") '
            "VALUES (%s, %s, %s, %s, %s) "
            'ON CONFLICT ("almacenId", "clienteId") DO NOTHING',
            (
                f"dist-{cliente['id'][-10:]}-{almacen['id'][-4:]}",
                almacen["id"],
                cliente["id"],
                round(ruta.distancia_km, DECIMALES_KM),
                fuente,
            ),
        )
    return distancia_guardada(cur, almacen["id"], ids)


def guardar_distancias_de_ruta(cur, ruta_id: str) -> None:
    """Se llama al crear una ruta de moto: deja las distancias listas para
    que el reporte de pagos no dependa del servicio de rutas."""
    cur.execute(
        'SELECT a."id", a."lat", a."lng" FROM "Ruta" r JOIN "Almacen" a ON a."id" = r."origenId" '
        'JOIN "Vehiculo" v ON v."id" = r."vehiculoId" '
        "WHERE r.\"id\" = %s AND v.\"tipo\" = 'MOTO'",
        (ruta_id,),
    )
    almacen = cur.fetchone()
    if not almacen:
        return
    cur.execute(
        'SELECT DISTINCT c."id", c."lat", c."lng" FROM "Despacho" d '
        'JOIN "Cliente" c ON c."id" = d."destinoClienteId" WHERE d."rutaId" = %s',
        (ruta_id,),
    )
    calcular_y_guardar_distancias(cur, almacen, cur.fetchall())


# ---------- Paradas que se pagan ----------

# Una fila por (ruta, cliente) con entrega marcada en una ruta de moto. La
# fecha del pago es la de la ultima entrega de esa parada, en hora de
# Venezuela.
_FECHA_ENTREGA = "(d.\"entregadoEn\" AT TIME ZONE 'America/Caracas')::date"

_PARADAS = f"""
    SELECT r."id" AS "rutaId", r."numero" AS "rutaNumero", r."origenId",
           cl."id" AS "clienteId", cl."codigo" AS "clienteCodigo", cl."nombre" AS "clienteNombre",
           cl."ciudad", cl."empresa",
           v."id" AS "vehiculoId", v."placa",
           {CONDUCTOR_DEL_VEHICULO} AS "conductor",
           {REPARTIDOR_DEL_VEHICULO} AS "repartidorId",
           MAX(d."entregadoEn") AS "entregadoEn",
           MAX({_FECHA_ENTREGA}) AS "fecha",
           COUNT(d."id") AS "despachos",
           STRING_AGG(d."numero", ', ' ORDER BY d."numero") AS "numeros",
           dc."km", dc."fuente",
           lp."id" AS "paradaLiquidadaId", lp."montoUsd" AS "montoLiquidado", lp."km" AS "kmLiquidado",
           lp."rango" AS "rangoLiquidado", liq."id" AS "liquidacionId", liq."creadoEn" AS "liquidadaEn"
    FROM "Despacho" d
    JOIN "Ruta" r ON r."id" = d."rutaId"
    JOIN "Vehiculo" v ON v."id" = r."vehiculoId" AND v."tipo" = 'MOTO'
    JOIN "Cliente" cl ON cl."id" = d."destinoClienteId"
    LEFT JOIN "DistanciaCliente" dc ON dc."almacenId" = r."origenId" AND dc."clienteId" = cl."id"
    LEFT JOIN "LiquidacionDeliveryParada" lp ON lp."rutaId" = r."id" AND lp."clienteId" = cl."id"
    LEFT JOIN "LiquidacionDelivery" liq ON liq."id" = lp."liquidacionId"
    WHERE d."entregadoEn" IS NOT NULL
      AND {_FECHA_ENTREGA} BETWEEN %(desde)s AND %(hasta)s
      AND r."estado" <> 'CANCELADA'
    GROUP BY r."id", r."numero", r."origenId", cl."id", v."id", v."placa", v."conductorNombre",
             dc."km", dc."fuente", lp."id", liq."id"
"""


def paradas_pagables(cur, desde: date, hasta: date, repartidor_id: str | None = None) -> list[dict]:
    """Las paradas del periodo con lo que se le paga a cada una. Las ya
    liquidadas conservan el km y el monto con los que se pagaron."""
    condicion = 'AND p."repartidorId" = %(repartidor)s' if repartidor_id else ""
    cur.execute(
        f'SELECT * FROM ({_PARADAS}) p WHERE true {condicion} '
        'ORDER BY p."fecha", p."rutaNumero", p."clienteNombre"',
        {"desde": desde, "hasta": hasta, "repartidor": repartidor_id},
    )
    filas = cur.fetchall()
    tabla = tabulador(cur)

    paradas = []
    for fila in filas:
        liquidada = fila["paradaLiquidadaId"] is not None
        if liquidada:
            km = fila["kmLiquidado"]
            monto, rango = float(fila["montoLiquidado"]), fila["rangoLiquidado"]
        else:
            km = fila["km"]
            monto, rango = monto_de(km, tabla)
        paradas.append(
            {
                "rutaId": fila["rutaId"],
                "rutaNumero": fila["rutaNumero"],
                "clienteId": fila["clienteId"],
                "clienteCodigo": fila["clienteCodigo"],
                "clienteNombre": fila["clienteNombre"],
                "ciudad": fila["ciudad"],
                "empresa": fila["empresa"],
                "vehiculoId": fila["vehiculoId"],
                "placa": fila["placa"],
                "conductor": fila["conductor"],
                "repartidorId": fila["repartidorId"],
                "fecha": fila["fecha"],
                "entregadoEn": fila["entregadoEn"],
                "despachos": fila["despachos"],
                "numeros": fila["numeros"],
                "km": km,
                "fuenteKm": fila["fuente"],
                "montoUsd": monto,
                "rango": rango,
                "liquidada": liquidada,
                "liquidacionId": fila["liquidacionId"],
                "liquidadaEn": fila["liquidadaEn"],
            }
        )
    return paradas


def resumen_por_motorizado(paradas: list[dict]) -> list[dict]:
    """Lo que hay que pagarle a cada motorizado en el periodo. Las paradas de
    una moto sin repartidor asignado quedan juntas bajo su placa, para que no
    se pierdan del reporte."""
    por_motorizado: dict[str, dict] = {}
    for parada in paradas:
        clave = parada["repartidorId"] or f'placa:{parada["placa"]}'
        fila = por_motorizado.setdefault(
            clave,
            {
                "repartidorId": parada["repartidorId"],
                "conductor": parada["conductor"],
                "placas": set(),
                "entregas": 0,
                "despachos": 0,
                "km": 0.0,
                "totalUsd": 0.0,
                "pendienteUsd": 0.0,
                "liquidadoUsd": 0.0,
                "sinDistancia": 0,
            },
        )
        fila["placas"].add(parada["placa"])
        fila["entregas"] += 1
        fila["despachos"] += parada["despachos"]
        fila["km"] += parada["km"] or 0
        if parada["montoUsd"] is None:
            fila["sinDistancia"] += 1
            continue
        fila["totalUsd"] += parada["montoUsd"]
        if parada["liquidada"]:
            fila["liquidadoUsd"] += parada["montoUsd"]
        else:
            fila["pendienteUsd"] += parada["montoUsd"]

    return sorted(
        (
            {
                **fila,
                "placas": sorted(fila["placas"]),
                "km": round(fila["km"], DECIMALES_KM),
                "totalUsd": round(fila["totalUsd"], 2),
                "pendienteUsd": round(fila["pendienteUsd"], 2),
                "liquidadoUsd": round(fila["liquidadoUsd"], 2),
            }
            for fila in por_motorizado.values()
        ),
        key=lambda f: -f["totalUsd"],
    )


def totales(paradas: list[dict]) -> dict:
    con_monto = [p for p in paradas if p["montoUsd"] is not None]
    total = sum(p["montoUsd"] for p in con_monto)
    return {
        "entregas": len(paradas),
        "despachos": sum(p["despachos"] for p in paradas),
        "km": round(sum(p["km"] or 0 for p in paradas), DECIMALES_KM),
        "totalUsd": round(total, 2),
        "pendienteUsd": round(sum(p["montoUsd"] for p in con_monto if not p["liquidada"]), 2),
        "liquidadoUsd": round(sum(p["montoUsd"] for p in con_monto if p["liquidada"]), 2),
        "promedioUsd": round(total / len(con_monto), 2) if con_monto else None,
        "sinDistancia": sum(1 for p in paradas if p["montoUsd"] is None),
    }
