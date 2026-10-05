"""Planificacion de rutas: horarios, vehiculos libres y avisos.

Antes, un vehiculo podia tener una sola ruta activa y el vehiculo era
obligatorio: con la flota ocupada no se podia planificar la ruta de manana.
Ahora (pedido del cliente, 2026-10-04):

- Cada ruta tiene su salida programada (fecha y hora de recogida en el
  almacen de todos sus pedidos) y se puede planificar SIN vehiculo.
- Un vehiculo puede tener varias rutas planificadas, en horarios distintos.
  Lo unico fisicamente imposible, estar EN TRANSITO en dos a la vez, se
  frena al iniciar la ruta, no al planificarla.
- Lo que antes bloqueaba ahora es un AVISO que se ve en la ruta y en la
  agenda: sin vehiculo, vehiculo fuera de servicio, horarios que se pisan,
  salida vencida, moto demasiado lejos del almacen.
"""

from __future__ import annotations

from datetime import datetime, timedelta

from app.core.conductor import CONDUCTOR_DEL_VEHICULO
from app.core.fechas import a_caracas, ahora_utc
from app.core.ubicacion import sin_ubicacion
from app.services import configuracion
from app.services.route_analysis import FACTOR_VIALIDAD, VELOCIDAD_PROMEDIO_KMH, LatLng, haversine_km

ACTIVAS = ("PLANIFICADA", "EN_TRANSITO")

# Cuanto ocupa una ruta al vehiculo si todavia no tiene tiempo estimado.
DURACION_POR_DEFECTO_MIN = 240
# Una ruta planificada que no salio pasados estos minutos, esta atrasada.
TOLERANCIA_ATRASO_MIN = 30

ESTADO_VEHICULO = {"EN_MANTENIMIENTO": "en mantenimiento", "FUERA_DE_SERVICIO": "fuera de servicio"}


def ventana(ruta: dict, regreso_min: int = 0) -> tuple[datetime, datetime]:
    """Cuando ocupa al vehiculo: desde que sale (la real si ya salio) hasta
    que vuelve al almacen. El tiempo estimado de la ruta llega hasta la
    ultima entrega (el trazado termina en el ultimo cliente), asi que se le
    suma el regreso (ver regresos_min). Sin tiempo estimado, un bloque fijo."""
    inicio = ruta.get("iniciadaEn") if ruta["estado"] == "EN_TRANSITO" and ruta.get("iniciadaEn") else ruta["salidaProgramada"]
    duracion = ruta["tiempoTotalMin"] + regreso_min if ruta.get("tiempoTotalMin") else DURACION_POR_DEFECTO_MIN
    return inicio, inicio + timedelta(minutes=duracion)


def regresos_min(cur, ruta_ids: list[str]) -> dict[str, int]:
    """Lo que tarda cada ruta en volver al almacen desde su ultima parada,
    estimado como el resto del planificador (km por calle a la velocidad
    promedio). Una sola consulta para todas."""
    if not ruta_ids:
        return {}
    cur.execute(
        'SELECT DISTINCT ON (d."rutaId") d."rutaId", c."lat", c."lng", a."lat" AS "aLat", a."lng" AS "aLng" '
        'FROM "Despacho" d JOIN "Ruta" r ON r."id" = d."rutaId" JOIN "Almacen" a ON a."id" = r."origenId" '
        'JOIN "Cliente" c ON c."id" = d."destinoClienteId" WHERE d."rutaId" = ANY(%s) '
        'ORDER BY d."rutaId", d."ordenEnRuta" DESC NULLS LAST',
        (list(ruta_ids),),
    )
    salida = {}
    for f in cur.fetchall():
        if sin_ubicacion(f["lat"], f["lng"]):
            continue
        km = km_por_calle(LatLng(lat=f["lat"], lng=f["lng"]), LatLng(lat=f["aLat"], lng=f["aLng"]))
        salida[f["rutaId"]] = round(km / VELOCIDAD_PROMEDIO_KMH * 60)
    return salida


def se_pisan(a: tuple[datetime, datetime], b: tuple[datetime, datetime]) -> bool:
    return a[0] < b[1] and b[0] < a[1]


def _hora(instante: datetime) -> str:
    return a_caracas(instante).strftime("%d/%m %H:%M")


def km_por_calle(a: LatLng, b: LatLng) -> float:
    """La misma estimacion que usa el planificador (ver plan_rutas.py)."""
    return round(haversine_km(a, b) * FACTOR_VIALIDAD, 1)


# ---------- Vehiculos libres ----------


def vehiculos_libres(cur, inicio: datetime, fin: datetime, excluir_ruta: str | None = None) -> list[dict]:
    """Los vehiculos funcionales sin ninguna ruta activa que se pise con el
    horario [inicio, fin], del mas grande al mas chico."""
    cur.execute(
        f'SELECT v.*, {CONDUCTOR_DEL_VEHICULO} AS "conductor" FROM "Vehiculo" v '
        "WHERE v.\"estado\" = 'FUNCIONAL' ORDER BY v.\"capacidadKg\" DESC"
    )
    vehiculos = cur.fetchall()
    cur.execute(
        'SELECT "id", "vehiculoId", "estado", "salidaProgramada", "iniciadaEn", "tiempoTotalMin" FROM "Ruta" '
        'WHERE "vehiculoId" IS NOT NULL AND "estado" = ANY(%s) AND "id" IS DISTINCT FROM %s',
        (list(ACTIVAS), excluir_ruta),
    )
    activas = cur.fetchall()
    regresos = regresos_min(cur, [r["id"] for r in activas])
    ocupados = {r["vehiculoId"] for r in activas if se_pisan(ventana(r, regresos.get(r["id"], 0)), (inicio, fin))}
    return [v for v in vehiculos if v["id"] not in ocupados]


def libres_por_ruta(cur, rutas: list[dict]) -> dict[str, list[str]]:
    """Para cada ruta planificada, los vehiculos funcionales libres en su
    horario (sin contarla a ella misma). En memoria, con dos consultas en
    total, para que la agenda no haga dos por ruta."""
    if not rutas:
        return {}
    cur.execute("SELECT \"id\" FROM \"Vehiculo\" WHERE \"estado\" = 'FUNCIONAL' ORDER BY \"capacidadKg\" DESC")
    funcionales = [v["id"] for v in cur.fetchall()]
    cur.execute(
        'SELECT "id", "vehiculoId", "estado", "salidaProgramada", "iniciadaEn", "tiempoTotalMin" FROM "Ruta" '
        'WHERE "vehiculoId" IS NOT NULL AND "estado" = ANY(%s)',
        (list(ACTIVAS),),
    )
    activas = cur.fetchall()
    regresos = regresos_min(cur, {r["id"] for r in activas} | {r["id"] for r in rutas})
    salida: dict[str, list[str]] = {}
    for r in rutas:
        propia = ventana(r, regresos.get(r["id"], 0))
        ocupados = {
            o["vehiculoId"] for o in activas
            if o["id"] != r["id"] and se_pisan(propia, ventana(o, regresos.get(o["id"], 0)))
        }
        salida[r["id"]] = [v for v in funcionales if v not in ocupados]
    return salida


# ---------- Avisos ----------


def _distancias_max_por_ruta(cur, ruta_ids: list[str]) -> dict[str, float]:
    """La parada mas lejana del almacen de cada ruta, en km por calle."""
    if not ruta_ids:
        return {}
    cur.execute(
        'SELECT d."rutaId", a."lat" AS "aLat", a."lng" AS "aLng", c."lat", c."lng" FROM "Despacho" d '
        'JOIN "Ruta" r ON r."id" = d."rutaId" JOIN "Almacen" a ON a."id" = r."origenId" '
        'JOIN "Cliente" c ON c."id" = d."destinoClienteId" WHERE d."rutaId" = ANY(%s)',
        (ruta_ids,),
    )
    maximas: dict[str, float] = {}
    for f in cur.fetchall():
        if sin_ubicacion(f["lat"], f["lng"]):
            continue
        km = km_por_calle(LatLng(lat=f["aLat"], lng=f["aLng"]), LatLng(lat=f["lat"], lng=f["lng"]))
        maximas[f["rutaId"]] = max(maximas.get(f["rutaId"], 0.0), km)
    return maximas


def avisos_de(cur, rutas: list[dict]) -> dict[str, list[dict]]:
    """Los avisos de cada ruta activa: lo que alguien tiene que resolver
    antes de la salida. Las completadas y canceladas no llevan."""
    activas = [r for r in rutas if r["estado"] in ACTIVAS]
    salida: dict[str, list[dict]] = {r["id"]: [] for r in rutas}
    if not activas:
        return salida

    vehiculo_ids = sorted({r["vehiculoId"] for r in activas if r.get("vehiculoId")})
    vehiculos: dict[str, dict] = {}
    otras_por_vehiculo: dict[str, list[dict]] = {}
    if vehiculo_ids:
        cur.execute('SELECT "id", "placa", "tipo", "estado" FROM "Vehiculo" WHERE "id" = ANY(%s)', (vehiculo_ids,))
        vehiculos = {v["id"]: v for v in cur.fetchall()}
        cur.execute(
            'SELECT "id", "numero", "vehiculoId", "estado", "salidaProgramada", "iniciadaEn", "tiempoTotalMin" '
            'FROM "Ruta" WHERE "vehiculoId" = ANY(%s) AND "estado" = ANY(%s)',
            (vehiculo_ids, list(ACTIVAS)),
        )
        for r in cur.fetchall():
            otras_por_vehiculo.setdefault(r["vehiculoId"], []).append(r)

    regresos = regresos_min(
        cur, {r["id"] for r in activas} | {o["id"] for otras in otras_por_vehiculo.values() for o in otras}
    )
    motos = [r["id"] for r in activas if vehiculos.get(r.get("vehiculoId") or "", {}).get("tipo") == "MOTO"]
    lejanias = _distancias_max_por_ruta(cur, motos)
    limite_moto = configuracion.leer(cur, "motoDistanciaMaxKm") if motos else None
    ahora = ahora_utc()

    for r in activas:
        avisos = salida[r["id"]]
        vehiculo = vehiculos.get(r.get("vehiculoId") or "")
        if not vehiculo:
            avisos.append({"tipo": "SIN_VEHICULO", "mensaje": "Sin vehículo asignado: hay que asignarle uno antes de la salida"})
        else:
            if vehiculo["estado"] != "FUNCIONAL":
                avisos.append({
                    "tipo": "VEHICULO_NO_FUNCIONAL",
                    "mensaje": f"El vehículo {vehiculo['placa']} está {ESTADO_VEHICULO.get(vehiculo['estado'], vehiculo['estado'].lower())}",
                })
            propia = ventana(r, regresos.get(r["id"], 0))
            for otra in otras_por_vehiculo.get(vehiculo["id"], []):
                if otra["id"] != r["id"] and se_pisan(propia, ventana(otra, regresos.get(otra["id"], 0))):
                    avisos.append({
                        "tipo": "CHOQUE_HORARIO",
                        "mensaje": (
                            f"El vehículo {vehiculo['placa']} también tiene la ruta {otra['numero']} "
                            f"({'en tránsito' if otra['estado'] == 'EN_TRANSITO' else 'sale ' + _hora(ventana(otra)[0])}) "
                            "y los horarios se pisan"
                        ),
                        "rutaId": otra["id"],
                    })
            if r["id"] in lejanias and limite_moto is not None and lejanias[r["id"]] > limite_moto:
                avisos.append({
                    "tipo": "MOTO_LEJOS",
                    "mensaje": (
                        f"La moto {vehiculo['placa']} va a un cliente a unos {lejanias[r['id']]:.0f} km del almacén "
                        f"(el máximo para motos es {limite_moto:g} km)"
                    ),
                })
        if r["estado"] == "PLANIFICADA" and r["salidaProgramada"] < ahora - timedelta(minutes=TOLERANCIA_ATRASO_MIN):
            avisos.append({
                "tipo": "SALIDA_VENCIDA",
                "mensaje": f"Debía salir el {_hora(r['salidaProgramada'])} y todavía no salió",
            })
    return salida
