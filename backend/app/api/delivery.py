"""Pago a los motorizados (delivery en moto).

Solo ADMIN: es informacion de pago. Las reglas del calculo estan todas en
app/services/delivery.py; aca solo se elige el periodo, se edita el
tabulador y se cierran las liquidaciones.
"""

from __future__ import annotations

import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException

from app.core.auth import requiere_rol
from app.core.db import get_connection
from app.schemas import LiquidacionDeliveryCreate, TabuladorDeliveryUpdate
from app.services import delivery as dl

router = APIRouter(
    prefix="/delivery",
    tags=["delivery"],
    dependencies=[Depends(requiere_rol("ADMIN"))],
)


def _validar_periodo(desde: date, hasta: date) -> None:
    if desde > hasta:
        raise HTTPException(400, "La fecha desde no puede ser posterior a la fecha hasta")


def _motorizados(cur) -> list[dict]:
    """Los repartidores con una moto asignada: los que pueden cobrar."""
    cur.execute(
        'SELECT u."id", u."nombre", v."placa" FROM "Usuario" u '
        'JOIN "Vehiculo" v ON v."id" = u."vehiculoAsignadoId" '
        "WHERE u.\"rol\" = 'REPARTIDOR' AND u.\"activo\" AND v.\"tipo\" = 'MOTO' "
        'ORDER BY u."nombre"'
    )
    return cur.fetchall()


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
            "paradas": paradas,
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
    montos de sus paradas pendientes. Las que ya estaban liquidadas no se
    tocan, asi que repetir la operacion no paga dos veces."""
    _validar_periodo(data.desde, data.hasta)
    with get_connection() as conn, conn.cursor() as cur:
        paradas = [
            p
            for p in dl.paradas_pagables(cur, data.desde, data.hasta, data.repartidorId)
            if not p["liquidada"] and p["montoUsd"] is not None
        ]
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
            '"entregadoEn", "km", "montoUsd", "rango") VALUES (%s, %s, %s, %s, %s, %s, %s, %s) '
            'ON CONFLICT ("rutaId", "clienteId") DO NOTHING',
            [
                (
                    f"liqpar-{uuid.uuid4().hex[:10]}",
                    liquidacion_id,
                    p["rutaId"],
                    p["clienteId"],
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
    cur.execute(
        'SELECT l.*, r."nombre" AS "repartidor", u."nombre" AS "creadoPor" FROM "LiquidacionDelivery" l '
        'JOIN "Usuario" r ON r."id" = l."repartidorId" JOIN "Usuario" u ON u."id" = l."creadoPorId" '
        'WHERE l."id" = %s',
        (liquidacion_id,),
    )
    liquidacion = cur.fetchone()
    if not liquidacion:
        raise HTTPException(404, "Liquidación no encontrada")
    return {**liquidacion, "totalUsd": float(liquidacion["totalUsd"])}


@router.get("/liquidaciones")
def listar_liquidaciones(repartidor: str | None = None):
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            'SELECT l.*, r."nombre" AS "repartidor", u."nombre" AS "creadoPor" FROM "LiquidacionDelivery" l '
            'JOIN "Usuario" r ON r."id" = l."repartidorId" JOIN "Usuario" u ON u."id" = l."creadoPorId" '
            'WHERE (%s::text IS NULL OR l."repartidorId" = %s) ORDER BY l."creadoEn" DESC',
            (repartidor, repartidor),
        )
        return [{**l, "totalUsd": float(l["totalUsd"])} for l in cur.fetchall()]


@router.get("/liquidaciones/{liquidacion_id}")
def detalle_liquidacion(liquidacion_id: str):
    with get_connection() as conn, conn.cursor() as cur:
        liquidacion = _liquidacion(cur, liquidacion_id)
        cur.execute(
            'SELECT p."entregadoEn", p."km", p."montoUsd", p."rango", ru."numero" AS "rutaNumero", '
            'c."codigo" AS "clienteCodigo", c."nombre" AS "clienteNombre", c."ciudad" '
            'FROM "LiquidacionDeliveryParada" p '
            'JOIN "Ruta" ru ON ru."id" = p."rutaId" JOIN "Cliente" c ON c."id" = p."clienteId" '
            'WHERE p."liquidacionId" = %s ORDER BY p."entregadoEn"',
            (liquidacion_id,),
        )
        paradas = [{**p, "montoUsd": float(p["montoUsd"])} for p in cur.fetchall()]
        return {**liquidacion, "paradas": paradas}
