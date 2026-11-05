"""Pago a los motorizados (delivery en moto).

El tablero es solo ADMIN: es informacion de pago de todos. Cada repartidor
ve aparte su propio estado de cuenta (mi_router), siempre el de su sesion.
Las reglas del calculo estan todas en app/services/delivery.py; aca solo se
elige el periodo, se edita el tabulador y se cierran las liquidaciones.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException
from psycopg.types.json import Jsonb

from app.core.auth import requiere_rol
from app.core.db import get_connection
from app.schemas import en_utc
from app.schemas import (
    AnulacionLiquidacionDelivery,
    ExclusionDeliveryCreate,
    ExclusionDeliveryQuitar,
    LiquidacionDeliveryCreate,
    TabuladorDeliveryUpdate,
)
from app.services import delivery as dl

router = APIRouter(
    prefix="/delivery",
    tags=["delivery"],
    dependencies=[Depends(requiere_rol("ADMIN"))],
)
# Lo que ve el propio repartidor. Router aparte porque el de arriba es solo
# ADMIN para todos sus endpoints.
mi_router = APIRouter(prefix="/delivery", tags=["delivery"])


def _validar_periodo(desde: date, hasta: date) -> None:
    if desde > hasta:
        raise HTTPException(400, "La fecha desde no puede ser posterior a la fecha hasta")


def _motorizados(cur) -> list[dict]:
    """Los repartidores con una moto asignada: los que pueden cobrar. Un
    motorizado autogestionado dado de baja sigue en la lista, por si se fue
    con entregas sin pagar (ver REPARTIDOR_DEL_VEHICULO)."""
    cur.execute(
        'SELECT u."id", u."nombre", v."placa" FROM "Usuario" u '
        'JOIN "Vehiculo" v ON v."id" = u."vehiculoAsignadoId" '
        "WHERE u.\"rol\" = 'REPARTIDOR' AND (u.\"activo\" OR u.\"autogestionado\") AND v.\"tipo\" = 'MOTO' "
        'ORDER BY u."nombre"'
    )
    return cur.fetchall()


# Las horas de cada entrega estan en UTC sin zona (ver app/core/fechas.py).
# Estas respuestas no pasan por un modelo de schemas.py (ver Instante alli):
# se les pone la zona al responder, no antes, porque los calculos y el pago
# (que las copia a LiquidacionDeliveryParada) trabajan con ellas sin zona.
# Sin zona el navegador las tomaba como hora local y las corria 4 horas.
_HORAS_PARADA = ("entregadoEn", "liquidadaEn", "excluidaEn")


def _con_zona(paradas: list[dict]) -> list[dict]:
    return [
        {**p, **{c: en_utc(p[c]) for c in _HORAS_PARADA if isinstance(p.get(c), datetime)}} for p in paradas
    ]


def _iso_con_zona(valor: str | None) -> str | None:
    """Una hora ya guardada como texto (el detalle de un pago anulado): los
    pagos anulados antes de esto la guardaron sin zona."""
    if not valor or "+" in valor[10:] or valor.endswith("Z"):
        return valor
    return f"{valor}+00:00"


@router.get("/resumen")
def resumen(desde: date, hasta: date, repartidor: str | None = None):
    """Lo que hay que pagar en el periodo: totales, cuanto le toca a cada
    motorizado y el detalle de cada parada."""
    _validar_periodo(desde, hasta)
    with get_connection() as conn, conn.cursor() as cur:
        paradas = dl.paradas_pagables(cur, desde, hasta, repartidor)
        return {
            "desde": desde,
            "hasta": hasta,
            "totales": dl.totales(paradas),
            "porMotorizado": dl.resumen_por_motorizado(paradas),
            "paradas": _con_zona(paradas),
            "tabulador": dl.tabulador(cur),
            "motorizados": _motorizados(cur),
        }


@router.get("/tabulador")
def leer_tabulador():
    with get_connection() as conn, conn.cursor() as cur:
        return dl.tabulador(cur)


@router.put("/tabulador")
def guardar_tabulador(data: TabuladorDeliveryUpdate, usuario: dict = Depends(requiere_rol("ADMIN"))):
    """Reemplaza el tabulador completo. Lo ya liquidado no cambia: cada
    parada pagada guarda su propio monto (ver LiquidacionDeliveryParada)."""
    rangos = [r.model_dump() for r in data.rangos]
    dl.validar_tabulador(rangos)
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute('DELETE FROM "TabuladorDelivery"')
        cur.executemany(
            'INSERT INTO "TabuladorDelivery" ("id", "orden", "hastaKm", "montoUsd", "actualizadoPorId") '
            "VALUES (%s, %s, %s, %s, %s)",
            [
                (f"tabdel-{uuid.uuid4().hex[:10]}", orden, rango["hastaKm"], rango["montoUsd"], usuario["id"])
                for orden, rango in enumerate(rangos, start=1)
            ],
        )
        conn.commit()
        return dl.tabulador(cur)


@router.post("/liquidaciones")
def crear_liquidacion(data: LiquidacionDeliveryCreate, usuario: dict = Depends(requiere_rol("ADMIN"))):
    """Cierra el pago de un motorizado en el periodo: congela los km y los
    montos de sus paradas pendientes (todas, o las elegidas en `paradas`
    para un corte parcial). Las que ya estaban liquidadas no se tocan, asi
    que repetir la operacion no paga dos veces."""
    _validar_periodo(data.desde, data.hasta)
    with get_connection() as conn, conn.cursor() as cur:
        paradas = [
            p
            for p in dl.paradas_pagables(cur, data.desde, data.hasta, data.repartidorId)
            if not p["liquidada"] and not p["excluida"] and p["montoUsd"] is not None
        ]
        if data.paradas is not None:
            elegidas = {(r.rutaId, r.clienteId, r.vehiculoId) for r in data.paradas}
            if not elegidas:
                raise HTTPException(400, "Elige al menos una entrega para registrar el pago")
            paradas = [p for p in paradas if (p["rutaId"], p["clienteId"], p["vehiculoId"]) in elegidas]
            # Todas o ninguna: si alguna ya se pagó (otra pestaña, otra
            # persona) o no es de este motorizado y período, el total que vio
            # quien registra ya no es el real.
            if len(paradas) != len(elegidas):
                raise HTTPException(
                    409,
                    f"{len(elegidas) - len(paradas)} de las entregas elegidas ya no están pendientes de pago "
                    "para este motorizado en el período. Recarga la página y vuelve a elegir.",
                )
        if not paradas:
            raise HTTPException(400, "No hay entregas pendientes de pago para ese motorizado en el período")

        total = round(sum(p["montoUsd"] for p in paradas), 2)
        liquidacion_id = f"liqdel-{uuid.uuid4().hex[:10]}"
        cur.execute(
            'INSERT INTO "LiquidacionDelivery" ("id", "repartidorId", "desde", "hasta", "entregas", '
            '"totalUsd", "creadoPorId", "nota") VALUES (%s, %s, %s, %s, %s, %s, %s, %s)',
            (
                liquidacion_id,
                data.repartidorId,
                data.desde,
                data.hasta,
                len(paradas),
                total,
                usuario["id"],
                data.nota,
            ),
        )
        cur.executemany(
            'INSERT INTO "LiquidacionDeliveryParada" ("id", "liquidacionId", "rutaId", "clienteId", '
            '"vehiculoId", "entregadoEn", "km", "montoUsd", "rango") VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s) '
            # Por moto: en un Morocho cada motorizado cobra la parada.
            'ON CONFLICT ("rutaId", "clienteId", "vehiculoId") DO NOTHING',
            [
                (
                    f"liqpar-{uuid.uuid4().hex[:10]}",
                    liquidacion_id,
                    p["rutaId"],
                    p["clienteId"],
                    p["vehiculoId"],
                    p["entregadoEn"],
                    p["km"],
                    p["montoUsd"],
                    p["rango"],
                )
                for p in paradas
            ],
        )
        conn.commit()
        return _liquidacion(cur, liquidacion_id)


def _liquidacion(cur, liquidacion_id: str) -> dict:
    cur.execute(_SELECT_LIQUIDACION + 'WHERE l."id" = %s', (liquidacion_id,))
    liquidacion = cur.fetchone()
    if not liquidacion:
        raise HTTPException(404, "Liquidación no encontrada")
    return {**liquidacion, "totalUsd": float(liquidacion["totalUsd"])}


@mi_router.get("/mi-cuenta")
def mi_cuenta(desde: date, hasta: date, usuario: dict = Depends(requiere_rol("REPARTIDOR"))):
    """El estado de cuenta del repartidor: sus entregas pagables del periodo
    (pagadas y pendientes), el tabulador con que se calculan y los pagos que
    ya recibio. Siempre el de quien tiene la sesion: no recibe un repartidor,
    asi que no hay forma de ver el de otro."""
    _validar_periodo(desde, hasta)
    with get_connection() as conn, conn.cursor() as cur:
        paradas = dl.paradas_pagables(cur, desde, hasta, usuario["id"])
        cur.execute(
            'SELECT u."nombre", v."placa", v."tipo" FROM "Usuario" u '
            'LEFT JOIN "Vehiculo" v ON v."id" = u."vehiculoAsignadoId" WHERE u."id" = %s',
            (usuario["id"],),
        )
        ficha = cur.fetchone()
        cur.execute(
            'SELECT l."id", l."desde", l."hasta", l."entregas", l."totalUsd", '
            "l.\"creadoEn\" AT TIME ZONE 'UTC' AS \"creadoEn\", l.\"nota\", "
            "l.\"anuladaEn\" AT TIME ZONE 'UTC' AS \"anuladaEn\", l.\"motivoAnulacion\" "
            'FROM "LiquidacionDelivery" l WHERE l."repartidorId" = %s ORDER BY l."creadoEn" DESC',
            (usuario["id"],),
        )
        pagos = [{**l, "totalUsd": float(l["totalUsd"])} for l in cur.fetchall()]
        return {
            "desde": desde,
            "hasta": hasta,
            "repartidor": ficha["nombre"] if ficha else usuario["nombre"],
            "placa": ficha["placa"] if ficha else None,
            # Solo se paga delivery en moto: con otro vehiculo no hay nada que cobrar.
            "enMoto": bool(ficha and ficha["tipo"] == "MOTO"),
            "totales": dl.totales(paradas),
            "paradas": _con_zona(paradas),
            "tabulador": dl.tabulador(cur),
            "pagos": pagos,
        }


# creadoEn y anuladaEn se guardan en UTC sin zona (ver app/core/fechas.py):
# se mandan con su zona para que el navegador no los lea como hora local
# (en Caracas se corrian 4 horas).
_SELECT_LIQUIDACION = (
    'SELECT l."id", l."repartidorId", l."desde", l."hasta", l."entregas", l."totalUsd", '
    "l.\"creadoEn\" AT TIME ZONE 'UTC' AS \"creadoEn\", l.\"nota\", "
    "l.\"anuladaEn\" AT TIME ZONE 'UTC' AS \"anuladaEn\", l.\"motivoAnulacion\", "
    'r."nombre" AS "repartidor", u."nombre" AS "creadoPor", '
    'ua."nombre" AS "anuladaPor" FROM "LiquidacionDelivery" l '
    'JOIN "Usuario" r ON r."id" = l."repartidorId" JOIN "Usuario" u ON u."id" = l."creadoPorId" '
    'LEFT JOIN "Usuario" ua ON ua."id" = l."anuladaPorId" '
)


@router.get("/liquidaciones")
def listar_liquidaciones(repartidor: str | None = None, desde: date | None = None, hasta: date | None = None):
    """Los pagos registrados, los anulados incluidos. Con desde/hasta, los
    que cubren algun dia de ese periodo."""
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            _SELECT_LIQUIDACION + 'WHERE (%(r)s::text IS NULL OR l."repartidorId" = %(r)s) '
            'AND (%(d)s::date IS NULL OR l."hasta" >= %(d)s) AND (%(h)s::date IS NULL OR l."desde" <= %(h)s) '
            'ORDER BY l."creadoEn" DESC',
            {"r": repartidor, "d": desde, "h": hasta},
        )
        return [{**l, "totalUsd": float(l["totalUsd"])} for l in cur.fetchall()]


@router.post("/liquidaciones/{liquidacion_id}/anular")
def anular_liquidacion(
    liquidacion_id: str, data: AnulacionLiquidacionDelivery, usuario: dict = Depends(requiere_rol("ADMIN"))
):
    """Da un pago por no hecho: sus entregas vuelven a quedar pendientes y se
    pueden volver a pagar. El pago queda en el historial como anulado, con
    el motivo y el detalle de lo que pagaba."""
    motivo = data.motivo.strip()
    if len(motivo) < 3:
        raise HTTPException(400, "Escribe el motivo de la anulación")
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute('SELECT "anuladaEn" FROM "LiquidacionDelivery" WHERE "id" = %s FOR UPDATE', (liquidacion_id,))
        fila = cur.fetchone()
        if not fila:
            raise HTTPException(404, "Pago no encontrado")
        if fila["anuladaEn"] is not None:
            raise HTTPException(409, "Este pago ya estaba anulado")
        paradas = _paradas_de_liquidacion(cur, liquidacion_id)
        cur.execute('DELETE FROM "LiquidacionDeliveryParada" WHERE "liquidacionId" = %s', (liquidacion_id,))
        cur.execute(
            'UPDATE "LiquidacionDelivery" SET "anuladaEn" = now(), "anuladaPorId" = %s, '
            '"motivoAnulacion" = %s, "paradasAnuladas" = %s WHERE "id" = %s',
            (usuario["id"], motivo, Jsonb(paradas), liquidacion_id),
        )
        conn.commit()
        return _liquidacion(cur, liquidacion_id)


def _paradas_de_liquidacion(cur, liquidacion_id: str) -> list[dict]:
    cur.execute(
        'SELECT p."rutaId", p."clienteId", p."vehiculoId", p."entregadoEn", p."km", p."montoUsd", p."rango", '
        'ru."numero" AS "rutaNumero", c."codigo" AS "clienteCodigo", c."nombre" AS "clienteNombre", c."ciudad" '
        'FROM "LiquidacionDeliveryParada" p '
        'JOIN "Ruta" ru ON ru."id" = p."rutaId" JOIN "Cliente" c ON c."id" = p."clienteId" '
        'WHERE p."liquidacionId" = %s ORDER BY p."entregadoEn"',
        (liquidacion_id,),
    )
    return [
        {**p, "montoUsd": float(p["montoUsd"]), "entregadoEn": en_utc(p["entregadoEn"]).isoformat()}
        for p in cur.fetchall()
    ]


_ESTADO_PARADA = (
    'SELECT EXISTS (SELECT 1 FROM "Despacho" d JOIN "Ruta" r ON r."id" = d."rutaId" '
    '  JOIN "Vehiculo" v ON v."id" = %(v)s AND v."id" IN (r."vehiculoId", r."vehiculoApoyoId") '
    "  AND v.\"tipo\" = 'MOTO' "
    '  WHERE d."rutaId" = %(r)s AND d."destinoClienteId" = %(c)s AND d."entregadoEn" IS NOT NULL) AS "pagable", '
    'EXISTS (SELECT 1 FROM "LiquidacionDeliveryParada" p WHERE p."rutaId" = %(r)s '
    '  AND p."clienteId" = %(c)s AND p."vehiculoId" = %(v)s) AS "pagada"'
)


@router.post("/exclusiones")
def excluir_paradas(data: ExclusionDeliveryCreate, usuario: dict = Depends(requiere_rol("ADMIN"))):
    """Marca entregas como «no se paga», con motivo. Todas o ninguna: si una
    ya esta pagada, primero hay que anular ese pago."""
    motivo = data.motivo.strip()
    if len(motivo) < 3:
        raise HTTPException(400, "Escribe el motivo")
    claves = {(r.rutaId, r.clienteId, r.vehiculoId) for r in data.paradas}
    with get_connection() as conn, conn.cursor() as cur:
        for ruta_id, cliente_id, vehiculo_id in claves:
            cur.execute(_ESTADO_PARADA, {"r": ruta_id, "c": cliente_id, "v": vehiculo_id})
            fila = cur.fetchone()
            if not fila["pagable"]:
                raise HTTPException(400, "Alguna de las entregas elegidas no es una entrega en moto pagable")
            if fila["pagada"]:
                raise HTTPException(409, "Alguna de las entregas elegidas ya está pagada: anula ese pago primero")
        cur.executemany(
            'INSERT INTO "ParadaDeliveryExcluida" ("id", "rutaId", "clienteId", "vehiculoId", "motivo", "creadoPorId") '
            "VALUES (%s, %s, %s, %s, %s, %s) "
            'ON CONFLICT ("rutaId", "clienteId", "vehiculoId") DO UPDATE SET "motivo" = EXCLUDED."motivo"',
            [
                (f"pdexc-{uuid.uuid4().hex[:10]}", ruta_id, cliente_id, vehiculo_id, motivo, usuario["id"])
                for ruta_id, cliente_id, vehiculo_id in claves
            ],
        )
        conn.commit()
        return {"excluidas": len(claves)}


@router.post("/exclusiones/quitar")
def quitar_exclusiones(data: ExclusionDeliveryQuitar):
    """Devuelve entregas marcadas «no se paga» a pendientes."""
    with get_connection() as conn, conn.cursor() as cur:
        quitadas = 0
        for clave in {(r.rutaId, r.clienteId, r.vehiculoId) for r in data.paradas}:
            cur.execute(
                'DELETE FROM "ParadaDeliveryExcluida" WHERE "rutaId" = %s AND "clienteId" = %s AND "vehiculoId" = %s',
                clave,
            )
            quitadas += cur.rowcount
        conn.commit()
        return {"quitadas": quitadas}


@router.get("/liquidaciones/{liquidacion_id}")
def detalle_liquidacion(liquidacion_id: str):
    with get_connection() as conn, conn.cursor() as cur:
        liquidacion = _liquidacion(cur, liquidacion_id)
        if liquidacion["anuladaEn"] is not None:
            # Sus filas se borraron al anular: el detalle quedo guardado.
            cur.execute('SELECT "paradasAnuladas" FROM "LiquidacionDelivery" WHERE "id" = %s', (liquidacion_id,))
            paradas = cur.fetchone()["paradasAnuladas"] or []
            return {**liquidacion, "paradas": [{**p, "entregadoEn": _iso_con_zona(p.get("entregadoEn"))} for p in paradas]}
        return {**liquidacion, "paradas": _paradas_de_liquidacion(cur, liquidacion_id)}
