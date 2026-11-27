"""Rutas multi-parada: agrupan varios despachos ya aprobados en el viaje de
un vehiculo, con el orden de visita y el trazado calculados por
app/services/route_analysis.py (calcular_mejor_ruta_multi). El ciclo de
vida del viaje (salir del almacen, entregar parada por parada) tambien vive
aca — ver docs/PLAN.md, seccion "Rutas multi-parada"."""

from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.core.auth import get_current_user, requiere_rol
from app.core.conductor import CONDUCTOR_DEL_VEHICULO
from app.core.db import get_connection
from app.core.fechas import ahora_utc
from app.core.numero import siguiente_numero
from app.core.permisos import ROLES_DE_UN_MODULO, es_de_su_vehiculo, es_repartidor, vehiculo_asignado
from app.core.ubicacion import sin_ubicacion

from app.schemas import (
    MarcaParada,
    PlanRutasRequest,
    PlanRutasResponse,
    ReversarRutaRequest,
    Ruta,
    RutaCreate,
    RutaProgramacion,
    RutasConRelaciones,
    SalirParadasRequest,
    SugerenciaVehiculo,
    SugerenciaVehiculoRequest,
    en_utc,
)
from app.services import configuracion as cfg
from app.services.motorizados import actualizar_capacidad_motos
from app.services import morocho
from app.services import planificacion as pl
from app.services import reversos
from app.services.plan_rutas import RADIO_MAX_PERMITIDO_KM, sugerir_plan_rutas
from app.services.delivery import guardar_distancias_de_ruta
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

    # Lo que hay que resolver antes de la salida (sin vehiculo, horarios que
    # se pisan...): se calcula para todas las rutas del lote de una vez.
    avisos = pl.avisos_de(cur, rutas)
    # Las paradas que salieron sin entregarse siguen en la ruta, en rojo y con
    # su motivo (ver reversos.no_entregados_de).
    no_entregados = reversos.no_entregados_de(cur, ruta_ids)
    return [
        {
            **r,
            "despachos": despachos_por_ruta.get(r["id"], []),
            "puntos": puntos_por_ruta.get(r["id"], []),
            "avisos": avisos.get(r["id"], []),
            "noEntregados": no_entregados.get(r["id"], []),
        }
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
    if es_repartidor(usuario) and not es_de_su_vehiculo(usuario, ruta["vehiculoId"], ruta.get("vehiculoApoyoId")):
        raise HTTPException(404, "Ruta no encontrada")


def _es_moto(cur, vehiculo_id: str | None) -> bool:
    if not vehiculo_id:
        return False
    cur.execute('SELECT "tipo"::text AS "tipo" FROM "Vehiculo" WHERE "id" = %s', (vehiculo_id,))
    fila = cur.fetchone()
    return bool(fila and fila.get("tipo") == "MOTO")


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
            # Ahora puede tener varias planificadas: la proxima en salir, primero.
            # En un Morocho, la ruta tambien es del repartidor de la segunda moto.
            cur.execute(
                'SELECT * FROM "Ruta" WHERE %s IN ("vehiculoId", "vehiculoApoyoId") ORDER BY "salidaProgramada" ASC',
                (vehiculo_id,),
            )
        else:
            cur.execute('SELECT * FROM "Ruta" ORDER BY "salidaProgramada" DESC')
        return _con_detalle_lote(cur, cur.fetchall(), geometria_completa=False)


@router.get("/seguimiento/version")
def version_seguimiento(ruta: str | None = None):
    """Una huella de lo que muestra el panel de seguimiento, para que la
    pantalla se refresque sola solo cuando algo cambio.

    El panel pregunta esto cada pocos segundos: son ~50 bytes, contra los
    ~800 KB de recargar la pagina entera, que con el plan Free de Neon (5 GB
    de transferencia al mes) agotarian la cuota en un par de dias de panel
    abierto. Por eso la huella cubre solo lo que cada pantalla muestra:

    - Vista general (sin ruta): las rutas activas, su estado, vehiculo y
      numero de paradas. No las marcas de llegada y entrega, que ahi no se
      ven: si no, se recargaria con cada una (~120 al dia).
    - Detalle (con ruta): esa ruta aunque ya este cerrada, con las marcas de
      cada parada.

    Un recalculo se nota en la distancia y el tiempo de la ruta, sin mirar
    RutaPunto, que no tiene indice por ruta."""
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            WITH rutas AS (
                SELECT * FROM "Ruta"
                WHERE CASE WHEN %(ruta)s::text IS NULL THEN "estado" IN ('PLANIFICADA', 'EN_TRANSITO')
                           ELSE "id" = %(ruta)s END
            )
            SELECT md5(COALESCE(string_agg(fila, '|' ORDER BY fila), '')) AS version FROM (
                SELECT concat_ws(',', r."id", r."estado", r."vehiculoId", r."salidaProgramada", r."iniciadaEn", r."completadaEn",
                                 r."canceladaEn", r."distanciaTotalKm", r."tiempoTotalMin",
                                 (SELECT COUNT(*) FROM "Despacho" d WHERE d."rutaId" = r."id")) AS fila
                FROM rutas r
                UNION ALL
                SELECT concat_ws(',', d."id", d."estado", d."ordenEnRuta", d."salidaEn", d."llegadaEn", d."entregadoEn")
                FROM "Despacho" d
                WHERE %(ruta)s::text IS NOT NULL AND d."rutaId" = %(ruta)s
            ) t
            """,
            {"ruta": ruta},
        )
        return {"version": cur.fetchone()["version"]}


# ---------- Seguimiento en vivo (app movil) ----------
#
# La posicion real de cada repartidor con la jornada abierta, la que manda la
# app en segundo plano (ver app/services/jornadas.py). El mapa la pide sola
# cada pocos segundos: son unos cientos de bytes, sin recargar la pagina (que
# vuelve a leer el trazado de todas las rutas).
#
# Ojo con el orden: /seguimiento/repartidores, /seguimiento/sin-senal y
# /activas/con-relaciones van ANTES de /{ruta_id}/con-relaciones,
# /{ruta_id}/recorrido y /{ruta_id}.

MINUTOS_SIN_SENAL = 10
PUNTOS_MAXIMOS_RECORRIDO = 1500


@router.get("/seguimiento/repartidores", dependencies=[Depends(requiere_rol("DESPACHOS", "APROBADOR"))])
def repartidores_en_vivo():
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT u."id" AS "usuarioId", u."nombre", u."telefono", v."placa" AS "vehiculoPlaca",
                   j."iniciadaEn" AS "jornadaDesde", up."lat", up."lng", up."bateria", up."tomadaEn",
                   r."id" AS "rutaId", r."numero" AS "rutaNumero"
            FROM "Jornada" j
            JOIN "Usuario" u ON u."id" = j."usuarioId"
            LEFT JOIN "Vehiculo" v ON v."id" = COALESCE(j."vehiculoId", u."vehiculoAsignadoId")
            LEFT JOIN "UltimaPosicion" up ON up."usuarioId" = u."id" AND up."jornadaId" = j."id"
            LEFT JOIN LATERAL (
                SELECT x."id", x."numero" FROM "Ruta" x
                WHERE v."id" IN (x."vehiculoId", x."vehiculoApoyoId") AND x."estado" = 'EN_TRANSITO'
                ORDER BY x."iniciadaEn" DESC LIMIT 1
            ) r ON true
            WHERE j."terminadaEn" IS NULL AND j."iniciadaEn" > now() - interval '16 hours'
            ORDER BY u."nombre"
            """
        )
        filas = cur.fetchall()
    ahora = ahora_utc()
    salida = []
    for f in filas:
        minutos = round((ahora - f["tomadaEn"]).total_seconds() / 60) if f["tomadaEn"] else None
        # Sin ningun punto todavia, se cuenta desde que abrio la jornada: el
        # primer lote tarda un par de minutos en llegar y no es "sin señal".
        sin_puntos = round((ahora - f["jornadaDesde"]).total_seconds() / 60)
        sin_senal = (minutos if minutos is not None else sin_puntos) > MINUTOS_SIN_SENAL
        # Solo lo que la pagina muestra: el que va en una ruta en transito y
        # el que dejo de enviar (el resto no se dibuja en ningun lado).
        if not f["rutaId"] and not sin_senal:
            continue
        salida.append({
            **f,
            "jornadaDesde": en_utc(f["jornadaDesde"]),
            "tomadaEn": en_utc(f["tomadaEn"]) if f["tomadaEn"] else None,
            "minutosDesdeUltimo": minutos,
            "sinSenal": sin_senal,
        })
    return {"repartidores": salida, "minutosSinSenal": MINUTOS_SIN_SENAL}


@router.get("/seguimiento/sin-senal", dependencies=[Depends(requiere_rol("DESPACHOS", "APROBADOR"))])
def cuantos_sin_senal():
    """Cuantos repartidores con la jornada abierta dejaron de enviar su
    ubicacion. Para el numero del menu: cada pestaña abierta lo pide cada
    minuto, asi que es un conteo en la base y no la lista (con 100
    repartidores la lista pesa ~40 KB; esto, unos bytes)."""
    ahora = ahora_utc()
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT COUNT(*) AS "n"
            FROM "Jornada" j
            LEFT JOIN "UltimaPosicion" up ON up."usuarioId" = j."usuarioId" AND up."jornadaId" = j."id"
            WHERE j."terminadaEn" IS NULL AND j."iniciadaEn" > %(desde)s
              AND COALESCE(up."tomadaEn", j."iniciadaEn") < %(limite)s
            """,
            # La misma regla que repartidores_en_vivo (minutos redondeados > MINUTOS_SIN_SENAL).
            {"desde": ahora - timedelta(hours=16), "limite": ahora - timedelta(minutes=MINUTOS_SIN_SENAL + 0.5)},
        )
        return {"sinSenal": cur.fetchone()["n"], "minutosSinSenal": MINUTOS_SIN_SENAL}


# ---------- Rutas con sus relaciones, en una sola llamada ----------
#
# El detalle y las vistas de rutas activas necesitan la ruta mas los
# almacenes, clientes, usuarios y vehiculos que usa. Antes el frontend
# armaba eso pidiendo las listas COMPLETAS de cada tabla (4-7 llamadas por
# pagina, cada una trayendo filas que no se usaban). Estos endpoints
# devuelven solo lo relacionado: menos llamadas y menos datos por llamada,
# que es lo que cobra el plan gratis de Vercel (aviso de CPU, 2026-11-12/16).
#
# Ojo con el orden: /activas/con-relaciones va ANTES de
# /{ruta_id}/con-relaciones; si no, "activas" se tomaria como el id de una
# ruta.


def _relaciones_de_rutas(cur, usuario: dict, rutas: list[dict]) -> dict:
    """Solo los almacenes, clientes, usuarios y vehiculos que esas rutas
    usan, respetando lo que cada rol puede ver (mismo criterio que
    GET /clientes, /usuarios y /vehiculos)."""
    almacen_ids = [r["origenId"] for r in rutas]
    vehiculo_ids = list(
        {r["vehiculoId"] for r in rutas if r["vehiculoId"]}
        | {r["vehiculoApoyoId"] for r in rutas if r.get("vehiculoApoyoId")}
    )
    cliente_ids = list({d["destinoClienteId"] for r in rutas for d in r["despachos"]})

    cur.execute('SELECT * FROM "Almacen" WHERE "id" = ANY(%s::text[])', (almacen_ids,))
    almacenes = cur.fetchall()

    # Las rutas ya vienen filtradas por rol, asi que sus clientes y
    # vehiculos relacionados son justo los que el usuario podia pedir por
    # los endpoints de lista (un repartidor: los de su vehiculo).
    cur.execute('SELECT * FROM "Cliente" WHERE "id" = ANY(%s::text[]) ORDER BY "nombre"', (cliente_ids,))
    clientes = cur.fetchall()

    cur.execute(
        f'SELECT v.*, {CONDUCTOR_DEL_VEHICULO} AS "conductor" FROM "Vehiculo" v '
        'WHERE v."id" = ANY(%s::text[]) ORDER BY v."placa"',
        (vehiculo_ids,),
    )
    vehiculos = cur.fetchall()

    if es_repartidor(usuario) or usuario["rol"] in ROLES_DE_UN_MODULO:
        # Igual que GET /usuarios: estos roles no ven el directorio, solo su
        # propia ficha (para un repartidor alcanza: el conductor es el).
        cur.execute('SELECT * FROM "Usuario" WHERE "id" = %s', (usuario["id"],))
    else:
        # Quien creo o cancelo cada ruta, mas los repartidores asignados a
        # los vehiculos usados (de ahi sale el nombre del conductor).
        usuario_ids = list(
            {r["creadoPorId"] for r in rutas}
            | {r["canceladaPorId"] for r in rutas if r.get("canceladaPorId")}
        )
        cur.execute(
            'SELECT * FROM "Usuario" WHERE "id" = ANY(%s::text[]) OR "vehiculoAsignadoId" = ANY(%s::text[]) '
            'ORDER BY "nombre"',
            (usuario_ids, vehiculo_ids),
        )
    usuarios = cur.fetchall()

    return {"almacenes": almacenes, "clientes": clientes, "usuarios": usuarios, "vehiculos": vehiculos}


@router.get("/activas/con-relaciones", response_model=RutasConRelaciones)
def rutas_activas_con_relaciones(usuario: dict = Depends(get_current_user)):
    """Las rutas activas (PLANIFICADA y EN_TRANSITO) con solo las relaciones
    que usan. Cada ruta trae solo su ultimo punto, como en GET /rutas.

    Un REPARTIDOR solo ve las de su vehiculo asignado."""
    vacio = {"rutas": [], "almacenes": [], "clientes": [], "usuarios": [], "vehiculos": []}
    with get_connection() as conn, conn.cursor() as cur:
        if es_repartidor(usuario):
            vehiculo_id = vehiculo_asignado(usuario)
            if not vehiculo_id:
                return vacio
            cur.execute(
                'SELECT * FROM "Ruta" WHERE "estado" IN (%s, %s) AND %s IN ("vehiculoId", "vehiculoApoyoId") '
                'ORDER BY "salidaProgramada" ASC',
                ("PLANIFICADA", "EN_TRANSITO", vehiculo_id),
            )
        else:
            cur.execute(
                'SELECT * FROM "Ruta" WHERE "estado" IN (%s, %s) ORDER BY "salidaProgramada" DESC',
                ("PLANIFICADA", "EN_TRANSITO"),
            )
        rutas = _con_detalle_lote(cur, cur.fetchall(), geometria_completa=False)
        return {"rutas": rutas, **_relaciones_de_rutas(cur, usuario, rutas)}


# ---------- Planificacion: agenda y configuracion ----------
#
# Van antes de /{ruta_id}: si no, "agenda" y "configuracion" se tomarian
# como el id de una ruta.

_DESFASE_CARACAS = timedelta(hours=-4)  # Caracas = UTC-4 fijo (ver app/core/fechas.py)
DIAS_MAXIMOS_AGENDA = 62


def _medianoche_utc(dia: date) -> datetime:
    """El comienzo de un dia de Caracas, en UTC sin zona (como en la base)."""
    return datetime.combine(dia, datetime.min.time()) - _DESFASE_CARACAS


def _ruta_de_agenda(ruta: dict, pedidos: list[dict], avisos: list[dict], libres: list[str] | None) -> dict:
    return {
        "id": ruta["id"],
        "numero": ruta["numero"],
        "estado": ruta["estado"],
        "salidaProgramada": en_utc(ruta["salidaProgramada"]),
        "iniciadaEn": en_utc(ruta["iniciadaEn"]) if ruta["iniciadaEn"] else None,
        "completadaEn": en_utc(ruta["completadaEn"]) if ruta["completadaEn"] else None,
        "tiempoTotalMin": ruta["tiempoTotalMin"],
        "distanciaTotalKm": ruta["distanciaTotalKm"],
        "vehiculoId": ruta["vehiculoId"],
        "vehiculoApoyoId": ruta["vehiculoApoyoId"],
        "pedidos": pedidos,
        "pesoKg": round(sum(p["pesoKg"] for p in pedidos), 1),
        "avisos": avisos,
        "vehiculosLibres": libres,
    }


@router.get("/agenda", dependencies=[Depends(requiere_rol("DESPACHOS", "APROBADOR"))])
def agenda(desde: date, hasta: date):
    """Las rutas que salen entre `desde` y `hasta` (dias de Caracas), mas las
    planificadas que ya debian haber salido antes: una ruta atrasada no puede
    desaparecer de la vista por haber quedado en un dia anterior. Cada ruta
    trae sus pedidos, sus avisos y los vehiculos libres en su horario."""
    if hasta < desde:
        raise HTTPException(400, "La fecha hasta no puede ser anterior a la fecha desde")
    if (hasta - desde).days > DIAS_MAXIMOS_AGENDA:
        raise HTTPException(400, f"La agenda abarca como maximo {DIAS_MAXIMOS_AGENDA} dias")
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            'SELECT * FROM "Ruta" WHERE "estado" <> %s AND "salidaProgramada" >= %s AND "salidaProgramada" < %s '
            'ORDER BY "salidaProgramada"',
            ("CANCELADA", _medianoche_utc(desde), _medianoche_utc(hasta + timedelta(days=1))),
        )
        en_rango = cur.fetchall()
        cur.execute(
            'SELECT * FROM "Ruta" WHERE "estado" = %s AND "salidaProgramada" < %s ORDER BY "salidaProgramada"',
            ("PLANIFICADA", _medianoche_utc(desde)),
        )
        atrasadas = cur.fetchall()
        rutas = en_rango + atrasadas

        pedidos: dict[str, list[dict]] = {}
        if rutas:
            cur.execute(
                'SELECT d."rutaId", d."id", d."numero", d."numeroDocumento", d."tipoDocumento", d."estado", '
                'c."codigo" AS "codigoCliente", c."nombre" AS "cliente", c."ciudad", '
                'COALESCE(SUM(i."cantidad" * i."pesoUnitarioKg"), 0)::float AS "pesoKg" '
                'FROM "Despacho" d JOIN "Cliente" c ON c."id" = d."destinoClienteId" '
                'LEFT JOIN "DespachoItem" i ON i."despachoId" = d."id" '
                'WHERE d."rutaId" = ANY(%s) '
                'GROUP BY d."rutaId", d."id", d."numero", d."numeroDocumento", d."tipoDocumento", d."estado", '
                'c."codigo", c."nombre", c."ciudad", d."ordenEnRuta" '
                'ORDER BY d."rutaId", d."ordenEnRuta"',
                ([r["id"] for r in rutas],),
            )
            for p in cur.fetchall():
                pedidos.setdefault(p.pop("rutaId"), []).append(p)
        avisos = pl.avisos_de(cur, rutas)
        libres = pl.libres_por_ruta(cur, [r for r in rutas if r["estado"] == "PLANIFICADA"])
        cur.execute(
            f'SELECT v."id", v."placa", v."tipo", v."capacidadKg", v."tieneRefrigeracion", v."estado", '
            f'{CONDUCTOR_DEL_VEHICULO} AS "conductor" FROM "Vehiculo" v ORDER BY v."placa"'
        )
        vehiculos = cur.fetchall()

    def armar(lista: list[dict]) -> list[dict]:
        return [_ruta_de_agenda(r, pedidos.get(r["id"], []), avisos.get(r["id"], []), libres.get(r["id"])) for r in lista]

    return {
        "desde": desde,
        "hasta": hasta,
        "rutas": armar(en_rango),
        "atrasadas": armar(atrasadas),
        "vehiculos": vehiculos,
    }


class ValorAjuste(BaseModel):
    valor: float


@router.get("/configuracion", dependencies=[Depends(requiere_rol("DESPACHOS", "APROBADOR"))])
def configuracion_rutas():
    """Los ajustes de la planificacion (p. ej. la distancia maxima de las motos)."""
    with get_connection() as conn, conn.cursor() as cur:
        return [{**a, "actualizadoEn": en_utc(a["actualizadoEn"]) if a["actualizadoEn"] else None} for a in cfg.todos(cur)]


@router.put("/configuracion/{clave}")
def guardar_configuracion(clave: str, data: ValorAjuste, usuario: dict = Depends(requiere_rol("ADMIN"))):
    """Cambia un ajuste. Solo ADMIN."""
    if clave not in cfg.AJUSTES or cfg.AJUSTES[clave]["grupo"] != "planificacion":
        raise HTTPException(404, "Ajuste desconocido")
    with get_connection() as conn, conn.cursor() as cur:
        try:
            cfg.guardar(cur, clave, data.valor, usuario["id"])
            if clave == "motoCapacidadKg":
                # El bolso es el mismo para todos: la moto de cada motorizado
                # toma la capacidad nueva.
                actualizar_capacidad_motos(cur, data.valor)
        except ValueError as e:
            raise HTTPException(422, str(e)) from e
        conn.commit()
        return [{**a, "actualizadoEn": en_utc(a["actualizadoEn"]) if a["actualizadoEn"] else None} for a in cfg.todos(cur)]


@router.get("/{ruta_id}/con-relaciones", response_model=RutasConRelaciones)
def ruta_con_relaciones(ruta_id: str, usuario: dict = Depends(get_current_user)):
    """Una ruta (con el trazado completo, como GET /rutas/{id}) mas solo las
    relaciones que usa, en una sola llamada."""
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute('SELECT * FROM "Ruta" WHERE "id" = %s FOR UPDATE', (ruta_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Ruta no encontrada")
        # Mismo criterio que GET /rutas/{id}: para un repartidor, la ruta de
        # otro vehiculo es un 404, no un 403.
        if es_repartidor(usuario) and not es_de_su_vehiculo(usuario, row["vehiculoId"], row.get("vehiculoApoyoId")):
            raise HTTPException(404, "Ruta no encontrada")
        ruta = _con_detalle(cur, row)
        return {"rutas": [ruta], **_relaciones_de_rutas(cur, usuario, [ruta])}


@router.get("/{ruta_id}/recorrido", dependencies=[Depends(requiere_rol("DESPACHOS", "APROBADOR"))])
def recorrido_real(ruta_id: str):
    """Por donde paso de verdad el vehiculo en esta ruta (los puntos de la
    app), aligerado a PUNTOS_MAXIMOS_RECORRIDO."""
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute('SELECT COUNT(*) AS "n" FROM "Posicion" WHERE "rutaId" = %s', (ruta_id,))
        total = cur.fetchone()["n"]
        paso = max(1, -(-total // PUNTOS_MAXIMOS_RECORRIDO))
        cur.execute(
            'SELECT "lat", "lng", "tomadaEn" FROM (SELECT *, row_number() OVER (ORDER BY "tomadaEn") AS n '
            'FROM "Posicion" WHERE "rutaId" = %s) t WHERE (n - 1) %% %s = 0 ORDER BY "tomadaEn"',
            (ruta_id, paso),
        )
        puntos = [{"lat": f["lat"], "lng": f["lng"], "tomadaEn": en_utc(f["tomadaEn"])} for f in cur.fetchall()]
        # La ultima señal tal cual (el aligerado puede saltarsela), con quien
        # la mando y su bateria, para el "ahora" del detalle.
        cur.execute(
            'SELECT p."lat", p."lng", p."tomadaEn", p."bateria", p."precisionM", u."nombre" AS "repartidor" '
            'FROM "Posicion" p JOIN "Usuario" u ON u."id" = p."usuarioId" '
            'WHERE p."rutaId" = %s ORDER BY p."tomadaEn" DESC LIMIT 1',
            (ruta_id,),
        )
        u = cur.fetchone()
        # En transito, la ultima posicion de la jornada del repartidor de ese
        # vehiculo si es mas nueva: recien iniciada la ruta todavia no llego
        # ningun punto "de la ruta" (la app los manda en lotes), pero la
        # oficina ya debe verlo donde esta.
        cur.execute('SELECT "estado"::text AS "estado", "vehiculoId", "vehiculoApoyoId" FROM "Ruta" WHERE "id" = %s',
                    (ruta_id,))
        ruta = cur.fetchone()
        if ruta and ruta["estado"] == "EN_TRANSITO":
            vehiculos = [v for v in (ruta["vehiculoId"], ruta["vehiculoApoyoId"]) if v]
            cur.execute(
                'SELECT up."lat", up."lng", up."tomadaEn", up."bateria", up."precisionM", u."nombre" AS "repartidor" '
                'FROM "UltimaPosicion" up '
                'JOIN "Jornada" j ON j."id" = up."jornadaId" AND j."terminadaEn" IS NULL '
                'JOIN "Usuario" u ON u."id" = up."usuarioId" '
                'WHERE COALESCE(j."vehiculoId", u."vehiculoAsignadoId") = ANY(%s) '
                'ORDER BY up."tomadaEn" DESC LIMIT 1',
                (vehiculos,),
            )
            de_jornada = cur.fetchone()
            if de_jornada and (not u or de_jornada["tomadaEn"] > u["tomadaEn"]):
                u = de_jornada
    ultima = None
    if u:
        minutos = max(0, round((ahora_utc() - u["tomadaEn"]).total_seconds() / 60))
        ultima = {
            "lat": u["lat"],
            "lng": u["lng"],
            "tomadaEn": en_utc(u["tomadaEn"]),
            "bateria": u["bateria"],
            "precisionM": u["precisionM"],
            "repartidor": u["repartidor"],
            "minutosDesdeUltimo": minutos,
            "sinSenal": minutos > MINUTOS_SIN_SENAL,
        }
    return {"puntos": puntos, "total": total, "ultima": ultima}


@router.get("/{ruta_id}", response_model=Ruta)
def obtener_ruta(ruta_id: str, usuario: dict = Depends(get_current_user)):
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute('SELECT * FROM "Ruta" WHERE "id" = %s FOR UPDATE', (ruta_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Ruta no encontrada")
        # Para un repartidor, una ruta de otro vehiculo simplemente no
        # existe: 404 y no 403, para no confirmarle que hay algo ahi.
        if es_repartidor(usuario) and not es_de_su_vehiculo(usuario, row["vehiculoId"], row.get("vehiculoApoyoId")):
            raise HTTPException(404, "Ruta no encontrada")
        return _con_detalle(cur, row)


@router.post(
    "/vehiculos-sugeridos",
    response_model=list[SugerenciaVehiculo],
    dependencies=[Depends(requiere_rol("DESPACHOS"))],
)
def obtener_vehiculos_sugeridos(data: SugerenciaVehiculoRequest):
    return sugerir_vehiculos(data.despachoIds, data.salidaProgramada, data.rutaId)


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
    if data.radioMaxKm is not None and not 0 < data.radioMaxKm <= RADIO_MAX_PERMITIDO_KM:
        raise HTTPException(
            400, f"La distancia maxima entre paradas debe estar entre 0 y {RADIO_MAX_PERMITIDO_KM:g} km"
        )
    return sugerir_plan_rutas(
        data.despachoIds,
        data.mezclarRutasComerciales,
        data.radioMaxKm,
        data.salidaProgramada,
        priorizar_motos=data.priorizarMotos,
        solo_motos=data.soloMotos,
    )


@router.post("", response_model=Ruta, status_code=201)
def crear_ruta(data: RutaCreate, usuario: dict = Depends(requiere_rol("DESPACHOS"))):
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
        # El vehiculo es opcional y nada de el bloquea la planificacion
        # (pedido del cliente, ver app/services/planificacion.py): ni que este
        # en mantenimiento ni que ya tenga otra ruta. Eso sale como aviso en
        # la ruta. Solo tiene que existir.
        if data.vehiculoId is not None:
            cur.execute('SELECT 1 FROM "Vehiculo" WHERE "id" = %s', (data.vehiculoId,))
            if not cur.fetchone():
                raise HTTPException(400, "El vehiculo no existe")
        # Morocho: dos motos distintas y un solo cliente (ver app/services/morocho.py).
        morocho.validar_apoyo(cur, data.vehiculoId, data.vehiculoApoyoId)
        morocho.validar_un_cliente(data.vehiculoApoyoId, {d["destinoClienteId"] for d in despachos})

        numero = siguiente_numero(cur, "Ruta", "R", 4)
        ruta_id = f"ruta-{uuid.uuid4().hex[:10]}"
        salida = data.salidaProgramada.astimezone(timezone.utc).replace(tzinfo=None)
        cur.execute(
            'INSERT INTO "Ruta" '
            '("id", "numero", "vehiculoId", "vehiculoApoyoId", "origenId", "creadoPorId", "estado", '
            '"salidaProgramada") VALUES (%s, %s, %s, %s, %s, %s, \'PLANIFICADA\', %s) RETURNING *',
            (ruta_id, numero, data.vehiculoId, data.vehiculoApoyoId, ALMACEN_BASE_ID, usuario["id"], salida),
        )

        _calcular_y_guardar_trazado(cur, ruta_id, despachos, almacen)
        # Si es una moto, se dejan calculadas las distancias almacen->cliente
        # que usa el pago de delivery (ver app/services/delivery.py): asi el
        # reporte de pagos no depende del servicio de rutas en el momento.
        guardar_distancias_de_ruta(cur, ruta_id)
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

    # Se guarda la geometria completa que devuelve la red vial (puede ser de
    # cientos a miles de puntos en un trayecto largo) -- reducirla aca
    # cortaria curvas reales de las calles. La cantidad de RutaPunto no es
    # un problema (el mapa ya filtra que puntos marca, ver
    # seguimiento-detalle-map.tsx); se inserta en lote para que no sea lenta
    # con geometrias grandes.
    cur.execute('DELETE FROM "RutaPunto" WHERE "rutaId" = %s', (ruta_id,))
    ahora = ahora_utc()
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
        cur.execute('SELECT * FROM "Ruta" WHERE "id" = %s FOR UPDATE', (ruta_id,))
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
        # Si es una moto, se dejan calculadas las distancias almacen->cliente
        # que usa el pago de delivery (ver app/services/delivery.py): asi el
        # reporte de pagos no depende del servicio de rutas en el momento.
        guardar_distancias_de_ruta(cur, ruta_id)
        conn.commit()

        cur.execute('SELECT * FROM "Ruta" WHERE "id" = %s', (ruta_id,))
        return _con_detalle(cur, cur.fetchone())


@router.patch("/{ruta_id}/programacion", response_model=Ruta, dependencies=[Depends(requiere_rol("DESPACHOS"))])
def programar_ruta(ruta_id: str, data: RutaProgramacion):
    """Reprograma la salida de una ruta planificada y/o le cambia el
    vehiculo (vehiculoId en null se lo quita, y tambien la segunda moto de un
    Morocho; vehiculoApoyoId en null deja de ser Morocho). Como al crearla, nada de esto
    bloquea: los conflictos vuelven como avisos en la respuesta."""
    cambios = data.model_fields_set
    if not cambios:
        raise HTTPException(400, "No hay nada que cambiar")
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute('SELECT * FROM "Ruta" WHERE "id" = %s FOR UPDATE', (ruta_id,))
        ruta = cur.fetchone()
        if not ruta:
            raise HTTPException(404, "Ruta no encontrada")
        if ruta["estado"] != "PLANIFICADA":
            raise HTTPException(400, "Solo se puede reprogramar una ruta planificada (que todavia no salio)")
        if "salidaProgramada" in cambios:
            if data.salidaProgramada is None:
                raise HTTPException(400, "La salida programada no puede quedar vacia")
            cur.execute(
                'UPDATE "Ruta" SET "salidaProgramada" = %s WHERE "id" = %s',
                (data.salidaProgramada.astimezone(timezone.utc).replace(tzinfo=None), ruta_id),
            )
        if "vehiculoId" in cambios or "vehiculoApoyoId" in cambios:
            principal = data.vehiculoId if "vehiculoId" in cambios else ruta["vehiculoId"]
            # Sin moto principal no hay Morocho; cambiar la principal sin decir
            # nada de la segunda la conserva.
            apoyo = data.vehiculoApoyoId if "vehiculoApoyoId" in cambios else ruta["vehiculoApoyoId"]
            if principal is None:
                apoyo = None
            if principal is not None:
                cur.execute('SELECT 1 FROM "Vehiculo" WHERE "id" = %s', (principal,))
                if not cur.fetchone():
                    raise HTTPException(400, "El vehiculo no existe")
            morocho.validar_apoyo(cur, principal, apoyo)
            if apoyo is not None:
                cur.execute('SELECT DISTINCT "destinoClienteId" FROM "Despacho" WHERE "rutaId" = %s', (ruta_id,))
                morocho.validar_un_cliente(apoyo, {r["destinoClienteId"] for r in cur.fetchall()})
            cur.execute(
                'UPDATE "Ruta" SET "vehiculoId" = %s, "vehiculoApoyoId" = %s WHERE "id" = %s',
                (principal, apoyo, ruta_id),
            )
            # Si ahora es una moto, se dejan listas las distancias del pago de
            # delivery (como al crear una ruta de moto).
            guardar_distancias_de_ruta(cur, ruta_id)
        conn.commit()
        cur.execute('SELECT * FROM "Ruta" WHERE "id" = %s', (ruta_id,))
        return _con_detalle(cur, cur.fetchone())


@router.post("/{ruta_id}/reversar", response_model=Ruta)
def reversar_ruta(
    ruta_id: str,
    data: ReversarRutaRequest,
    usuario: dict = Depends(requiere_rol("DESPACHOS")),
):
    """Cancela una ruta activa (el camion se accidento, el viaje no sale...):
    queda CANCELADA con quien, cuando y por que, y sus despachos sin entregar
    vuelven a "Aprobado" sin ruta, listos para armar otro viaje. El vehiculo
    queda libre y su repartidor deja de verla.

    Lo ya entregado se queda en la ruta con sus marcas (y se le paga al
    motorizado): solo se deshace lo que no ocurrio."""
    motivo = reversos.motivo_valido(data.motivo)
    with get_connection() as conn, conn.cursor() as cur:
        ruta = reversos.ruta_activa_bloqueada(cur, ruta_id)
        _cancelar_con_pendientes(cur, ruta, usuario["id"], motivo, "RUTA")
        conn.commit()

        cur.execute('SELECT * FROM "Ruta" WHERE "id" = %s', (ruta_id,))
        return _con_detalle(cur, cur.fetchone())


def _cancelar_con_pendientes(cur, ruta: dict, usuario_id: str, motivo: str, alcance: str) -> None:
    """Cancela la ruta (ya bloqueada) y devuelve a "Aprobado" lo que no se
    entrego; lo entregado se queda en ella."""
    cur.execute(
        'SELECT "id", "numero", "estado", "llegadaEn", "ordenEnRuta" FROM "Despacho" WHERE "rutaId" = %s '
        'ORDER BY "ordenEnRuta"',
        (ruta["id"],),
    )
    despachos = cur.fetchall()
    pendientes = [d for d in despachos if d["estado"] != "ENTREGADO"]
    if not pendientes:
        raise HTTPException(400, f'Todas las paradas de la ruta {ruta["numero"]} ya se entregaron')

    reversos.liberar(cur, ruta["id"], pendientes, usuario_id, motivo, alcance)
    reversos.cancelar_ruta(cur, ruta, usuario_id, motivo, pendientes, hubo_entregas=len(pendientes) < len(despachos))


@router.post(
    "/{ruta_id}/no-completada",
    response_model=Ruta,
    dependencies=[Depends(requiere_rol("REPARTIDOR"))],
)
def marcar_ruta_no_completada(ruta_id: str, data: ReversarRutaRequest, usuario: dict = Depends(get_current_user)):
    """El repartidor no puede seguir el viaje (se accidento, se dano la
    moto...), aunque ya haya entregado algo: la ruta se cancela con su
    motivo, como la reversa la oficina, y lo que no entrego vuelve a
    "Aprobado" para otro viaje. Lo entregado se queda y se le paga. Cuenta en
    sus "No entregados" (ver reportes.py), igual que cada parada que no
    entrega; si lo hace un ADMIN desde esta pantalla, cuenta como de la
    oficina."""
    motivo = reversos.motivo_valido(data.motivo)
    with get_connection() as conn, conn.cursor() as cur:
        ruta = reversos.ruta_activa_bloqueada(cur, ruta_id)
        _verificar_ruta_propia(usuario, ruta)
        if ruta["estado"] != "EN_TRANSITO":
            raise HTTPException(400, "La ruta no esta en transito")
        _cancelar_con_pendientes(cur, ruta, usuario["id"], motivo, "REPARTIDOR" if es_repartidor(usuario) else "RUTA")
        conn.commit()

        return _sin_trazado(cur, ruta_id)


@router.post(
    "/{ruta_id}/paradas/{despacho_id}/no-entregado",
    response_model=Ruta,
    dependencies=[Depends(requiere_rol("REPARTIDOR"))],
)
def marcar_parada_no_entregada(
    ruta_id: str, despacho_id: str, data: ReversarRutaRequest, usuario: dict = Depends(get_current_user)
):
    """El repartidor no pudo entregar una parada (cliente cerrado, no lo
    recibio...): sale de la ruta y vuelve a "Aprobado" para otro viaje, con
    su motivo. Cuenta en el rendimiento del repartidor (ver reportes.py)."""
    motivo = reversos.motivo_valido(data.motivo)
    with get_connection() as conn, conn.cursor() as cur:
        ruta = reversos.ruta_activa_bloqueada(cur, ruta_id)
        _verificar_ruta_propia(usuario, ruta)
        if ruta["estado"] != "EN_TRANSITO":
            raise HTTPException(400, "La ruta no esta en transito")

        cur.execute(
            'SELECT "id", "numero", "estado", "llegadaEn", "ordenEnRuta" FROM "Despacho" WHERE "id" = %s AND "rutaId" = %s',
            (despacho_id, ruta_id),
        )
        despacho = cur.fetchone()
        if not despacho:
            raise HTTPException(404, "El despacho no pertenece a esta ruta")
        if despacho["estado"] != "EN_TRANSITO":
            raise HTTPException(400, "Este despacho ya fue entregado (o no esta en transito)")

        reversos.liberar(cur, ruta_id, [despacho], usuario["id"], motivo, "REPARTIDOR")
        reversos.cerrar_ruta_si_corresponde(cur, ruta, usuario["id"], motivo, [despacho])
        conn.commit()

        return _sin_trazado(cur, ruta_id)


# Una marca que se hizo sin senal llega despues: la app manda cuanto paso
# desde que se toco el boton (medido en el telefono, sin depender de su
# reloj), con un tope de un dia. Nunca queda antes de `desde` (la salida de la
# ruta o la llegada al cliente).
TOPE_MARCA_DIFERIDA = timedelta(days=1)


def _instante_marca(data: MarcaParada | None, desde: datetime | None = None) -> datetime:
    ahora = ahora_utc()
    instante = ahora
    if data and data.haceSegundos:
        instante = ahora - min(timedelta(seconds=data.haceSegundos), TOPE_MARCA_DIFERIDA)
    if desde and instante < desde:
        instante = desde
    return instante


def _ubicacion_marca(data: MarcaParada | None) -> tuple[float | None, float | None]:
    if data and data.lat is not None and data.lng is not None:
        return data.lat, data.lng
    return None, None


@router.post(
    "/{ruta_id}/iniciar",
    response_model=Ruta,
    dependencies=[Depends(requiere_rol("REPARTIDOR"))],
)
def iniciar_ruta(ruta_id: str, data: MarcaParada | None = None, usuario: dict = Depends(get_current_user)):
    """El despachador marca que el vehiculo salio del almacen con todos los
    despachos de la ruta a la vez."""
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute('SELECT * FROM "Ruta" WHERE "id" = %s FOR UPDATE', (ruta_id,))
        ruta = cur.fetchone()
        if not ruta:
            raise HTTPException(404, "Ruta no encontrada")
        _verificar_ruta_propia(usuario, ruta)
        if ruta["estado"] != "PLANIFICADA":
            raise HTTPException(400, "Solo se puede iniciar una ruta planificada")
        # Planificar no bloquea; salir si: lo fisicamente imposible se frena
        # aca (ver app/services/planificacion.py).
        if not ruta["vehiculoId"]:
            raise HTTPException(400, "La ruta no tiene vehiculo asignado: hay que asignarle uno antes de salir")

        es_moto = _es_moto(cur, ruta["vehiculoId"])
        if not es_moto:
            propios = [v for v in (ruta["vehiculoId"], ruta["vehiculoApoyoId"]) if v]
            cur.execute(
                'SELECT "numero" FROM "Ruta" WHERE ("vehiculoId" = ANY(%s) OR "vehiculoApoyoId" = ANY(%s)) '
                'AND "estado" = %s AND "id" <> %s',
                (propios, propios, "EN_TRANSITO", ruta_id),
            )
            en_camino = cur.fetchone()
            if en_camino:
                raise HTTPException(
                    400,
                    f'El vehiculo esta haciendo la ruta {en_camino["numero"]}: hay que terminarla antes de salir con esta',
                )

        instante = _instante_marca(data)
        cur.execute(
            'UPDATE "Ruta" SET "estado" = \'EN_TRANSITO\', "iniciadaEn" = %s WHERE "id" = %s',
            (instante, ruta_id),
        )
        if es_moto:
            tanda_id = f"tanda-{uuid.uuid4().hex[:8]}"
            lat, lng = _ubicacion_marca(data)
            cur.execute(
                'UPDATE "Despacho" SET "estado" = \'EN_TRANSITO\', "salidaEn" = %s, "tandaSalida" = %s, '
                '"salidaLat" = %s, "salidaLng" = %s WHERE "rutaId" = %s AND "estado" <> \'ENTREGADO\'',
                (instante, tanda_id, lat, lng, ruta_id),
            )
        else:
            cur.execute('UPDATE "Despacho" SET "estado" = \'EN_TRANSITO\' WHERE "rutaId" = %s', (ruta_id,))
        conn.commit()

        return _sin_trazado(cur, ruta_id)


@router.post(
    "/{ruta_id}/paradas/salir",
    response_model=Ruta,
    dependencies=[Depends(requiere_rol("REPARTIDOR"))],
)
def salir_paradas(
    ruta_id: str,
    data: SalirParadasRequest,
    usuario: dict = Depends(get_current_user),
):
    """Para motorizados: salir del almacen con una tanda de pedidos
    (subconjunto de paradas de la ruta). Pasa la ruta a EN_TRANSITO si estaba
    PLANIFICADA, y los despachos seleccionados a EN_TRANSITO con su tanda."""
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute('SELECT * FROM "Ruta" WHERE "id" = %s FOR UPDATE', (ruta_id,))
        ruta = cur.fetchone()
        if not ruta:
            raise HTTPException(404, "Ruta no encontrada")
        _verificar_ruta_propia(usuario, ruta)
        if ruta["estado"] not in ("PLANIFICADA", "EN_TRANSITO"):
            raise HTTPException(400, "Solo se puede registrar salida en rutas planificadas o en transito")
        if not ruta["vehiculoId"]:
            raise HTTPException(400, "La ruta no tiene vehiculo asignado")
        if not _es_moto(cur, ruta["vehiculoId"]):
            raise HTTPException(400, "La salida por paradas solo aplica a motos")

        ids = list(dict.fromkeys(data.despachoIds))
        cur.execute(
            'SELECT "id", "numero", "estado"::text AS "estado", "salidaEn" FROM "Despacho" '
            'WHERE "id" = ANY(%s) AND "rutaId" = %s',
            (ids, ruta_id),
        )
        encontrados = cur.fetchall()
        encontrados_map = {d["id"]: d for d in encontrados}
        faltantes = [did for did in ids if did not in encontrados_map]
        if faltantes:
            raise HTTPException(400, f"Despachos no pertenecen a esta ruta: {', '.join(faltantes)}")

        for d in encontrados:
            if d["salidaEn"] is not None or d["estado"] not in ("APROBADO", "EN_PREPARACION"):
                if d["estado"] == "ENTREGADO":
                    raise HTTPException(400, f"El despacho {d['numero']} ya fue entregado")
                elif d["salidaEn"] is not None or d["estado"] == "EN_TRANSITO":
                    raise HTTPException(400, f"El despacho {d['numero']} ya salio en una tanda previa")
                else:
                    raise HTTPException(400, f"El despacho {d['numero']} no esta pendiente de salir (estado: {d['estado']})")

        tanda_id = f"tanda-{uuid.uuid4().hex[:8]}"
        instante = _instante_marca(data)
        lat, lng = _ubicacion_marca(data)

        if ruta["estado"] == "PLANIFICADA":
            cur.execute(
                'UPDATE "Ruta" SET "estado" = \'EN_TRANSITO\', "iniciadaEn" = COALESCE("iniciadaEn", %s) WHERE "id" = %s',
                (instante, ruta_id),
            )
        elif ruta["iniciadaEn"] is None:
            cur.execute(
                'UPDATE "Ruta" SET "iniciadaEn" = %s WHERE "id" = %s',
                (instante, ruta_id),
            )

        cur.execute(
            'UPDATE "Despacho" SET "estado" = \'EN_TRANSITO\', "salidaEn" = %s, "tandaSalida" = %s, '
            '"salidaLat" = %s, "salidaLng" = %s '
            'WHERE "id" = ANY(%s) AND "rutaId" = %s AND "salidaEn" IS NULL',
            (instante, tanda_id, lat, lng, ids, ruta_id),
        )
        if cur.rowcount != len(ids):
            raise HTTPException(409, "Uno o mas despachos ya salieron en otra tanda o cambiaron de estado")
        conn.commit()

        return _sin_trazado(cur, ruta_id)


@router.post(
    "/{ruta_id}/paradas/{despacho_id}/llegada",
    response_model=Ruta,
    dependencies=[Depends(requiere_rol("REPARTIDOR"))],
)
def marcar_llegada_a_parada(
    ruta_id: str, despacho_id: str, data: MarcaParada | None = None, usuario: dict = Depends(get_current_user)
):
    """El repartidor marca que llego al cliente. Junto con la marca de
    entrega da el tiempo de atencion de esa parada, y contra la entrega
    anterior, el tiempo de traslado."""
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute('SELECT * FROM "Ruta" WHERE "id" = %s FOR UPDATE', (ruta_id,))
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

        lat, lng = _ubicacion_marca(data)
        cur.execute(
            'UPDATE "Despacho" SET "llegadaEn" = %s, "llegadaLat" = %s, "llegadaLng" = %s WHERE "id" = %s',
            (_instante_marca(data, despacho["salidaEn"] or ruta["iniciadaEn"]), lat, lng, despacho_id),
        )
        conn.commit()

        return _sin_trazado(cur, ruta_id)


@router.post(
    "/{ruta_id}/paradas/{despacho_id}/entregar",
    response_model=Ruta,
    dependencies=[Depends(requiere_rol("REPARTIDOR"))],
)
def marcar_parada_entregada(
    ruta_id: str, despacho_id: str, data: MarcaParada | None = None, usuario: dict = Depends(get_current_user)
):
    """El despachador marca que se entrego un despacho puntual dentro del
    viaje — no afecta a las demas paradas de la misma ruta. Cuando se
    entrega la ultima parada pendiente, la ruta pasa a COMPLETADA."""
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute('SELECT * FROM "Ruta" WHERE "id" = %s FOR UPDATE', (ruta_id,))
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

        entregado_en = _instante_marca(data, despacho["llegadaEn"])
        lat, lng = _ubicacion_marca(data)
        cur.execute(
            'UPDATE "Despacho" SET "estado" = \'ENTREGADO\', "entregadoEn" = %s, "entregadoLat" = %s, '
            '"entregadoLng" = %s WHERE "id" = %s',
            (entregado_en, lat, lng, despacho_id),
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
                (entregado_en, ruta_id),
            )

        conn.commit()

        return _sin_trazado(cur, ruta_id)
