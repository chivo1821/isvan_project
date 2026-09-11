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

from app.core.conductor import CONDUCTOR_DEL_VEHICULO
from app.core.db import get_connection
from app.core.ubicacion import sin_ubicacion
from app.services.route_analysis import (
    FACTOR_VIALIDAD,
    MINUTOS_POR_PARADA,
    VELOCIDAD_PROMEDIO_KMH,
    LatLng,
    haversine_km,
    orden_vecino_mas_cercano,
)

ALMACEN_BASE_ID = "alm-catia"

# Un vehiculo esta ocupado si ya esta asignado a una Ruta todavia activa.
RUTAS_ACTIVAS = ("PLANIFICADA", "EN_TRANSITO")

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


def _vehiculos_disponibles(cur) -> list[dict]:
    # Con el chofer, para que cada sugerencia diga quien manejaria el viaje.
    cur.execute(
        f'SELECT v.*, {CONDUCTOR_DEL_VEHICULO} AS "conductor" '
        'FROM "Vehiculo" v WHERE v."estado" = \'FUNCIONAL\' AND v."id" NOT IN ('
        '  SELECT r."vehiculoId" FROM "Ruta" r WHERE r."estado" = ANY(%s)'
        ') ORDER BY v."capacidadKg" DESC',
        (list(RUTAS_ACTIVAS),),
    )
    return cur.fetchall()


def _puede_llevar(vehiculo: dict, parada: _Parada) -> bool:
    if parada.requiere_frio and not vehiculo["tieneRefrigeracion"]:
        return False
    return parada.peso_kg <= vehiculo["capacidadKg"]


def _armar_grupo(
    origen: LatLng,
    pendientes: list[_Parada],
    capacidad_kg: float,
    con_refrigeracion: bool,
    mezclar_rutas_comerciales: bool,
    radio_max_km: float,
) -> list[_Parada]:
    """Arma un viaje: siembra con la parada mas lejana del almacen y va
    agregando la mas cercana al grupo, sin salirse del radio permitido y
    mientras quepa en la capacidad. La ruta comercial solo desempata.

    Se siembra por la mas lejana a proposito: las paradas lejanas son las
    dificiles de encajar, y dejarlas para el final produce un ultimo viaje
    disperso con clientes en puntas opuestas de la ciudad. Con el radio
    activo, ademas, el grupo de la semilla queda contenido en su zona (ej.
    todo Charallave junto) en vez de arrastrar clientes del otro extremo."""
    candidatas = [
        p for p in pendientes
        if p.peso_kg <= capacidad_kg and (con_refrigeracion or not p.requiere_frio)
    ]
    if not candidatas:
        return []

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


def sugerir_plan_rutas(
    despacho_ids: list[str],
    mezclar_rutas_comerciales: bool = True,
    radio_max_km: float | None = None,
) -> dict:
    """Devuelve los viajes propuestos y los despachos que quedaron fuera.

    radio_max_km ajusta que tan lejos puede estar una parada de las demas del
    mismo viaje (por defecto RADIO_MAX_ENTRE_PARADAS_KM): bajarlo da viajes
    mas compactos pero mas vehiculos; subirlo, lo contrario."""
    radio = radio_max_km or RADIO_MAX_ENTRE_PARADAS_KM
    with get_connection() as conn, conn.cursor() as cur:
        paradas, descartados = _cargar_paradas(cur, despacho_ids)
        vehiculos = _vehiculos_disponibles(cur)
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
    if not vehiculos:
        return {
            "sugerencias": [],
            "sinAsignar": sin_asignar + [{
                "despachoIds": [id_ for p in paradas for id_ in p.despacho_ids],
                "motivo": "No hay vehículos funcionales libres en este momento",
            }],
        }

    origen = LatLng(lat=almacen["lat"], lng=almacen["lng"])
    pendientes = list(paradas)
    libres = list(vehiculos)  # ya vienen de mayor a menor capacidad
    sugerencias: list[dict] = []

    while pendientes and libres:
        # Se arma el grupo con el vehiculo mas grande que pueda servir a
        # alguna parada pendiente, y despues se baja al mas chico que alcance
        # para lo que realmente quedo en el grupo: asi no se manda un camion
        # grande medio vacio cuando una camioneta hace el mismo viaje.
        referencia = next(
            (v for v in libres if any(_puede_llevar(v, p) for p in pendientes)),
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
        )
        if not grupo:
            break

        peso_kg = sum(p.peso_kg for p in grupo)
        necesita_frio = any(p.requiere_frio for p in grupo)
        asignado = min(
            (
                v for v in libres
                if v["capacidadKg"] >= peso_kg and (not necesita_frio or v["tieneRefrigeracion"])
            ),
            key=lambda v: v["capacidadKg"],
            default=referencia,
        )

        distancia_km, tiempo_min = _estimar_recorrido(origen, grupo)
        costo_km = _costo_por_km(asignado)
        costo = round(distancia_km * costo_km, 2) if costo_km is not None else None

        sugerencias.append({
            "vehiculo": asignado,
            "despachoIds": [id_ for p in grupo for id_ in p.despacho_ids],
            "paradas": len(grupo),
            "pesoKg": round(peso_kg, 2),
            "usoCapacidadPct": round(peso_kg / asignado["capacidadKg"] * 100, 1),
            "distanciaKmEstimada": distancia_km,
            "tiempoMinEstimado": tiempo_min,
            "costoEstimado": costo,
            "rutasComerciales": _rutas_comerciales(grupo),
            "motivos": _motivos(grupo, asignado, peso_kg, distancia_km, costo),
        })

        clientes_del_grupo = {p.cliente_id for p in grupo}
        libres = [v for v in libres if v["id"] != asignado["id"]]
        pendientes = [p for p in pendientes if p.cliente_id not in clientes_del_grupo]

    if pendientes:
        capacidad_maxima = max((v["capacidadKg"] for v in vehiculos), default=0)
        pesadas = [p for p in pendientes if p.peso_kg > capacidad_maxima]
        if pesadas:
            sin_asignar.append({
                "despachoIds": [id_ for p in pesadas for id_ in p.despacho_ids],
                "motivo": (
                    f"Superan por si solos la capacidad del vehículo más grande de la flota "
                    f"({capacidad_maxima:,.0f} kg) — hay que dividir el despacho"
                ),
            })
        clientes_pesados = {p.cliente_id for p in pesadas}
        resto = [p for p in pendientes if p.cliente_id not in clientes_pesados]
        if resto:
            sin_asignar.append({
                "despachoIds": [id_ for p in resto for id_ in p.despacho_ids],
                "motivo": "No quedan vehículos libres para un viaje más — quedan para la próxima tanda",
            })

    return {"sugerencias": sugerencias, "sinAsignar": sin_asignar}
