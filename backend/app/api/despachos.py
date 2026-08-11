import uuid
from datetime import datetime, timedelta

from fastapi import APIRouter, HTTPException

from app.core.db import get_connection
from app.core.numero import siguiente_numero
from app.schemas import (
    ActualizarCantidadDespachoItemRequest,
    AsignarVehiculoRequest,
    Despacho,
    DespachoAprobacionCreate,
    DespachoCreate,
    RutaCalculada,
    SugerenciaVehiculo,
)
from app.services.route_analysis import LatLng, calcular_mejor_ruta
from app.services.suggest_vehiculo import sugerir_vehiculos

router = APIRouter(prefix="/despachos", tags=["despachos"])

ALMACEN_BASE_ID = "alm-catia"


def _con_items(cur, despacho_row: dict) -> dict:
    cur.execute(
        'SELECT "id", "productoId", "cantidad", "cantidadSolicitada" FROM "DespachoItem" WHERE "despachoId" = %s',
        (despacho_row["id"],),
    )
    return {**despacho_row, "items": cur.fetchall()}


def _stock_disponible(cur, producto_id: str, almacen_id: str) -> int:
    cur.execute(
        'SELECT "cantidad" FROM "StockAlmacen" WHERE "productoId" = %s AND "almacenId" = %s',
        (producto_id, almacen_id),
    )
    row = cur.fetchone()
    return row["cantidad"] if row else 0


@router.get("", response_model=list[Despacho])
def listar_despachos():
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute('SELECT * FROM "Despacho" ORDER BY "fechaCreacion" DESC')
        despachos = cur.fetchall()
        return [_con_items(cur, d) for d in despachos]


@router.get("/aprobacion", response_model=list[Despacho])
def listar_despachos_pendientes_aprobacion():
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute('SELECT * FROM "Despacho" WHERE "estado" = \'PENDIENTE_APROBACION\' ORDER BY "fechaCreacion"')
        despachos = cur.fetchall()
        return [_con_items(cur, d) for d in despachos]


@router.get("/{despacho_id}", response_model=Despacho)
def obtener_despacho(despacho_id: str):
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute('SELECT * FROM "Despacho" WHERE "id" = %s', (despacho_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Despacho no encontrado")
        return _con_items(cur, row)


@router.post("", response_model=Despacho, status_code=201)
def crear_despacho(data: DespachoCreate):
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute('SELECT * FROM "Venta" WHERE "id" = %s', (data.ventaId,))
        venta = cur.fetchone()
        if not venta:
            raise HTTPException(404, "Venta no encontrada")
        if venta["estado"] != "APROBADA":
            raise HTTPException(400, "Solo se puede despachar una venta aprobada")

        cur.execute('SELECT 1 FROM "Despacho" WHERE "ventaId" = %s LIMIT 1', (data.ventaId,))
        if cur.fetchone():
            raise HTTPException(400, "Esta venta ya tiene un despacho generado")

        cur.execute('SELECT "id", "productoId", "cantidad" FROM "VentaItem" WHERE "ventaId" = %s', (data.ventaId,))
        venta_items = cur.fetchall()

        numero = siguiente_numero(cur, "Despacho", "D", 4)
        despacho_id = f"despacho-{uuid.uuid4().hex[:10]}"

        cur.execute(
            'INSERT INTO "Despacho" '
            '("id", "numero", "ventaId", "origenId", "destinoClienteId", "creadoPorId", "estado", "rutaCalculada") '
            "VALUES (%s, %s, %s, %s, %s, %s, 'PENDIENTE_APROBACION', false) RETURNING *",
            (despacho_id, numero, data.ventaId, ALMACEN_BASE_ID, venta["clienteId"], data.creadoPorId),
        )
        despacho_row = cur.fetchone()

        items = []
        for item in venta_items:
            item_id = f"di-{uuid.uuid4().hex[:10]}"
            cantidad_solicitada = item["cantidad"]
            # Sugerencia inicial: lo maximo que el stock actual permite, sin
            # superar lo pedido. El coordinador puede ajustarla a mano
            # despues (ver PATCH /despachos/{id}/items/{item_id}) mientras el
            # despacho no haya salido del almacen.
            disponible = _stock_disponible(cur, item["productoId"], ALMACEN_BASE_ID)
            cantidad_sugerida = max(0, min(cantidad_solicitada, disponible))
            cur.execute(
                'INSERT INTO "DespachoItem" ("id", "despachoId", "productoId", "cantidad", "cantidadSolicitada") '
                "VALUES (%s, %s, %s, %s, %s)",
                (item_id, despacho_id, item["productoId"], cantidad_sugerida, cantidad_solicitada),
            )
            items.append({
                "id": item_id, "productoId": item["productoId"],
                "cantidad": cantidad_sugerida, "cantidadSolicitada": cantidad_solicitada,
            })

        conn.commit()
        return {**despacho_row, "items": items}


@router.post("/{despacho_id}/aprobacion", response_model=Despacho)
def aprobar_o_rechazar_despacho(despacho_id: str, data: DespachoAprobacionCreate):
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute('SELECT * FROM "Despacho" WHERE "id" = %s', (despacho_id,))
        despacho = cur.fetchone()
        if not despacho:
            raise HTTPException(404, "Despacho no encontrado")
        if despacho["estado"] != "PENDIENTE_APROBACION":
            raise HTTPException(400, "Este despacho no esta pendiente de aprobacion")

        cur.execute(
            'INSERT INTO "DespachoAprobacion" ("id", "despachoId", "usuarioId", "accion", "comentario") '
            "VALUES (%s, %s, %s, %s, %s)",
            (f"dap-{uuid.uuid4().hex[:10]}", despacho_id, data.usuarioId, data.accion, data.comentario),
        )

        nuevo_estado = "APROBADO" if data.accion == "APROBADA" else "RECHAZADO"
        cur.execute('UPDATE "Despacho" SET "estado" = %s WHERE "id" = %s RETURNING *', (nuevo_estado, despacho_id))
        despacho_row = cur.fetchone()
        conn.commit()
        return _con_items(cur, despacho_row)


def _origen_destino_despacho(cur, despacho_id: str) -> tuple[LatLng, LatLng]:
    cur.execute(
        'SELECT a."lat" AS "origenLat", a."lng" AS "origenLng", '
        'c."lat" AS "destinoLat", c."lng" AS "destinoLng" '
        'FROM "Despacho" d '
        'JOIN "Almacen" a ON a."id" = d."origenId" '
        'JOIN "Cliente" c ON c."codigo" = d."destinoClienteId" '
        'WHERE d."id" = %s',
        (despacho_id,),
    )
    row = cur.fetchone()
    if not row:
        raise HTTPException(404, "Despacho no encontrado")
    if row["destinoLat"] is None or row["destinoLng"] is None:
        raise HTTPException(400, "El cliente destino no tiene coordenadas registradas")
    return (
        LatLng(lat=row["origenLat"], lng=row["origenLng"]),
        LatLng(lat=row["destinoLat"], lng=row["destinoLng"]),
    )


@router.post("/{despacho_id}/ruta/preview", response_model=RutaCalculada)
def previsualizar_ruta(despacho_id: str):
    """Igual que calcular_mejor_ruta pero sin persistir nada -- para el boton
    "Calcular ruta optima" (antes de "Confirmar ruta"). Usa el mismo servicio
    real (o el mismo fallback) que la version que si persiste, para que la
    vista previa no muestre algo distinto de lo que se termina guardando."""
    with get_connection() as conn, conn.cursor() as cur:
        origen, destino = _origen_destino_despacho(cur, despacho_id)
        resultado = calcular_mejor_ruta(despacho_id, origen, destino)

        ahora = datetime.now()
        n = len(resultado.geometry)
        puntos = []
        for i, (lng, lat) in enumerate(resultado.geometry):
            estado_punto = "salida" if i == 0 else "en_ruta"
            offset_min = resultado.tiempo_min * (i / (n - 1)) if n > 1 else 0
            puntos.append({
                "id": f"preview-{i}", "despachoId": despacho_id, "orden": i + 1,
                "lat": lat, "lng": lng, "estado": estado_punto,
                "timestamp": ahora + timedelta(minutes=offset_min), "descripcion": None,
            })

        return {"distanciaEstimadaKm": resultado.distancia_km, "tiempoEstimadoMin": resultado.tiempo_min, "ruta": puntos}


@router.post("/{despacho_id}/ruta", response_model=RutaCalculada)
def calcular_y_confirmar_ruta(despacho_id: str):
    with get_connection() as conn, conn.cursor() as cur:
        origen, destino = _origen_destino_despacho(cur, despacho_id)
        resultado = calcular_mejor_ruta(despacho_id, origen, destino)

        cur.execute(
            'UPDATE "Despacho" SET "distanciaEstimadaKm" = %s, "tiempoEstimadoMin" = %s, "rutaCalculada" = true '
            'WHERE "id" = %s',
            (resultado.distancia_km, resultado.tiempo_min, despacho_id),
        )

        cur.execute('DELETE FROM "RutaPunto" WHERE "despachoId" = %s', (despacho_id,))
        ahora = datetime.now()
        n = len(resultado.geometry)
        puntos = []
        for i, (lng, lat) in enumerate(resultado.geometry):
            estado_punto = "salida" if i == 0 else "en_ruta"
            offset_min = resultado.tiempo_min * (i / (n - 1)) if n > 1 else 0
            punto_id = f"rp-{uuid.uuid4().hex[:10]}"
            timestamp = ahora + timedelta(minutes=offset_min)
            cur.execute(
                'INSERT INTO "RutaPunto" ("id", "despachoId", "orden", "lat", "lng", "estado", "timestamp") '
                "VALUES (%s, %s, %s, %s, %s, %s, %s)",
                (punto_id, despacho_id, i + 1, lat, lng, estado_punto, timestamp),
            )
            puntos.append({
                "id": punto_id, "despachoId": despacho_id, "orden": i + 1,
                "lat": lat, "lng": lng, "estado": estado_punto,
                "timestamp": timestamp, "descripcion": None,
            })

        conn.commit()
        return {"distanciaEstimadaKm": resultado.distancia_km, "tiempoEstimadoMin": resultado.tiempo_min, "ruta": puntos}


@router.get("/{despacho_id}/vehiculos-sugeridos", response_model=list[SugerenciaVehiculo])
def obtener_vehiculos_sugeridos(despacho_id: str):
    return sugerir_vehiculos(despacho_id)


@router.post("/{despacho_id}/asignar-vehiculo", response_model=Despacho)
def asignar_vehiculo(despacho_id: str, data: AsignarVehiculoRequest):
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            'UPDATE "Despacho" SET "vehiculoId" = %s WHERE "id" = %s RETURNING *',
            (data.vehiculoId, despacho_id),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Despacho no encontrado")
        conn.commit()
        return _con_items(cur, row)


@router.patch("/{despacho_id}/items/{item_id}", response_model=Despacho)
def ajustar_cantidad_item(despacho_id: str, item_id: str, data: ActualizarCantidadDespachoItemRequest):
    """El coordinador ajusta a mano cuanto se va a despachar de un producto,
    mientras el despacho no haya salido del almacen."""
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute('SELECT * FROM "Despacho" WHERE "id" = %s', (despacho_id,))
        despacho = cur.fetchone()
        if not despacho:
            raise HTTPException(404, "Despacho no encontrado")
        if despacho["estado"] not in ("PENDIENTE_APROBACION", "APROBADO"):
            raise HTTPException(400, "Ya no se puede ajustar la cantidad de este despacho")

        cur.execute(
            'SELECT * FROM "DespachoItem" WHERE "id" = %s AND "despachoId" = %s',
            (item_id, despacho_id),
        )
        item = cur.fetchone()
        if not item:
            raise HTTPException(404, "Item de despacho no encontrado")
        if data.cantidad < 0 or data.cantidad > item["cantidadSolicitada"]:
            raise HTTPException(
                400,
                f'La cantidad debe estar entre 0 y lo solicitado ({item["cantidadSolicitada"]})',
            )

        cur.execute('UPDATE "DespachoItem" SET "cantidad" = %s WHERE "id" = %s', (data.cantidad, item_id))
        conn.commit()

        cur.execute('SELECT * FROM "Despacho" WHERE "id" = %s', (despacho_id,))
        return _con_items(cur, cur.fetchone())


@router.post("/{despacho_id}/iniciar", response_model=Despacho)
def iniciar_ruta(despacho_id: str):
    """El despachador marca que salio del almacen con el despacho."""
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute('SELECT * FROM "Despacho" WHERE "id" = %s', (despacho_id,))
        despacho = cur.fetchone()
        if not despacho:
            raise HTTPException(404, "Despacho no encontrado")
        if despacho["estado"] != "APROBADO":
            raise HTTPException(400, "Solo se puede iniciar un despacho aprobado")
        if not despacho["vehiculoId"]:
            raise HTTPException(400, "Asigna un vehiculo antes de iniciar la ruta")

        cur.execute(
            'UPDATE "Despacho" SET "estado" = \'EN_TRANSITO\' WHERE "id" = %s RETURNING *',
            (despacho_id,),
        )
        row = cur.fetchone()

        # Aca es cuando el producto realmente sale del almacen: se descuenta
        # el stock de verdad. Se re-topa contra el disponible actual por si
        # cambio algo desde que se ajusto la cantidad (nunca deja stock
        # negativo).
        cur.execute(
            'SELECT "productoId", "cantidad" FROM "DespachoItem" WHERE "despachoId" = %s',
            (despacho_id,),
        )
        for item in cur.fetchall():
            cur.execute(
                'UPDATE "StockAlmacen" SET "cantidad" = GREATEST("cantidad" - %s, 0) '
                'WHERE "productoId" = %s AND "almacenId" = %s',
                (item["cantidad"], item["productoId"], row["origenId"]),
            )

        conn.commit()
        return _con_items(cur, row)


@router.post("/{despacho_id}/entregar", response_model=Despacho)
def marcar_entregado(despacho_id: str):
    """El despachador marca que el despacho llego a su destino, cerrando el ciclo de la venta."""
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute('SELECT * FROM "Despacho" WHERE "id" = %s', (despacho_id,))
        despacho = cur.fetchone()
        if not despacho:
            raise HTTPException(404, "Despacho no encontrado")
        if despacho["estado"] != "EN_TRANSITO":
            raise HTTPException(400, "Solo se puede marcar como entregado un despacho en transito")

        cur.execute(
            'UPDATE "Despacho" SET "estado" = \'ENTREGADO\' WHERE "id" = %s RETURNING *',
            (despacho_id,),
        )
        row = cur.fetchone()

        cur.execute(
            'UPDATE "RutaPunto" SET "estado" = \'entregado\' WHERE "despachoId" = %s '
            'AND "orden" = (SELECT MAX("orden") FROM "RutaPunto" WHERE "despachoId" = %s)',
            (despacho_id, despacho_id),
        )

        conn.commit()
        return _con_items(cur, row)
