"""Rutas multi-parada: agrupan varios despachos ya aprobados en el viaje de
un vehiculo, con el orden de visita y el trazado calculados por
app/services/route_analysis.py (calcular_mejor_ruta_multi). El ciclo de
vida del viaje (salir del almacen, entregar parada por parada) tambien vive
aca — ver docs/PLAN.md, seccion "Rutas multi-parada"."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException

from app.core.auth import requiere_rol
from app.core.db import get_connection
from app.core.numero import siguiente_numero
from app.schemas import Ruta, RutaCreate, SugerenciaVehiculo, SugerenciaVehiculoRequest
from app.services.route_analysis import LatLng, calcular_mejor_ruta_multi
from app.services.suggest_vehiculo import sugerir_vehiculos

router = APIRouter(prefix="/rutas", tags=["rutas"])

ALMACEN_BASE_ID = "alm-catia"


def _con_detalle(cur, ruta_row: dict) -> dict:
    cur.execute('SELECT * FROM "Despacho" WHERE "rutaId" = %s ORDER BY "ordenEnRuta"', (ruta_row["id"],))
    despachos = cur.fetchall()
    for d in despachos:
        cur.execute(
            'SELECT "id", "descripcion", "cantidad", "cantidadSolicitada", "pesoUnitarioKg", "requiereFrio" '
            'FROM "DespachoItem" WHERE "despachoId" = %s',
            (d["id"],),
        )
        d["items"] = cur.fetchall()

    cur.execute('SELECT * FROM "RutaPunto" WHERE "rutaId" = %s ORDER BY "orden"', (ruta_row["id"],))
    puntos = cur.fetchall()

    return {**ruta_row, "despachos": despachos, "puntos": puntos}


@router.get("", response_model=list[Ruta])
def listar_rutas():
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute('SELECT * FROM "Ruta" ORDER BY "fechaCreacion" DESC')
        rutas = cur.fetchall()
        return [_con_detalle(cur, r) for r in rutas]


@router.get("/{ruta_id}", response_model=Ruta)
def obtener_ruta(ruta_id: str):
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute('SELECT * FROM "Ruta" WHERE "id" = %s', (ruta_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Ruta no encontrada")
        return _con_detalle(cur, row)


@router.post(
    "/vehiculos-sugeridos",
    response_model=list[SugerenciaVehiculo],
    dependencies=[Depends(requiere_rol("DESPACHOS"))],
)
def obtener_vehiculos_sugeridos(data: SugerenciaVehiculoRequest):
    return sugerir_vehiculos(data.despachoIds)


@router.post("", response_model=Ruta, status_code=201, dependencies=[Depends(requiere_rol("DESPACHOS"))])
def crear_ruta(data: RutaCreate):
    if not data.despachoIds:
        raise HTTPException(400, "Selecciona al menos un despacho para la ruta")

    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            'SELECT d.*, c."lat" AS "clienteLat", c."lng" AS "clienteLng" '
            'FROM "Despacho" d JOIN "Cliente" c ON c."id" = d."destinoClienteId" '
            'WHERE d."id" = ANY(%s)',
            (data.despachoIds,),
        )
        despachos = cur.fetchall()
        if {d["id"] for d in despachos} != set(data.despachoIds):
            raise HTTPException(404, "Alguno de los despachos no existe")
        for d in despachos:
            if d["estado"] != "APROBADO":
                raise HTTPException(400, f'El despacho {d["numero"]} no esta aprobado')
            if d["rutaId"] is not None:
                raise HTTPException(400, f'El despacho {d["numero"]} ya pertenece a otra ruta')
            if d["clienteLat"] is None or d["clienteLng"] is None:
                raise HTTPException(400, f'El cliente del despacho {d["numero"]} no tiene coordenadas registradas')

        cur.execute('SELECT * FROM "Almacen" WHERE "id" = %s', (ALMACEN_BASE_ID,))
        almacen = cur.fetchone()
        cur.execute('SELECT 1 FROM "Vehiculo" WHERE "id" = %s AND "estado" = \'FUNCIONAL\'', (data.vehiculoId,))
        if not cur.fetchone():
            raise HTTPException(400, "El vehiculo no existe o no esta funcional")

        origen = LatLng(lat=almacen["lat"], lng=almacen["lng"])
        paradas = [LatLng(lat=d["clienteLat"], lng=d["clienteLng"]) for d in despachos]
        resultado, orden, indices_parada = calcular_mejor_ruta_multi(origen, paradas)

        numero = siguiente_numero(cur, "Ruta", "R", 4)
        ruta_id = f"ruta-{uuid.uuid4().hex[:10]}"
        cur.execute(
            'INSERT INTO "Ruta" '
            '("id", "numero", "vehiculoId", "origenId", "creadoPorId", "estado", "distanciaTotalKm", "tiempoTotalMin") '
            "VALUES (%s, %s, %s, %s, %s, 'PLANIFICADA', %s, %s) RETURNING *",
            (
                ruta_id, numero, data.vehiculoId, ALMACEN_BASE_ID, data.creadoPorId,
                resultado.distancia_km, resultado.tiempo_min,
            ),
        )
        ruta_row = cur.fetchone()

        for posicion, indice_despacho in enumerate(orden):
            despacho_id = despachos[indice_despacho]["id"]
            cur.execute(
                'UPDATE "Despacho" SET "rutaId" = %s, "ordenEnRuta" = %s WHERE "id" = %s',
                (ruta_id, posicion + 1, despacho_id),
            )

        # indices_parada[pos] = indice (en resultado.geometry) del punto de
        # llegada de la parada visitada en la posicion `pos` de `orden`.
        despacho_por_indice_geometria = {
            idx: despachos[orden[pos]]["id"] for pos, idx in enumerate(indices_parada)
        }

        # Se guarda la geometria completa que devuelve SuperMap (puede ser
        # de cientos a miles de puntos en un trayecto largo) -- reducirla
        # aca cortaria curvas reales de las calles. La cantidad de
        # RutaPunto por fila no es un problema (el mapa ya filtra que
        # puntos marca, ver seguimiento-detalle-map.tsx); se inserta en
        # lote para que no sea lenta con geometrias grandes.
        ahora = datetime.now()
        n = len(resultado.geometry)
        filas = []
        for i, (lng, lat) in enumerate(resultado.geometry):
            estado_punto = "salida" if i == 0 else "en_ruta"
            offset_min = resultado.tiempo_min * (i / (n - 1)) if n > 1 else 0
            filas.append((
                f"rp-{uuid.uuid4().hex[:10]}", ruta_id, i + 1, lat, lng, estado_punto,
                ahora + timedelta(minutes=offset_min), despacho_por_indice_geometria.get(i),
            ))
        cur.executemany(
            'INSERT INTO "RutaPunto" '
            '("id", "rutaId", "orden", "lat", "lng", "estado", "timestamp", "paradaDespachoId") '
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
            filas,
        )

        conn.commit()
        return _con_detalle(cur, ruta_row)


@router.post(
    "/{ruta_id}/iniciar",
    response_model=Ruta,
    dependencies=[Depends(requiere_rol("REPARTIDOR"))],
)
def iniciar_ruta(ruta_id: str):
    """El despachador marca que el vehiculo salio del almacen con todos los
    despachos de la ruta a la vez."""
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute('SELECT * FROM "Ruta" WHERE "id" = %s', (ruta_id,))
        ruta = cur.fetchone()
        if not ruta:
            raise HTTPException(404, "Ruta no encontrada")
        if ruta["estado"] != "PLANIFICADA":
            raise HTTPException(400, "Solo se puede iniciar una ruta planificada")

        cur.execute('UPDATE "Ruta" SET "estado" = \'EN_TRANSITO\' WHERE "id" = %s', (ruta_id,))
        cur.execute('UPDATE "Despacho" SET "estado" = \'EN_TRANSITO\' WHERE "rutaId" = %s', (ruta_id,))
        conn.commit()

        cur.execute('SELECT * FROM "Ruta" WHERE "id" = %s', (ruta_id,))
        return _con_detalle(cur, cur.fetchone())


@router.post(
    "/{ruta_id}/paradas/{despacho_id}/entregar",
    response_model=Ruta,
    dependencies=[Depends(requiere_rol("REPARTIDOR"))],
)
def marcar_parada_entregada(ruta_id: str, despacho_id: str):
    """El despachador marca que se entrego un despacho puntual dentro del
    viaje — no afecta a las demas paradas de la misma ruta. Cuando se
    entrega la ultima parada pendiente, la ruta pasa a COMPLETADA."""
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute('SELECT * FROM "Ruta" WHERE "id" = %s', (ruta_id,))
        ruta = cur.fetchone()
        if not ruta:
            raise HTTPException(404, "Ruta no encontrada")
        if ruta["estado"] != "EN_TRANSITO":
            raise HTTPException(400, "La ruta no esta en transito")

        cur.execute('SELECT * FROM "Despacho" WHERE "id" = %s AND "rutaId" = %s', (despacho_id, ruta_id))
        despacho = cur.fetchone()
        if not despacho:
            raise HTTPException(404, "El despacho no pertenece a esta ruta")
        if despacho["estado"] != "EN_TRANSITO":
            raise HTTPException(400, "Este despacho ya fue entregado (o no esta en transito)")

        cur.execute('UPDATE "Despacho" SET "estado" = \'ENTREGADO\' WHERE "id" = %s', (despacho_id,))
        cur.execute(
            'UPDATE "RutaPunto" SET "estado" = \'entregado\' WHERE "rutaId" = %s AND "paradaDespachoId" = %s',
            (ruta_id, despacho_id),
        )

        cur.execute(
            'SELECT COUNT(*) AS "pendientes" FROM "Despacho" WHERE "rutaId" = %s AND "estado" != \'ENTREGADO\'',
            (ruta_id,),
        )
        if cur.fetchone()["pendientes"] == 0:
            cur.execute('UPDATE "Ruta" SET "estado" = \'COMPLETADA\' WHERE "id" = %s', (ruta_id,))

        conn.commit()

        cur.execute('SELECT * FROM "Ruta" WHERE "id" = %s', (ruta_id,))
        return _con_detalle(cur, cur.fetchone())
