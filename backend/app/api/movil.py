"""La app movil de campo: jornada y ubicacion en vivo del repartidor (ver
app/services/jornadas.py). El login de la app esta en app/api/auth.py
(/auth/movil/*) y las acciones de la ruta son las mismas de la web
(app/api/rutas.py)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from app.core.auth import requiere_rol
from app.core.db import get_connection
from app.core.permisos import vehiculo_asignado
from app.schemas import EstadoJornada, LotePosiciones, LoteRecibido, en_utc
from app.services import jornadas
from app.services import planificacion as pl
from app.services import reversos

router = APIRouter(prefix="/movil", tags=["movil"])
_REPARTIDOR = Depends(requiere_rol("REPARTIDOR"))


def _estado(jornada: dict | None) -> dict:
    return {"jornada": jornada, **jornadas.intervalos()}


@router.get("/jornada", response_model=EstadoJornada)
def estado_jornada(usuario: dict = _REPARTIDOR):
    with get_connection() as conn, conn.cursor() as cur:
        jornada = jornadas.abierta(cur, usuario["id"])
        conn.commit()
        return _estado(jornada)


@router.post("/jornada/iniciar", response_model=EstadoJornada)
def iniciar_jornada(usuario: dict = _REPARTIDOR):
    with get_connection() as conn, conn.cursor() as cur:
        jornada = jornadas.iniciar(cur, usuario)
        conn.commit()
        return _estado(jornada)


@router.post("/jornada/terminar", response_model=EstadoJornada)
def terminar_jornada(usuario: dict = _REPARTIDOR):
    with get_connection() as conn, conn.cursor() as cur:
        jornadas.terminar(cur, usuario["id"])
        conn.commit()
        return _estado(None)


@router.post("/posiciones", response_model=LoteRecibido)
def recibir_posiciones(data: LotePosiciones, usuario: dict = _REPARTIDOR):
    with get_connection() as conn, conn.cursor() as cur:
        resultado = jornadas.guardar_lote(cur, usuario, data.jornadaId, data.enviadoEnMs, data.puntos)
        conn.commit()
        return resultado


# ---------- Las rutas del despachador ----------
#
# La web arma la pantalla del despachador pidiendo todos los clientes,
# despachos y rutas; en el telefono, con datos moviles, eso es demasiado. Aca
# va solo lo de su vehiculo: sus rutas activas con cada parada y su cliente.
# El trazado (para el mapa) solo en el detalle y aligerado.

PUNTOS_MAXIMOS_TRAZADO = 400
ESTADOS_ACTIVOS = ("PLANIFICADA", "EN_TRANSITO")


def _instante(valor):
    return en_utc(valor) if valor else None


def _rutas_movil(cur, rutas: list[dict]) -> list[dict]:
    if not rutas:
        return []
    ids = [r["id"] for r in rutas]
    cur.execute(
        'SELECT d."id", d."rutaId", d."numero", d."numeroDocumento", d."tipoDocumento", d."estado"::text AS "estado", '
        'd."ordenEnRuta", d."salidaEn", d."tandaSalida", d."llegadaEn", d."entregadoEn", c."codigo", c."nombre", c."direccion", c."ciudad", '
        'c."telefono", c."lat", c."lng", '
        '(SELECT COALESCE(SUM(i."cantidad" * i."pesoUnitarioKg"), 0) FROM "DespachoItem" i WHERE i."despachoId" = d."id") AS "pesoKg" '
        'FROM "Despacho" d JOIN "Cliente" c ON c."id" = d."destinoClienteId" '
        'WHERE d."rutaId" = ANY(%s) ORDER BY d."ordenEnRuta" NULLS LAST, d."numero"',
        (ids,),
    )
    paradas: dict[str, list] = {i: [] for i in ids}
    for d in cur.fetchall():
        paradas[d["rutaId"]].append({
            "despachoId": d["id"],
            "numero": d["numero"],
            "numeroDocumento": d["numeroDocumento"],
            "tipoDocumento": d["tipoDocumento"],
            "estado": d["estado"],
            "ordenEnRuta": d["ordenEnRuta"],
            "salidaEn": _instante(d["salidaEn"]),
            "tandaSalida": d["tandaSalida"],
            "llegadaEn": _instante(d["llegadaEn"]),
            "entregadoEn": _instante(d["entregadoEn"]),
            "pesoKg": round(float(d["pesoKg"]), 1),
            "cliente": {
                "codigo": d["codigo"], "nombre": d["nombre"], "direccion": d["direccion"], "ciudad": d["ciudad"],
                "telefono": d["telefono"], "lat": d["lat"], "lng": d["lng"],
            },
        })
    vehiculo_ids = sorted({v for r in rutas for v in (r["vehiculoId"], r["vehiculoApoyoId"]) if v})
    cur.execute('SELECT "id", "placa", "tipo"::text AS "tipo" FROM "Vehiculo" WHERE "id" = ANY(%s)', (vehiculo_ids,))
    vehiculos = {v["id"]: v for v in cur.fetchall()}
    cur.execute(
        'SELECT "id", "nombre", "direccion", "lat", "lng" FROM "Almacen" WHERE "id" = ANY(%s)',
        (sorted({r["origenId"] for r in rutas}),),
    )
    almacenes = {a["id"]: a for a in cur.fetchall()}
    avisos = pl.avisos_de(cur, rutas)
    no_entregados = reversos.no_entregados_de(cur, ids)
    salida = []
    for r in rutas:
        vehiculo = vehiculos.get(r["vehiculoId"])
        apoyo = vehiculos.get(r["vehiculoApoyoId"])
        salida.append({
            "id": r["id"],
            "numero": r["numero"],
            "estado": r["estado"],
            "salidaProgramada": en_utc(r["salidaProgramada"]),
            "iniciadaEn": _instante(r["iniciadaEn"]),
            "completadaEn": _instante(r["completadaEn"]),
            "distanciaTotalKm": r["distanciaTotalKm"],
            "tiempoTotalMin": r["tiempoTotalMin"],
            "vehiculo": {"placa": vehiculo["placa"], "tipo": vehiculo["tipo"]} if vehiculo else None,
            "vehiculoApoyo": {"placa": apoyo["placa"], "tipo": apoyo["tipo"]} if apoyo else None,
            "tipoVehiculo": vehiculo["tipo"] if vehiculo else None,
            # Las motos salen en el dia, sin hora a la vista (pedido del cliente).
            "esMoto": bool(vehiculo and vehiculo["tipo"] == "MOTO"),
            "almacen": almacenes.get(r["origenId"]),
            # Como en la web: al despachador solo le sirve saber que se le paso la salida.
            "avisos": [a for a in avisos.get(r["id"], []) if a["tipo"] == "SALIDA_VENCIDA"],
            "paradas": paradas[r["id"]],
            # Las que no se pudieron entregar: siguen a la vista, en rojo y con su motivo.
            "noEntregados": [
                {**n, "fecha": _instante(n["fecha"]), "llegadaEn": _instante(n["llegadaEn"])}
                for n in no_entregados.get(r["id"], [])
            ],
        })
    return salida


def _rutas_del_vehiculo(cur, usuario: dict, ruta_id: str | None = None) -> list[dict]:
    vehiculo = vehiculo_asignado(usuario)
    if not vehiculo:
        return []
    if ruta_id:
        cur.execute(
            'SELECT * FROM "Ruta" WHERE "id" = %s AND %s IN ("vehiculoId", "vehiculoApoyoId")', (ruta_id, vehiculo)
        )
    else:
        cur.execute(
            'SELECT * FROM "Ruta" WHERE %s IN ("vehiculoId", "vehiculoApoyoId") AND "estado"::text = ANY(%s) '
            "ORDER BY (\"estado\" = 'EN_TRANSITO') DESC, \"salidaProgramada\"",
            (vehiculo, list(ESTADOS_ACTIVOS)),
        )
    return cur.fetchall()


@router.get("/rutas")
def mis_rutas(usuario: dict = _REPARTIDOR):
    """Las rutas activas del vehiculo del repartidor (en un Morocho, tambien
    las de su segunda moto), la que esta en camino primero."""
    with get_connection() as conn, conn.cursor() as cur:
        return {"sinVehiculo": vehiculo_asignado(usuario) is None, "rutas": _rutas_movil(cur, _rutas_del_vehiculo(cur, usuario))}


@router.get("/rutas/{ruta_id}")
def mi_ruta(ruta_id: str, usuario: dict = _REPARTIDOR):
    """Una ruta con su trazado aligerado para el mapa. 404 si no es de su
    vehiculo (no se confirma que exista la de otro)."""
    with get_connection() as conn, conn.cursor() as cur:
        rutas = _rutas_del_vehiculo(cur, usuario, ruta_id)
        if not rutas:
            raise HTTPException(404, "Ruta no encontrada")
        ruta = _rutas_movil(cur, rutas)[0]
        cur.execute('SELECT COUNT(*) AS "n" FROM "RutaPunto" WHERE "rutaId" = %s', (ruta_id,))
        paso = max(1, -(-cur.fetchone()["n"] // PUNTOS_MAXIMOS_TRAZADO))
        cur.execute(
            'SELECT "lat", "lng" FROM (SELECT "lat", "lng", "orden", row_number() OVER (ORDER BY "orden") AS n '
            'FROM "RutaPunto" WHERE "rutaId" = %s) t WHERE (n - 1) %% %s = 0 ORDER BY "orden"',
            (ruta_id, paso),
        )
        ruta["trazado"] = [[f["lat"], f["lng"]] for f in cur.fetchall()]
        return ruta
