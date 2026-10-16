"""Sugerencia automatica de como agrupar los despachos aprobados en viajes
(Rutas) — el "que meto en cada camion" previo al calculo del trazado.

Criterios:

1. Distancia entre clientes, calculada con el lat/lng que ya tiene cada
   Cliente en la base: manda por encima de todo lo demas. Una parada solo
   entra al grupo si esta a menos de RADIO_MAX_ENTRE_PARADAS_KM de alguna
   de las que ya estan adentro, y a menos de ese radio por
   FACTOR_EXTENSION_GRUPO de la semilla del grupo. Eso es lo que evita el
   caso que reporto el negocio: un viaje con un cliente en La Guaira y otro
   en Charallave (~55 km entre si) solo porque compartian ruta comercial.
2. Capacidad del vehiculo (kg): restriccion dura, nunca se propone un grupo
   que exceda la capacidad del vehiculo asignado. La cadena de frio tambien
   es dura: un despacho que la requiere solo entra en vehiculo refrigerado.
3. Ruta comercial del cliente (Cliente.rutaComercial, el dato que viene del
   extracto de ventas): desempata entre paradas a distancia parecida, no
   arrastra viajes largos. Se aplica como un FACTOR sobre la distancia
   (FACTOR_RUTA_DISTINTA), no como kilometros sumados: entre dos candidatas
   igual de cerca gana la de la ruta del grupo, pero una de la misma ruta
   comercial a 8 km nunca le gana a una de otra ruta a 2 km. Con
   mezclar_rutas_comerciales=False si pasa a ser restriccion dura.
4. Costo: no condiciona la agrupacion, solo se reporta como estimacion
   (km * costo por km del vehiculo).

Las distancias de esta etapa son estimadas (Haversine * FACTOR_VIALIDAD, el
mismo factor que usa route_analysis): son decenas de combinaciones y llamar
al TSP de iServer por cada una seria lentisimo. El trazado y los kilometros
reales se calculan una sola vez, cuando el usuario crea la ruta a partir de
la sugerencia (POST /rutas).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

from app.core.conductor import CONDUCTOR_DEL_VEHICULO
from app.core.db import get_connection
from app.core.fechas import ahora_utc
from app.core.ubicacion import sin_ubicacion
from app.services import configuracion
from app.services import morocho as mo
from app.services import planificacion as pl
from app.services.planificacion import km_por_calle
from app.services.route_analysis import (
    FACTOR_VIALIDAD,
    MINUTOS_POR_PARADA,
    VELOCIDAD_PROMEDIO_KMH,
    LatLng,
    haversine_km,
    orden_vecino_mas_cercano,
)

ALMACEN_BASE_ID = "alm-catia"

# Salto maximo (km en linea recta) entre una parada y la mas cercana de las
# que ya estan en el grupo. Es el freno principal contra viajes absurdos:
# sin esto, la afinidad por ruta comercial terminaba juntando clientes a
# decenas de km entre si. Se puede ajustar por peticion (radio_max_km).
RADIO_MAX_ENTRE_PARADAS_KM = 12.0

# Ademas del salto, se limita cuanto puede estirarse el grupo completo:
# ninguna parada puede quedar a mas de (radio * este factor) de la semilla.
# Sin esto, una cadena de saltos cortos igual podia recorrer media region.
FACTOR_EXTENSION_GRUPO = 2.0

# Cuanto "encarece" a una parada pertenecer a otra ruta comercial. Es un
# multiplicador sobre la distancia, no kilometros sumados: asi la ruta
# comercial desempata entre candidatas parecidas sin poder imponerse a una
# diferencia real de distancia. 1.0 = ignorar la ruta comercial.
FACTOR_RUTA_DISTINTA = 1.6

# Tope de paradas por viaje: mas alla de esto el reparto deja de ser
# realizable en una jornada (y el TSP se vuelve lento). Ajustable.
MAX_PARADAS_POR_RUTA = 25

# Costo operativo de referencia por km (USD) cuando el vehiculo no tiene
# cargado su propio Vehiculo.costoPorKm. Son valores de arranque para que la
# estimacion no salga vacia — el negocio deberia cargar el costo real en
# cada vehiculo.
COSTO_POR_KM_POR_TIPO: dict[str, float] = {
    "CAMION_REFRIGERADO": 1.20,
    "CAMIONETA": 0.70,
    "MOTO": 0.25,
}

SIN_RUTA_COMERCIAL = "Sin ruta"


@dataclass
class _Parada:
    """Una parada fisica = un cliente. Varios despachos al mismo cliente son
    una sola parada (mismo lat/lng), igual que en el calculo del trazado."""

    cliente_id: str
    cliente_nombre: str
    ruta_comercial: str | None
    ubicacion: LatLng
    peso_kg: float
    requiere_frio: bool
    despacho_ids: list[str] = field(default_factory=list)
    # Km por calle (estimados) desde el almacen: para el limite de las motos.
    km_almacen: float = 0.0


def _cargar_paradas(cur, despacho_ids: list[str]) -> tuple[list[_Parada], list[dict]]:
    """Devuelve las paradas armadas y los despachos descartados (con motivo).

    Solo entran despachos aprobados y todavia sin ruta; si se pasa una lista
    de ids, se restringe a esos. Todo en 2 consultas (despachos + items), sin
    N+1."""
    condicion = 'WHERE d."estado" = \'APROBADO\' AND d."rutaId" IS NULL'
    parametros: tuple = ()
    if despacho_ids:
        condicion += ' AND d."id" = ANY(%s)'
        parametros = (despacho_ids,)

    cur.execute(
        'SELECT d."id", d."numero", d."destinoClienteId", '
        'c."nombre" AS "clienteNombre", c."lat" AS "clienteLat", c."lng" AS "clienteLng", '
        'c."rutaComercial" AS "clienteRutaComercial" '
        'FROM "Despacho" d JOIN "Cliente" c ON c."id" = d."destinoClienteId" '
        f'{condicion} ORDER BY d."fechaCreacion"',
        parametros,
    )
    despachos = cur.fetchall()
    if not despachos:
        return [], []

    cur.execute(
        'SELECT "despachoId", "cantidad", "pesoUnitarioKg", "requiereFrio" '
        'FROM "DespachoItem" WHERE "despachoId" = ANY(%s)',
        ([d["id"] for d in despachos],),
    )
    peso_por_despacho: dict[str, float] = {}
    frio_por_despacho: dict[str, bool] = {}
    for item in cur.fetchall():
        peso_por_despacho[item["despachoId"]] = (
            peso_por_despacho.get(item["despachoId"], 0.0) + item["cantidad"] * item["pesoUnitarioKg"]
        )
        frio_por_despacho[item["despachoId"]] = frio_por_despacho.get(item["despachoId"], False) or item["requiereFrio"]

    paradas_por_cliente: dict[str, _Parada] = {}
    descartados: list[dict] = []
    for d in despachos:
        if sin_ubicacion(d["clienteLat"], d["clienteLng"]):
            descartados.append({
                "despachoId": d["id"],
                "motivo": (
                    f'El cliente de {d["numero"]} no tiene una ubicación válida '
                    "(faltan las coordenadas o están en 0,0)"
                ),
            })
            continue

        parada = paradas_por_cliente.get(d["destinoClienteId"])
        if parada is None:
            parada = _Parada(
                cliente_id=d["destinoClienteId"],
                cliente_nombre=d["clienteNombre"],
                ruta_comercial=d["clienteRutaComercial"],
                ubicacion=LatLng(lat=d["clienteLat"], lng=d["clienteLng"]),
                peso_kg=0.0,
                requiere_frio=False,
            )
            paradas_por_cliente[d["destinoClienteId"]] = parada
        parada.despacho_ids.append(d["id"])
        parada.peso_kg += peso_por_despacho.get(d["id"], 0.0)
        parada.requiere_frio = parada.requiere_frio or frio_por_despacho.get(d["id"], False)

    return list(paradas_por_cliente.values()), descartados


def _flota_funcional(cur) -> list[dict]:
    """Todos los vehiculos funcionales, ocupados o no, del mas grande al mas
    chico: con ellos se dimensionan los viajes que se proponen sin vehiculo
    cuando a esa hora no queda ninguno libre."""
    cur.execute(
        f'SELECT v.*, {CONDUCTOR_DEL_VEHICULO} AS "conductor" FROM "Vehiculo" v '
        "WHERE v.\"estado\" = 'FUNCIONAL' ORDER BY v.\"capacidadKg\" DESC"
    )
    return cur.fetchall()


def _puede_llevar(vehiculo: dict, parada: _Parada, limite_moto_km: float) -> bool:
    if parada.requiere_frio and not vehiculo["tieneRefrigeracion"]:
        return False
    # Una moto no sale lejos del almacen (pedido del cliente; el limite se
    # cambia en la configuracion, ver app/services/configuracion.py).
    if vehiculo["tipo"] == "MOTO" and parada.km_almacen > limite_moto_km:
        return False
    return parada.peso_kg <= vehiculo["capacidadKg"]


def _armar_grupo(
    origen: LatLng,
    pendientes: list[_Parada],
    capacidad_kg: float,
    con_refrigeracion: bool,
    mezclar_rutas_comerciales: bool,
    radio_max_km: float,
    max_km_almacen: float | None = None,
    semilla: _Parada | None = None,
) -> list[_Parada]:
    """Arma un viaje: siembra con la parada mas lejana del almacen y va
    agregando la mas cercana al grupo, sin salirse del radio permitido y
    mientras quepa en la capacidad. La ruta comercial solo desempata.

    Se siembra por la mas lejana a proposito: las paradas lejanas son las
    dificiles de encajar, y dejarlas para el final produce un ultimo viaje
    disperso con clientes en puntas opuestas de la ciudad. Con el radio
    activo, ademas, el grupo de la semilla queda contenido en su zona (ej.
    todo Charallave junto) en vez de arrastrar clientes del otro extremo.

    semilla: para un Morocho, el pedido grande que lo justifica."""
    candidatas = [
        p for p in pendientes
        if p.peso_kg <= capacidad_kg
        and (con_refrigeracion or not p.requiere_frio)
        # Con una moto de referencia, solo las paradas dentro de su limite.
        and (max_km_almacen is None or p.km_almacen <= max_km_almacen)
    ]
    if not candidatas:
        return []

    if semilla is None or semilla not in candidatas:
        semilla = max(candidatas, key=lambda p: haversine_km(origen, p.ubicacion))
    grupo = [semilla]
    en_grupo = {semilla.cliente_id}
    peso = semilla.peso_kg
    # La ruta comercial del grupo la define la semilla; las demas paradas de
    # esa misma ruta entran sin recargo.
    ruta_del_grupo = semilla.ruta_comercial
    extension_max_km = radio_max_km * FACTOR_EXTENSION_GRUPO

    while len(grupo) < MAX_PARADAS_POR_RUTA:
        cercanas: list[tuple[_Parada, float]] = []
        for parada in candidatas:
            if parada.cliente_id in en_grupo or peso + parada.peso_kg > capacidad_kg:
                continue
            if not mezclar_rutas_comerciales and parada.ruta_comercial != ruta_del_grupo:
                continue
            salto_km = min(haversine_km(p.ubicacion, parada.ubicacion) for p in grupo)
            if salto_km > radio_max_km:
                continue
            if haversine_km(semilla.ubicacion, parada.ubicacion) > extension_max_km:
                continue
            cercanas.append((parada, salto_km))

        if not cercanas:
            break

        def costo(candidata: tuple[_Parada, float]) -> float:
            parada, salto_km = candidata
            if parada.ruta_comercial != ruta_del_grupo:
                return salto_km * FACTOR_RUTA_DISTINTA
            return salto_km

        mejor, _ = min(cercanas, key=costo)
        grupo.append(mejor)
        en_grupo.add(mejor.cliente_id)
        peso += mejor.peso_kg

    return grupo


def _dispersion_km(grupo: list[_Parada]) -> float:
    """Distancia entre las dos paradas mas alejadas del grupo — lo que hace
    falta para ver de un vistazo si el viaje es compacto o si quedo partido
    entre dos zonas."""
    return max(
        (
            haversine_km(a.ubicacion, b.ubicacion)
            for i, a in enumerate(grupo)
            for b in grupo[i + 1:]
        ),
        default=0.0,
    )


def _estimar_recorrido(origen: LatLng, grupo: list[_Parada]) -> tuple[float, int]:
    """Distancia y tiempo estimados del viaje: orden por vecino mas cercano
    desde el almacen y suma de tramos en linea recta corregidos por
    FACTOR_VIALIDAD, mas el tiempo detenido en cada cliente
    (MINUTOS_POR_PARADA). Es una estimacion de planificacion; el valor real
    sale del TSP al crear la ruta."""
    ubicaciones = [p.ubicacion for p in grupo]
    orden = orden_vecino_mas_cercano(origen, ubicaciones)

    distancia_km = 0.0
    actual = origen
    for indice in orden:
        distancia_km += haversine_km(actual, ubicaciones[indice])
        actual = ubicaciones[indice]

    distancia_km = round(distancia_km * FACTOR_VIALIDAD, 1)
    tiempo_manejo = (distancia_km / VELOCIDAD_PROMEDIO_KMH) * 60
    tiempo_min = max(1, round(tiempo_manejo + len(grupo) * MINUTOS_POR_PARADA))
    return distancia_km, tiempo_min


def _costo_por_km(vehiculo: dict) -> float | None:
    if vehiculo.get("costoPorKm") is not None:
        return vehiculo["costoPorKm"]
    return COSTO_POR_KM_POR_TIPO.get(vehiculo["tipo"])


def _rutas_comerciales(grupo: list[_Parada]) -> list[str]:
    vistas: list[str] = []
    for p in grupo:
        etiqueta = p.ruta_comercial or SIN_RUTA_COMERCIAL
        if etiqueta not in vistas:
            vistas.append(etiqueta)
    return vistas


def _motivos(
    grupo: list[_Parada], vehiculo: dict, peso_kg: float, distancia_km: float, costo: float | None
) -> list[str]:
    rutas = _rutas_comerciales(grupo)
    motivos = []
    if len(rutas) == 1:
        motivos.append(
            f"{len(grupo)} parada(s) de la ruta comercial {rutas[0]}"
            if rutas[0] != SIN_RUTA_COMERCIAL
            else f"{len(grupo)} parada(s) sin ruta comercial asignada"
        )
    else:
        motivos.append(f"{len(grupo)} parada(s) cercanas entre si, de {len(rutas)} rutas comerciales ({', '.join(rutas)})")
    motivos.append(
        f"{peso_kg:,.0f} kg de {vehiculo['capacidadKg']:,.0f} kg de capacidad "
        f"({peso_kg / vehiculo['capacidadKg'] * 100:.0f}%)"
    )
    if len(grupo) > 1:
        motivos.append(f"Paradas a menos de {_dispersion_km(grupo):,.1f} km entre sí")
    motivos.append(
        f"~{distancia_km:,.1f} km estimados desde el almacén "
        f"(+{len(grupo) * MINUTOS_POR_PARADA} min detenido en las paradas)"
    )
    if any(p.requiere_frio for p in grupo):
        motivos.append("Vehículo con refrigeración")
    if costo is not None:
        motivos.append(f"Costo del vehículo ~{costo:,.2f} USD")
    return motivos


def _sugerir_morocho(
    origen: LatLng,
    pendientes: list[_Parada],
    libres: list[dict],
    limite_moto: float,
    limite_morocho: float,
    mezclar_rutas_comerciales: bool,
    radio: float,
) -> tuple[dict, list[_Parada], set[str]] | None:
    """El viaje en Morocho para el pedido mas pesado que no cabe en una moto
    libre pero si en dos (ver app/services/morocho.py). Si sobra espacio,
    suma paradas cercanas hasta el tope del Morocho."""
    motos_libres = [v for v in libres if v["tipo"] == "MOTO"]
    if len(motos_libres) < 2:
        return None
    for pesada in sorted(pendientes, key=lambda p: -p.peso_kg):
        if any(_puede_llevar(v, pesada, limite_moto) for v in motos_libres):
            continue
        par = mo.elegir_par(
            motos_libres, pesada.peso_kg, pesada.requiere_frio, pesada.km_almacen, limite_moto, limite_morocho
        )
        if par:
            break
    else:
        return None

    grupo = _armar_grupo(
        origen, pendientes, par.capacidad_kg, par.con_refrigeracion, mezclar_rutas_comerciales, radio,
        limite_moto, semilla=pesada,
    )
    peso_kg = sum(p.peso_kg for p in grupo)
    distancia_km, tiempo_min = _estimar_recorrido(origen, grupo)
    costos = [_costo_por_km(par.principal), _costo_por_km(par.apoyo)]
    costo = round(distancia_km * sum(costos), 2) if None not in costos else None
    motivos = _motivos(grupo, {**par.principal, "capacidadKg": par.capacidad_kg}, peso_kg, distancia_km, costo)
    motivos.insert(
        0,
        f"Morocho: el pedido de {pesada.peso_kg:,.0f} kg no cabe en una moto y sale en dos "
        f"({par.principal['placa']} y {par.apoyo['placa']}, hasta {par.capacidad_kg:,.0f} kg entre las dos)",
    )
    sugerencia = {
        "vehiculo": par.principal,
        "vehiculoApoyo": par.apoyo,
        "morocho": True,
        "despachoIds": [id_ for p in grupo for id_ in p.despacho_ids],
        "paradas": len(grupo),
        "pesoKg": round(peso_kg, 2),
        "usoCapacidadPct": round(peso_kg / par.capacidad_kg * 100, 1),
        "distanciaKmEstimada": distancia_km,
        "tiempoMinEstimado": tiempo_min,
        "costoEstimado": costo,
        "rutasComerciales": _rutas_comerciales(grupo),
        "motivos": motivos,
    }
    return sugerencia, grupo, {par.principal["id"], par.apoyo["id"]}


def sugerir_plan_rutas(
    despacho_ids: list[str],
    mezclar_rutas_comerciales: bool = True,
    radio_max_km: float | None = None,
    salida_programada: datetime | None = None,
    priorizar_motos: bool = True,
) -> dict:
    """Devuelve los viajes propuestos y los despachos que quedaron fuera.

    priorizar_motos: antes que los camiones, cada moto libre se lleva un
    viaje con los despachos livianos y cercanos que le caben (capacidad del
    bolso, limite de km). Sin esto el criterio es consolidar en la menor
    cantidad de vehiculos, y las motos casi nunca salen: dos camiones se
    llevan todo (pedido del cliente, 2026-10-07: los motorizados tienen que
    tomarse en cuenta).

    radio_max_km ajusta que tan lejos puede estar una parada de las demas del
    mismo viaje (por defecto RADIO_MAX_ENTRE_PARADAS_KM): bajarlo da viajes
    mas compactos pero mas vehiculos; subirlo, lo contrario.

    salida_programada es para cuando se planifica: se usan los vehiculos
    libres a esa hora (sin otra ruta que se pise). Cuando no queda ninguno
    libre, los viajes se siguen proponiendo SIN vehiculo, dimensionados con
    la flota, para asignarlo despues: la falta de vehiculos ya no frena la
    planificacion (ver app/services/planificacion.py)."""
    radio = radio_max_km or RADIO_MAX_ENTRE_PARADAS_KM
    inicio = (
        salida_programada.astimezone(timezone.utc).replace(tzinfo=None) if salida_programada else ahora_utc()
    )
    with get_connection() as conn, conn.cursor() as cur:
        paradas, descartados = _cargar_paradas(cur, despacho_ids)
        libres_a_esa_hora = pl.vehiculos_libres(
            cur, inicio, inicio + timedelta(minutes=pl.DURACION_POR_DEFECTO_MIN)
        )
        flota = _flota_funcional(cur)
        limite_moto = configuracion.leer(cur, "motoDistanciaMaxKm")
        limite_morocho = configuracion.leer(cur, "morochoMaxKg")
        cur.execute('SELECT * FROM "Almacen" WHERE "id" = %s', (ALMACEN_BASE_ID,))
        almacen = cur.fetchone()

    sin_asignar: list[dict] = [
        {"despachoIds": [d["despachoId"]], "motivo": d["motivo"]} for d in descartados
    ]
    if not paradas:
        return {"sugerencias": [], "sinAsignar": sin_asignar}
    if not almacen:
        return {
            "sugerencias": [],
            "sinAsignar": sin_asignar + [{
                "despachoIds": [id_ for p in paradas for id_ in p.despacho_ids],
                "motivo": (
                    f'No existe el almacen de origen "{ALMACEN_BASE_ID}" en la base de datos '
                    "(ver README, seccion de datos iniciales)."
                ),
            }],
        }
    if not flota:
        return {
            "sugerencias": [],
            "sinAsignar": sin_asignar + [{
                "despachoIds": [id_ for p in paradas for id_ in p.despacho_ids],
                "motivo": "No hay ningún vehículo funcional en la flota para dimensionar los viajes",
            }],
        }

    origen = LatLng(lat=almacen["lat"], lng=almacen["lng"])
    for p in paradas:
        p.km_almacen = km_por_calle(origen, p.ubicacion)
    pendientes = list(paradas)
    libres = list(libres_a_esa_hora)  # ya vienen de mayor a menor capacidad
    sugerencias: list[dict] = []
    # Paradas que salieron en camion, camioneta o sin vehiculo: para avisar si
    # los Morochos dejaron sin moto a paradas que cabian en una.
    fuera_de_moto: list[_Parada] = []

    while pendientes:
        # Un pedido que no cabe en ninguna moto libre pero si en dos juntas
        # (Morocho): sale en un viaje propio con las dos, antes que lo demas
        # consuma las motos (pedido del cliente, 2026-10-16).
        if priorizar_motos:
            morocho = _sugerir_morocho(
                origen, pendientes, libres, limite_moto, limite_morocho, mezclar_rutas_comerciales, radio
            )
            if morocho:
                sugerencia, grupo, usadas = morocho
                sugerencias.append(sugerencia)
                libres = [v for v in libres if v["id"] not in usadas]
                en_grupo = {p.cliente_id for p in grupo}
                pendientes = [p for p in pendientes if p.cliente_id not in en_grupo]
                continue

        # Primero con un vehiculo libre a esa hora. Si ya no queda ninguno que
        # sirva, el viaje se arma igual con el tamano de la flota y queda sin
        # vehiculo, para asignarlo cuando se libere uno.
        # Con la prioridad de motos, primero una moto libre que pueda llevar
        # algo de lo pendiente; despues, el vehiculo libre mas grande.
        referencia = None
        if priorizar_motos:
            referencia = next(
                (
                    v for v in libres
                    if v["tipo"] == "MOTO" and any(_puede_llevar(v, p, limite_moto) for p in pendientes)
                ),
                None,
            )
        en_moto_por_prioridad = referencia is not None
        if referencia is None:
            referencia = next(
                (v for v in libres if any(_puede_llevar(v, p, limite_moto) for p in pendientes)),
                None,
            )
        con_vehiculo = referencia is not None
        if not con_vehiculo:
            referencia = next(
                (v for v in flota if any(_puede_llevar(v, p, limite_moto) for p in pendientes)),
                None,
            )
        if referencia is None:
            break

        grupo = _armar_grupo(
            origen,
            pendientes,
            referencia["capacidadKg"],
            referencia["tieneRefrigeracion"],
            mezclar_rutas_comerciales,
            radio,
            limite_moto if referencia["tipo"] == "MOTO" else None,
        )
        if not grupo:
            break

        peso_kg = sum(p.peso_kg for p in grupo)
        necesita_frio = any(p.requiere_frio for p in grupo)
        mas_lejos_km = max(p.km_almacen for p in grupo)
        # Se baja al vehiculo mas chico que alcance para lo que quedo en el
        # grupo, sin mandar una moto mas lejos de lo permitido.
        asignado = min(
            (
                v for v in (libres if con_vehiculo else flota)
                if v["capacidadKg"] >= peso_kg
                and (not necesita_frio or v["tieneRefrigeracion"])
                and (v["tipo"] != "MOTO" or mas_lejos_km <= limite_moto)
            ),
            key=lambda v: v["capacidadKg"],
            default=referencia,
        )

        distancia_km, tiempo_min = _estimar_recorrido(origen, grupo)
        costo_km = _costo_por_km(asignado) if con_vehiculo else None
        costo = round(distancia_km * costo_km, 2) if costo_km is not None else None
        motivos = _motivos(grupo, asignado, peso_kg, distancia_km, costo)
        if not con_vehiculo:
            motivos.insert(0, "Sin vehículo libre a esa hora: se planifica y se le asigna uno después")
        elif en_moto_por_prioridad and asignado["tipo"] == "MOTO":
            motivos.insert(0, "Entregas livianas y cercanas: van en moto (prioridad de motorizados)")

        sugerencias.append({
            "vehiculo": asignado if con_vehiculo else None,
            "vehiculoApoyo": None,
            "morocho": False,
            "despachoIds": [id_ for p in grupo for id_ in p.despacho_ids],
            "paradas": len(grupo),
            "pesoKg": round(peso_kg, 2),
            "usoCapacidadPct": round(peso_kg / asignado["capacidadKg"] * 100, 1),
            "distanciaKmEstimada": distancia_km,
            "tiempoMinEstimado": tiempo_min,
            "costoEstimado": costo,
            "rutasComerciales": _rutas_comerciales(grupo),
            "motivos": motivos,
        })

        if not con_vehiculo or asignado["tipo"] != "MOTO":
            fuera_de_moto.extend(grupo)
        clientes_del_grupo = {p.cliente_id for p in grupo}
        if con_vehiculo:
            libres = [v for v in libres if v["id"] != asignado["id"]]
        pendientes = [p for p in pendientes if p.cliente_id not in clientes_del_grupo]

    # Lo que ningun vehiculo de la flota puede llevar, con el motivo de cada uno.
    capacidad_maxima = max(v["capacidadKg"] for v in flota)
    hay_frio = any(v["tieneRefrigeracion"] for v in flota)
    hay_no_moto = any(v["tipo"] != "MOTO" for v in flota)
    motos = sorted((v["capacidadKg"] for v in flota if v["tipo"] == "MOTO"), reverse=True)
    tope_morocho = min(limite_morocho, sum(motos[:2])) if len(motos) >= 2 else 0
    motivos_fuera: dict[str, list[_Parada]] = {}
    for p in pendientes:
        if not hay_no_moto and capacidad_maxima < p.peso_kg <= tope_morocho and p.km_almacen <= limite_moto:
            motivo = (
                f"Necesitan un Morocho (dos motos juntas, hasta {tope_morocho:,.0f} kg) "
                "y a esa hora no quedan dos motos libres"
            )
        elif p.peso_kg > capacidad_maxima:
            motivo = (
                f"Superan por si solos la capacidad del vehículo más grande de la flota "
                f"({capacidad_maxima:,.0f} kg) — hay que dividir el despacho"
            )
        elif p.requiere_frio and not hay_frio:
            motivo = "Requieren refrigeración y no hay ningún vehículo refrigerado funcional"
        elif not hay_no_moto and p.km_almacen > limite_moto:
            motivo = (
                f"Están a más de {limite_moto:g} km del almacén (el máximo para motos) "
                "y en la flota funcional solo hay motos"
            )
        else:
            motivo = "Ningún vehículo de la flota puede llevarlos"
        motivos_fuera.setdefault(motivo, []).append(p)
    for motivo, grupo in motivos_fuera.items():
        sin_asignar.append({"despachoIds": [id_ for p in grupo for id_ in p.despacho_ids], "motivo": motivo})

    return {
        "sugerencias": sugerencias,
        "sinAsignar": sin_asignar,
        "advertencias": _advertencias_morocho(sugerencias, fuera_de_moto + pendientes, flota, limite_moto),
    }


def _advertencias_morocho(
    sugerencias: list[dict], fuera_de_moto: list[_Parada], flota: list[dict], limite_moto: float
) -> list[str]:
    """Los Morochos van primero (decision del cliente, no se limitan), pero
    se lleva dos motos cada uno: si por eso quedaron paradas que cabian en
    una moto yendo en otro vehiculo, se avisa para que lo tengan en cuenta."""
    morochos = sum(1 for s in sugerencias if s.get("morocho"))
    motos = [v for v in flota if v["tipo"] == "MOTO"]
    if not morochos or not motos:
        return []
    capacidad_moto = max(v["capacidadKg"] for v in motos)
    moto_con_frio = any(v["tieneRefrigeracion"] for v in motos)
    livianas = [
        p for p in fuera_de_moto
        if p.peso_kg <= capacidad_moto and p.km_almacen <= limite_moto and (moto_con_frio or not p.requiere_frio)
    ]
    if not livianas:
        return []
    return [
        f"{'El Morocho usa' if morochos == 1 else f'Los {morochos} Morochos usan'} {morochos * 2} motos: "
        f"{len(livianas)} parada(s) livianas y cercanas, que cabían en una moto, van en otro vehículo. "
        "Tenlo en cuenta: si prefieres llevarlas en moto, arma esas rutas a mano."
    ]
