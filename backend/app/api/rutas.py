"""Rutas multi-parada: agrupan varios despachos ya aprobados en el viaje de
un vehiculo, con el orden de visita y el trazado calculados por
app/services/route_analysis.py (calcular_mejor_ruta_multi). El ciclo de
vida del viaje (salir del almacen, entregar parada por parada) tambien vive
aca — ver docs/PLAN.md, seccion "Rutas multi-parada"."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException

from app.core.auth import get_current_user, requiere_rol
from app.core.db import get_connection
from app.core.numero import siguiente_numero
from app.core.permisos import es_repartidor, vehiculo_asignado
from app.core.ubicacion import sin_ubicacion
from psycopg.types.json import Jsonb

from app.schemas import (
    PlanRutasRequest,
    PlanRutasResponse,
    ReversarRutaRequest,
    Ruta,
    RutaCreate,
    SugerenciaVehiculo,
    SugerenciaVehiculoRequest,
)
from app.services.plan_rutas import sugerir_plan_rutas
from app.services.route_analysis import MINUTOS_POR_PARADA, LatLng, calcular_mejor_ruta_multi
from app.services.suggest_vehiculo import sugerir_vehiculos

router = APIRouter(prefix="/rutas", tags=["rutas"])

ALMACEN_BASE_ID = "alm-catia"


def _con_detalle_lote(cur, rutas: list[dict], *, geometria_completa: bool = True) -> list[dict]:
    """Version en lote: sin importar cuantas rutas ni cuantos despachos por
    ruta, siempre son 3 consultas totales (despachos, items, puntos), en vez
    de una por despacho anidada dentro de una por ruta (N+1). Con la base en
    otra region (Neon) cada round-trip pesa mucho mas que en local.

    geometria_completa=False trae solo el ultimo punto de cada ruta: es lo
    unico que necesitan las vistas de lista (dashboard y seguimiento, para
    ubicar el vehiculo en el mapa), y evita mandar miles de vertices por
    ruta en cada carga de pagina. El detalle de una ruta si la trae completa.
    """
    if not rutas:
        return []
    ruta_ids = [r["id"] for r in rutas]

    cur.execute('SELECT * FROM "Despacho" WHERE "rutaId" = ANY(%s) ORDER BY "ordenEnRuta"', (ruta_ids,))
    despachos = cur.fetchall()

    despacho_ids = [d["id"] for d in despachos]
    items_por_despacho: dict[str, list[dict]] = {}
    if despacho_ids:
        cur.execute(
            'SELECT "id", "despachoId", "descripcion", "cantidad", "cantidadSolicitada", "pesoUnitarioKg", "requiereFrio" '
            'FROM "DespachoItem" WHERE "despachoId" = ANY(%s)',
            (despacho_ids,),
        )
        for item in cur.fetchall():
            despacho_id = item.pop("despachoId")
            items_por_despacho.setdefault(despacho_id, []).append(item)

    despachos_por_ruta: dict[str, list[dict]] = {}
    for d in despachos:
        d["items"] = items_por_despacho.get(d["id"], [])
        despachos_por_ruta.setdefault(d["rutaId"], []).append(d)

    if geometria_completa:
        cur.execute('SELECT * FROM "RutaPunto" WHERE "rutaId" = ANY(%s) ORDER BY "orden"', (ruta_ids,))
    else:
        cur.execute(
            'SELECT DISTINCT ON ("rutaId") * FROM "RutaPunto" WHERE "rutaId" = ANY(%s) '
            'ORDER BY "rutaId", "orden" DESC',
            (ruta_ids,),
        )
    puntos_por_ruta: dict[str, list[dict]] = {}
    for p in cur.fetchall():
        puntos_por_ruta.setdefault(p["rutaId"], []).append(p)

    return [
        {**r, "despachos": despachos_por_ruta.get(r["id"], []), "puntos": puntos_por_ruta.get(r["id"], [])}
        for r in rutas
    ]


def _con_detalle(cur, ruta_row: dict) -> dict:
    return _con_detalle_lote(cur, [ruta_row])[0]


def _sin_trazado(cur, ruta_id: str) -> dict:
    """La ruta con sus despachos pero sin la geometria completa. Es lo que
    devuelven las acciones del viaje (iniciar, marcar llegada, marcar
    entrega): el trazado no cambia con ellas y el frontend no lo usa, pero
    en una ruta larga son cientos de kB en cada clic — se notaba como una
    demora al actualizar el mapa y los botones."""
    cur.execute('SELECT * FROM "Ruta" WHERE "id" = %s', (ruta_id,))
    return _con_detalle_lote(cur, [cur.fetchone()], geometria_completa=False)[0]


def _verificar_ruta_propia(usuario: dict, ruta: dict) -> None:
    """Un REPARTIDOR solo puede tocar la ruta de su vehiculo asignado. Se
    responde 404 (no 403) para no confirmarle que la ruta de otro existe."""
    if es_repartidor(usuario) and ruta["vehiculoId"] != vehiculo_asignado(usuario):
        raise HTTPException(404, "Ruta no encontrada")


@router.get("", response_model=list[Ruta])
def listar_rutas(usuario: dict = Depends(get_current_user)):
    """Listado: cada ruta trae solo su ultimo punto (posicion actual), no el
    trazado completo — para eso esta GET /rutas/{id}.

    Un REPARTIDOR solo ve las rutas de su vehiculo asignado (ver
    app/core/permisos.py); el resto de roles las ve todas."""
    with get_connection() as conn, conn.cursor() as cur:
        if es_repartidor(usuario):
            vehiculo_id = vehiculo_asignado(usuario)
            if not vehiculo_id:
                return []
            cur.execute(
                'SELECT * FROM "Ruta" WHERE "vehiculoId" = %s ORDER BY "fechaCreacion" DESC',
                (vehiculo_id,),
            )
        else:
            cur.execute('SELECT * FROM "Ruta" ORDER BY "fechaCreacion" DESC')
        return _con_detalle_lote(cur, cur.fetchall(), geometria_completa=False)


@router.get("/{ruta_id}", response_model=Ruta)
def obtener_ruta(ruta_id: str, usuario: dict = Depends(get_current_user)):
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute('SELECT * FROM "Ruta" WHERE "id" = %s', (ruta_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Ruta no encontrada")
        # Para un repartidor, una ruta de otro vehiculo simplemente no
        # existe: 404 y no 403, para no confirmarle que hay algo ahi.
        if es_repartidor(usuario) and row["vehiculoId"] != vehiculo_asignado(usuario):
            raise HTTPException(404, "Ruta no encontrada")
        return _con_detalle(cur, row)


@router.post(
    "/vehiculos-sugeridos",
    response_model=list[SugerenciaVehiculo],
    dependencies=[Depends(requiere_rol("DESPACHOS"))],
)
def obtener_vehiculos_sugeridos(data: SugerenciaVehiculoRequest):
    return sugerir_vehiculos(data.despachoIds)


@router.post(
    "/sugerencias",
    response_model=PlanRutasResponse,
    dependencies=[Depends(requiere_rol("DESPACHOS"))],
)
def sugerir_rutas(data: PlanRutasRequest):
    """Propone como repartir los despachos aprobados en viajes: agrupa por
    cercania entre clientes (criterio principal) usando la ruta comercial
    solo como desempate, respetando la capacidad (y la refrigeracion) de los
    vehiculos libres, y estima km, tiempo y costo de cada viaje. No crea
    nada — el usuario elige una sugerencia y la confirma con POST /rutas,
    que es donde se calcula el trazado real."""
    if data.radioMaxKm is not None and data.radioMaxKm <= 0:
        raise HTTPException(400, "El radio maximo entre paradas debe ser mayor que 0")
    return sugerir_plan_rutas(data.despachoIds, data.mezclarRutasComerciales, data.radioMaxKm)


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
            if sin_ubicacion(d["clienteLat"], d["clienteLng"]):
                raise HTTPException(
                    400,
                    f'El cliente del despacho {d["numero"]} no tiene una ubicacion valida '
                    "(faltan las coordenadas o estan en 0,0)",
                )

        cur.execute('SELECT * FROM "Almacen" WHERE "id" = %s', (ALMACEN_BASE_ID,))
        almacen = cur.fetchone()
        if not almacen:
            # Sin esta fila, mas abajo reventaba con un TypeError al leer
            # almacen["lat"] -> 500 opaco. Ver _verificar_almacen_base en
            # app/api/despachos.py.
            raise HTTPException(
                400,
                f'No existe el almacen de origen "{ALMACEN_BASE_ID}" en la base de datos. '
                "Hay que crearlo antes de poder armar rutas (ver README, seccion de datos iniciales).",
            )
        cur.execute('SELECT 1 FROM "Vehiculo" WHERE "id" = %s AND "estado" = \'FUNCIONAL\'', (data.vehiculoId,))
        if not cur.fetchone():
            raise HTTPException(400, "El vehiculo no existe o no esta funcional")

        # Un vehiculo lleva una sola ruta activa a la vez: ademas de evitar
        # mandar el mismo camion a dos viajes simultaneos, es lo que hace que
        # el repartidor asignado a ese vehiculo tenga exactamente un viaje a
        # la vista (ver app/core/permisos.py).
        cur.execute(
            'SELECT "numero" FROM "Ruta" WHERE "vehiculoId" = %s AND "estado" = ANY(%s)',
            (data.vehiculoId, ["PLANIFICADA", "EN_TRANSITO"]),
        )
        ruta_activa = cur.fetchone()
        if ruta_activa:
            raise HTTPException(
                400,
                f'Ese vehiculo ya tiene la ruta {ruta_activa["numero"]} activa. '
                "Hay que completarla o cancelarla antes de asignarle otra.",
            )

        numero = siguiente_numero(cur, "Ruta", "R", 4)
        ruta_id = f"ruta-{uuid.uuid4().hex[:10]}"
        cur.execute(
            'INSERT INTO "Ruta" '
            '("id", "numero", "vehiculoId", "origenId", "creadoPorId", "estado") '
            "VALUES (%s, %s, %s, %s, %s, 'PLANIFICADA') RETURNING *",
            (ruta_id, numero, data.vehiculoId, ALMACEN_BASE_ID, data.creadoPorId),
        )

        _calcular_y_guardar_trazado(cur, ruta_id, despachos, almacen)
        conn.commit()

        cur.execute('SELECT * FROM "Ruta" WHERE "id" = %s', (ruta_id,))
        return _con_detalle(cur, cur.fetchone())


def _calcular_y_guardar_trazado(cur, ruta_id: str, despachos: list[dict], almacen: dict) -> None:
    """Calcula el orden de visita y el trazado de una ruta, y los persiste
    (Despacho.ordenEnRuta + RutaPunto + totales de la Ruta). Se usa tanto al
    crear la ruta como al recalcularla."""
    origen = LatLng(lat=almacen["lat"], lng=almacen["lng"])
    paradas = [LatLng(lat=d["clienteLat"], lng=d["clienteLng"]) for d in despachos]
    resultado, orden, indices_parada = calcular_mejor_ruta_multi(origen, paradas)

    # El TSP devuelve solo tiempo de manejo. Al total se le suma lo que el
    # vehiculo pasa detenido entregando en cada cliente, que es la mayor
    # parte del dia de un repartidor (ver MINUTOS_POR_PARADA).
    tiempo_total_min = resultado.tiempo_min + len(despachos) * MINUTOS_POR_PARADA

    cur.execute(
        'UPDATE "Ruta" SET "distanciaTotalKm" = %s, "tiempoTotalMin" = %s WHERE "id" = %s',
        (resultado.distancia_km, tiempo_total_min, ruta_id),
    )

    for posicion, indice_despacho in enumerate(orden):
        cur.execute(
            'UPDATE "Despacho" SET "rutaId" = %s, "ordenEnRuta" = %s WHERE "id" = %s',
            (ruta_id, posicion + 1, despachos[indice_despacho]["id"]),
        )

    # indices_parada[pos] = indice (en resultado.geometry) del punto de
    # llegada de la parada visitada en la posicion `pos` de `orden`. Varios
    # despachos al mismo cliente comparten ese punto (es una sola parada
    # fisica): se marca el primero, y los demas igual se entregan por su
    # propio estado de Despacho, no por el RutaPunto.
    despacho_por_indice_geometria: dict[int, str] = {}
    for posicion, indice_geometria in enumerate(indices_parada):
        despacho_por_indice_geometria.setdefault(indice_geometria, despachos[orden[posicion]]["id"])

    # Se guarda la geometria completa que devuelve SuperMap (puede ser de
    # cientos a miles de puntos en un trayecto largo) -- reducirla aca
    # cortaria curvas reales de las calles. La cantidad de RutaPunto no es
    # un problema (el mapa ya filtra que puntos marca, ver
    # seguimiento-detalle-map.tsx); se inserta en lote para que no sea lenta
    # con geometrias grandes.
    cur.execute('DELETE FROM "RutaPunto" WHERE "rutaId" = %s', (ruta_id,))
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


@router.post(
    "/{ruta_id}/recalcular",
    response_model=Ruta,
    dependencies=[Depends(requiere_rol("DESPACHOS"))],
)
def recalcular_ruta(ruta_id: str):
    """Vuelve a calcular el orden de visita y el trazado de una ruta ya
    creada, con los despachos que tenga en ese momento. Util cuando la
    geometria guardada quedo mal (el trazado se calcula una sola vez al
    crear la ruta y queda congelado en RutaPunto)."""
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute('SELECT * FROM "Ruta" WHERE "id" = %s', (ruta_id,))
        ruta = cur.fetchone()
        if not ruta:
            raise HTTPException(404, "Ruta no encontrada")
        if ruta["estado"] not in ("PLANIFICADA", "EN_TRANSITO"):
            raise HTTPException(400, "Solo se puede recalcular una ruta planificada o en transito")

        cur.execute(
            'SELECT d.*, c."lat" AS "clienteLat", c."lng" AS "clienteLng" '
            'FROM "Despacho" d JOIN "Cliente" c ON c."id" = d."destinoClienteId" '
            'WHERE d."rutaId" = %s ORDER BY d."ordenEnRuta"',
            (ruta_id,),
        )
        despachos = cur.fetchall()
        if not despachos:
            raise HTTPException(400, "La ruta no tiene despachos asociados")
        for d in despachos:
            if sin_ubicacion(d["clienteLat"], d["clienteLng"]):
                raise HTTPException(
                    400,
                    f'El cliente del despacho {d["numero"]} no tiene una ubicacion valida '
                    "(faltan las coordenadas o estan en 0,0)",
                )

        cur.execute('SELECT * FROM "Almacen" WHERE "id" = %s', (ruta["origenId"],))
        almacen = cur.fetchone()
        if not almacen:
            raise HTTPException(400, f'No existe el almacen de origen "{ruta["origenId"]}" en la base de datos.')

        _calcular_y_guardar_trazado(cur, ruta_id, despachos, almacen)
        conn.commit()

        cur.execute('SELECT * FROM "Ruta" WHERE "id" = %s', (ruta_id,))
        return _con_detalle(cur, cur.fetchone())


@router.post("/{ruta_id}/reversar", response_model=Ruta)
def reversar_ruta(
    ruta_id: str,
    data: ReversarRutaRequest,
    # Solo ADMIN: requiere_rol deja pasar siempre a ADMIN y, al no listar
    # ningun otro rol, a nadie mas. Es un control que el cliente pidio
    # reservado a los administradores.
    usuario: dict = Depends(requiere_rol("ADMIN")),
):
    """Deshace la asignacion de una ruta: queda CANCELADA (con quien, cuando
    y por que) y sus despachos vuelven a "Aprobado" sin ruta, listos para
    armar otro viaje. El vehiculo queda libre y su repartidor deja de verla.

    Solo mientras no haya pasado nada en la calle: planificada, o en
    transito sin ninguna marca de llegada ni de entrega. Una ruta con
    entregas hechas no se reversa — eso borraria lo que ya ocurrio."""
    motivo = data.motivo.strip()
    if len(motivo) < 5:
        raise HTTPException(400, "Escribe el motivo del reverso (queda registrado en la ruta)")

    with get_connection() as conn, conn.cursor() as cur:
        # FOR UPDATE: que el repartidor no marque una llegada justo mientras
        # se esta reversando la ruta.
        cur.execute('SELECT * FROM "Ruta" WHERE "id" = %s FOR UPDATE', (ruta_id,))
        ruta = cur.fetchone()
        if not ruta:
            raise HTTPException(404, "Ruta no encontrada")
        if ruta["estado"] not in ("PLANIFICADA", "EN_TRANSITO"):
            raise HTTPException(
                400, f'La ruta {ruta["numero"]} ya esta {ruta["estado"].lower()}: solo se reversan rutas activas'
            )

        cur.execute(
            'SELECT "numero", "estado", "llegadaEn", "entregadoEn" FROM "Despacho" '
            'WHERE "rutaId" = %s ORDER BY "ordenEnRuta"',
            (ruta_id,),
        )
        despachos = cur.fetchall()
        con_marcas = [
            d["numero"] for d in despachos
            if d["llegadaEn"] or d["entregadoEn"] or d["estado"] == "ENTREGADO"
        ]
        if con_marcas:
            raise HTTPException(
                400,
                "No se puede reversar: el repartidor ya marco la llegada o la entrega en "
                f'{", ".join(con_marcas)}.',
            )

        cur.execute(
            'UPDATE "Ruta" SET "estado" = \'CANCELADA\', "canceladaEn" = %s, "canceladaPorId" = %s, '
            '"motivoCancelacion" = %s, "despachosAlCancelar" = %s WHERE "id" = %s',
            (datetime.now(), usuario["id"], motivo, Jsonb([d["numero"] for d in despachos]), ruta_id),
        )
        # El trazado ya no sirve: los despachos se van a otro viaje.
        cur.execute('DELETE FROM "RutaPunto" WHERE "rutaId" = %s', (ruta_id,))
        cur.execute(
            'UPDATE "Despacho" SET "estado" = \'APROBADO\', "rutaId" = NULL, "ordenEnRuta" = NULL '
            'WHERE "rutaId" = %s',
            (ruta_id,),
        )
        conn.commit()

        cur.execute('SELECT * FROM "Ruta" WHERE "id" = %s', (ruta_id,))
        return _con_detalle(cur, cur.fetchone())


@router.post(
    "/{ruta_id}/iniciar",
    response_model=Ruta,
    dependencies=[Depends(requiere_rol("REPARTIDOR"))],
)
def iniciar_ruta(ruta_id: str, usuario: dict = Depends(get_current_user)):
    """El despachador marca que el vehiculo salio del almacen con todos los
    despachos de la ruta a la vez."""
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute('SELECT * FROM "Ruta" WHERE "id" = %s', (ruta_id,))
        ruta = cur.fetchone()
        if not ruta:
            raise HTTPException(404, "Ruta no encontrada")
        _verificar_ruta_propia(usuario, ruta)
        if ruta["estado"] != "PLANIFICADA":
            raise HTTPException(400, "Solo se puede iniciar una ruta planificada")

        cur.execute(
            'UPDATE "Ruta" SET "estado" = \'EN_TRANSITO\', "iniciadaEn" = %s WHERE "id" = %s',
            (datetime.now(), ruta_id),
        )
        cur.execute('UPDATE "Despacho" SET "estado" = \'EN_TRANSITO\' WHERE "rutaId" = %s', (ruta_id,))
        conn.commit()

        return _sin_trazado(cur, ruta_id)


@router.post(
    "/{ruta_id}/paradas/{despacho_id}/llegada",
    response_model=Ruta,
    dependencies=[Depends(requiere_rol("REPARTIDOR"))],
)
def marcar_llegada_a_parada(ruta_id: str, despacho_id: str, usuario: dict = Depends(get_current_user)):
    """El repartidor marca que llego al cliente. Junto con la marca de
    entrega da el tiempo de atencion de esa parada, y contra la entrega
    anterior, el tiempo de traslado."""
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute('SELECT * FROM "Ruta" WHERE "id" = %s', (ruta_id,))
        ruta = cur.fetchone()
        if not ruta:
            raise HTTPException(404, "Ruta no encontrada")
        _verificar_ruta_propia(usuario, ruta)
        if ruta["estado"] != "EN_TRANSITO":
            raise HTTPException(400, "La ruta no esta en transito")

        cur.execute('SELECT * FROM "Despacho" WHERE "id" = %s AND "rutaId" = %s', (despacho_id, ruta_id))
        despacho = cur.fetchone()
        if not despacho:
            raise HTTPException(404, "El despacho no pertenece a esta ruta")
        if despacho["estado"] != "EN_TRANSITO":
            raise HTTPException(400, "Este despacho ya fue entregado (o no esta en transito)")
        if despacho["llegadaEn"] is not None:
            raise HTTPException(400, "La llegada a este cliente ya estaba marcada")

        cur.execute('UPDATE "Despacho" SET "llegadaEn" = %s WHERE "id" = %s', (datetime.now(), despacho_id))
        conn.commit()

        return _sin_trazado(cur, ruta_id)


@router.post(
    "/{ruta_id}/paradas/{despacho_id}/entregar",
    response_model=Ruta,
    dependencies=[Depends(requiere_rol("REPARTIDOR"))],
)
def marcar_parada_entregada(ruta_id: str, despacho_id: str, usuario: dict = Depends(get_current_user)):
    """El despachador marca que se entrego un despacho puntual dentro del
    viaje — no afecta a las demas paradas de la misma ruta. Cuando se
    entrega la ultima parada pendiente, la ruta pasa a COMPLETADA."""
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute('SELECT * FROM "Ruta" WHERE "id" = %s', (ruta_id,))
        ruta = cur.fetchone()
        if not ruta:
            raise HTTPException(404, "Ruta no encontrada")
        _verificar_ruta_propia(usuario, ruta)
        if ruta["estado"] != "EN_TRANSITO":
            raise HTTPException(400, "La ruta no esta en transito")

        cur.execute('SELECT * FROM "Despacho" WHERE "id" = %s AND "rutaId" = %s', (despacho_id, ruta_id))
        despacho = cur.fetchone()
        if not despacho:
            raise HTTPException(404, "El despacho no pertenece a esta ruta")
        if despacho["estado"] != "EN_TRANSITO":
            raise HTTPException(400, "Este despacho ya fue entregado (o no esta en transito)")
        # La llegada va antes que la entrega: sin las dos marcas no se puede
        # medir cuanto tardo la atencion en ese cliente, que es justo lo que
        # el negocio quiere seguir.
        if despacho["llegadaEn"] is None:
            raise HTTPException(400, "Marca primero la llegada al cliente")

        cur.execute(
            'UPDATE "Despacho" SET "estado" = \'ENTREGADO\', "entregadoEn" = %s WHERE "id" = %s',
            (datetime.now(), despacho_id),
        )
        cur.execute(
            'UPDATE "RutaPunto" SET "estado" = \'entregado\' WHERE "rutaId" = %s AND "paradaDespachoId" = %s',
            (ruta_id, despacho_id),
        )

        cur.execute(
            'SELECT COUNT(*) AS "pendientes" FROM "Despacho" WHERE "rutaId" = %s AND "estado" != \'ENTREGADO\'',
            (ruta_id,),
        )
        if cur.fetchone()["pendientes"] == 0:
            cur.execute(
                'UPDATE "Ruta" SET "estado" = \'COMPLETADA\', "completadaEn" = %s WHERE "id" = %s',
                (datetime.now(), ruta_id),
            )

        conn.commit()

        return _sin_trazado(cur, ruta_id)
