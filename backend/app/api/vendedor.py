"""Modulo del VENDEDOR.

- Sus despachos, solo lectura: los de los clientes de sus rutas de venta,
  para saber si ya se cargaron, si ya salieron y si ya llegaron.
- Sus visitas de la semana: cada cliente de sus rutas esta "por visitar",
  "en el cliente" o "atendido". Una visita toma el GPS una sola vez, al
  empezar (con eso se mide si de verdad fue al cliente), y al terminarla se
  guardan la hora de salida y las observaciones.
- El rendimiento por vendedor para el dashboard (solo ADMIN).

Las rutas del vendedor son las del sistema de ventas (VendedorRuta: R1..R8,
10, 11...) y sus clientes, los VentaCliente de esas rutas. El cruce con el
cliente de logistica (despachos, coordenadas) es por (empresa, codigo).
"""

from __future__ import annotations

import calendar
import uuid
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException

from app.core.auth import requiere_rol
from app.core.db import get_connection
from app.core.permisos import rutas_del_vendedor
from app.core.ubicacion import sin_ubicacion
from app.schemas import (
    DespachosVendedor,
    IniciarVisitaRequest,
    RendimientoVendedores,
    RutaVenta,
    TerminarVisitaRequest,
    Visita,
    VisitasSemana,
)
from app.services import indicadores_venta as iv
from app.services.route_analysis import LatLng, haversine_km

router = APIRouter(prefix="/vendedor", tags=["vendedor"])

# Venezuela no tiene horario de verano desde 2016: la hora de Caracas es
# UTC-4 fija. Se calcula asi, y no con zoneinfo, para no depender de la
# base de zonas horarias (en Windows no viene instalada).
_DESFASE_CARACAS = timedelta(hours=-4)

# Despachos que ve el vendedor: los de los ultimos dias, mas cualquiera que
# siga abierto aunque sea mas viejo.
DIAS_DESPACHOS = 30
_ESTADOS_CERRADOS = ["ENTREGADO", "CANCELADO", "RECHAZADO"]

# A partir de esta distancia entre el GPS de la llegada y el cliente, la
# visita se marca como "lejos del cliente" en el rendimiento. Holgado a
# proposito: el GPS de un telefono dentro de un local puede errar decenas de
# metros, y la coordenada del cliente tampoco es exacta.
DISTANCIA_MAX_AL_CLIENTE_M = 300

# El filtro por las rutas del vendedor, como "EMPRESA|RUTA" = ANY(...): una
# sola condicion para cualquier cantidad de rutas y de las dos empresas.
_ES_DE_SUS_RUTAS = "(vc.\"empresa\"::text || '|' || vc.\"ruta\") = ANY(%s)"


def hoy_caracas() -> date:
    return (datetime.now(timezone.utc) + _DESFASE_CARACAS).date()


def lunes_de(dia: date) -> date:
    """Inicio de la semana ISO: cada lunes todos los clientes vuelven a
    "por visitar" sin borrar nada, porque el estatus se calcula filtrando las
    visitas por semana."""
    return dia - timedelta(days=dia.weekday())


def _claves(rutas: list[tuple[str, str]]) -> list[str]:
    return [f"{empresa}|{ruta}" for empresa, ruta in rutas]


@router.get("/rutas-disponibles", response_model=list[RutaVenta], dependencies=[Depends(requiere_rol("ADMIN"))])
def rutas_disponibles():
    """Las rutas que se le pueden asignar a un vendedor: las que existen en
    las ventas cargadas (modulo de indicadores)."""
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute('SELECT DISTINCT "empresa", "ruta" FROM "VentaCliente"')
        filas = cur.fetchall()
    return sorted(filas, key=lambda r: (r["empresa"], iv.orden_ruta(r["ruta"])))


@router.get("/despachos", response_model=DespachosVendedor)
def mis_despachos(usuario: dict = Depends(requiere_rol("VENDEDOR"))):
    with get_connection() as conn, conn.cursor() as cur:
        rutas = rutas_del_vendedor(cur, usuario["id"])
        despachos = []
        if rutas:
            cur.execute(
                'SELECT d."id", d."numero", d."numeroDocumento", d."estado", d."fechaCreacion", '
                'd."llegadaEn", d."entregadoEn", r."numero" AS "rutaNumero", r."estado" AS "rutaEstado", '
                'cl."empresa", cl."codigo" AS "clienteCodigo", cl."nombre" AS "clienteNombre", '
                'vc."ruta" AS "rutaVenta" '
                'FROM "Despacho" d '
                'JOIN "Cliente" cl ON cl."id" = d."destinoClienteId" '
                'JOIN "VentaCliente" vc ON vc."empresa" = cl."empresa" AND vc."codigo" = cl."codigo" '
                'LEFT JOIN "Ruta" r ON r."id" = d."rutaId" '
                f"WHERE {_ES_DE_SUS_RUTAS} "
                'AND (d."fechaCreacion" >= now() - %s::interval OR d."estado" <> ALL(%s)) '
                'ORDER BY d."fechaCreacion" DESC',
                (_claves(rutas), f"{DIAS_DESPACHOS} days", _ESTADOS_CERRADOS),
            )
            despachos = cur.fetchall()
    return {"rutas": _rutas_ordenadas(rutas), "despachos": despachos}


def _rutas_ordenadas(rutas: list[tuple[str, str]]) -> list[dict]:
    return [
        {"empresa": empresa, "ruta": ruta}
        for empresa, ruta in sorted(rutas, key=lambda r: (r[0], iv.orden_ruta(r[1])))
    ]


def _clientes_de_sus_rutas(cur, rutas: list[tuple[str, str]]) -> list[dict]:
    """Los clientes de sus rutas, con las coordenadas del maestro de
    logistica si estan ahi (y no en 0,0)."""
    cur.execute(
        'SELECT vc."empresa", vc."codigo", vc."nombre", vc."ruta", cl."lat", cl."lng" '
        'FROM "VentaCliente" vc '
        'LEFT JOIN "Cliente" cl ON cl."empresa" = vc."empresa" AND cl."codigo" = vc."codigo" '
        f"WHERE {_ES_DE_SUS_RUTAS} "
        'ORDER BY vc."ruta", vc."nombre"',
        (_claves(rutas),),
    )
    clientes = cur.fetchall()
    for c in clientes:
        if sin_ubicacion(c["lat"], c["lng"]):
            c["lat"] = c["lng"] = None
    return clientes


_ORDEN_ESTATUS = {"en_cliente": 0, "por_visitar": 1, "atendido": 2}


@router.get("/visitas/semana", response_model=VisitasSemana)
def visitas_de_la_semana(usuario: dict = Depends(requiere_rol("VENDEDOR"))):
    semana = lunes_de(hoy_caracas())
    with get_connection() as conn, conn.cursor() as cur:
        rutas = rutas_del_vendedor(cur, usuario["id"])
        clientes = _clientes_de_sus_rutas(cur, rutas) if rutas else []
        # Las de esta semana, mas una que haya quedado abierta de antes: esa
        # sigue "en el cliente" hasta que la termine.
        cur.execute(
            'SELECT * FROM "Visita" WHERE "vendedorId" = %s AND ("semana" = %s OR "salidaEn" IS NULL) '
            'ORDER BY "llegadaEn"',
            (usuario["id"], semana),
        )
        visitas = cur.fetchall()

    por_cliente: dict[tuple[str, str], list[dict]] = {}
    for v in visitas:
        por_cliente.setdefault((v["empresa"], v["codigoCliente"]), []).append(v)

    resultado = []
    for c in clientes:
        propias = por_cliente.get((c["empresa"], c["codigo"]), [])
        if any(v["salidaEn"] is None for v in propias):
            estatus = "en_cliente"
        elif propias:
            estatus = "atendido"
        else:
            estatus = "por_visitar"
        resultado.append({**c, "estatus": estatus, "visitas": propias})
    # Estable: dentro de cada estatus se mantiene el orden por ruta y nombre.
    resultado.sort(key=lambda c: _ORDEN_ESTATUS[c["estatus"]])

    return {
        "semana": semana,
        "rutas": _rutas_ordenadas(rutas),
        "clientes": resultado,
        "visitaAbierta": next((v for v in visitas if v["salidaEn"] is None), None),
    }


@router.post("/visitas", response_model=Visita, status_code=201)
def iniciar_visita(data: IniciarVisitaRequest, usuario: dict = Depends(requiere_rol("VENDEDOR"))):
    """Empieza la encuesta de una visita: guarda la hora de llegada y la
    unica toma de GPS, y la distancia de ese punto al cliente."""
    codigo = data.codigoCliente.strip()
    if not (-90 <= data.lat <= 90 and -180 <= data.lng <= 180) or sin_ubicacion(data.lat, data.lng):
        raise HTTPException(400, "La ubicacion del telefono no es valida: vuelve a intentarlo con el GPS activado")

    with get_connection() as conn, conn.cursor() as cur:
        rutas = rutas_del_vendedor(cur, usuario["id"])
        cur.execute(
            'SELECT vc."nombre", cl."lat", cl."lng" FROM "VentaCliente" vc '
            'LEFT JOIN "Cliente" cl ON cl."empresa" = vc."empresa" AND cl."codigo" = vc."codigo" '
            f'WHERE vc."empresa" = %s AND vc."codigo" = %s AND {_ES_DE_SUS_RUTAS}',
            (data.empresa, codigo, _claves(rutas)),
        )
        cliente = cur.fetchone()
        if not cliente:
            raise HTTPException(404, "Ese cliente no es de tus rutas")

        cur.execute(
            'SELECT v."codigoCliente", vc."nombre" FROM "Visita" v '
            'LEFT JOIN "VentaCliente" vc ON vc."empresa" = v."empresa" AND vc."codigo" = v."codigoCliente" '
            'WHERE v."vendedorId" = %s AND v."salidaEn" IS NULL',
            (usuario["id"],),
        )
        abierta = cur.fetchone()
        if abierta:
            raise HTTPException(
                400,
                f'Tienes una visita abierta en {abierta["nombre"] or abierta["codigoCliente"]}: '
                "terminala antes de empezar otra.",
            )

        distancia_m = None
        if not sin_ubicacion(cliente["lat"], cliente["lng"]):
            distancia_m = round(
                haversine_km(LatLng(lat=data.lat, lng=data.lng), LatLng(lat=cliente["lat"], lng=cliente["lng"]))
                * 1000
            )

        cur.execute(
            'INSERT INTO "Visita" ("id", "vendedorId", "empresa", "codigoCliente", "semana", "llegadaEn", '
            '"llegadaLat", "llegadaLng", "llegadaPrecisionM", "distanciaClienteM") '
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING *",
            (
                f"vis-{uuid.uuid4().hex[:10]}", usuario["id"], data.empresa, codigo, lunes_de(hoy_caracas()),
                datetime.now(), data.lat, data.lng, data.precisionM, distancia_m,
            ),
        )
        visita = cur.fetchone()
        conn.commit()
        return visita


@router.post("/visitas/{visita_id}/salida", response_model=Visita)
def terminar_visita(
    visita_id: str, data: TerminarVisitaRequest, usuario: dict = Depends(requiere_rol("VENDEDOR"))
):
    """Cierra la visita: hora de salida y observaciones. Sin GPS: la
    ubicacion se toma una sola vez, al empezar."""
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            'SELECT * FROM "Visita" WHERE "id" = %s AND "vendedorId" = %s FOR UPDATE', (visita_id, usuario["id"])
        )
        visita = cur.fetchone()
        if not visita:
            raise HTTPException(404, "Visita no encontrada")
        if visita["salidaEn"] is not None:
            raise HTTPException(400, "Esta visita ya estaba terminada")

        observaciones = (data.observaciones or "").strip() or None
        cur.execute(
            'UPDATE "Visita" SET "salidaEn" = %s, "observaciones" = %s WHERE "id" = %s RETURNING *',
            (datetime.now(), observaciones, visita_id),
        )
        actualizada = cur.fetchone()
        conn.commit()
        return actualizada


# ---------- Rendimiento (dashboard, solo ADMIN) ----------


def _meses_con_datos(cur) -> dict[str, tuple[date, date]]:
    """Por empresa, el ultimo mes con ventas cargadas: es el que se usa para
    la venta de las rutas de cada vendedor."""
    cur.execute(
        'SELECT v."empresa", MAX(v."fecha") AS "hasta" FROM "Venta" v '
        'JOIN "VentaCarga" c ON c."id" = v."cargaId" AND c."estado" = \'CONFIRMADA\' '
        'WHERE v."reemplazadaPorCargaId" IS NULL GROUP BY v."empresa"'
    )
    meses = {}
    for r in cur.fetchall():
        hasta: date = r["hasta"]
        meses[r["empresa"]] = (
            hasta.replace(day=1),
            hasta.replace(day=calendar.monthrange(hasta.year, hasta.month)[1]),
        )
    return meses


def _venta_de_sus_rutas(cur, rutas: list[tuple[str, str]], meses: dict[str, tuple[date, date]]) -> float | None:
    total = None
    for empresa in sorted({e for e, _ in rutas}):
        if empresa not in meses:
            continue
        desde, hasta = meses[empresa]
        resultado = iv.calcular(
            cur, iv.Filtros(empresa, desde, hasta, rutas=[ruta for e, ruta in rutas if e == empresa])
        )
        if resultado:
            total = (total or 0.0) + resultado["ventaNeta"]
    return total


@router.get(
    "/rendimiento",
    response_model=RendimientoVendedores,
    dependencies=[Depends(requiere_rol("ADMIN"))],
)
def rendimiento_vendedores(semana: date | None = None):
    lunes = lunes_de(semana or hoy_caracas())
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute('SELECT "id", "nombre" FROM "Usuario" WHERE "rol" = \'VENDEDOR\' AND "activo" ORDER BY "nombre"')
        vendedores = cur.fetchall()

        cur.execute('SELECT "usuarioId", "empresa", "ruta" FROM "VendedorRuta"')
        rutas_por_vendedor: dict[str, list[tuple[str, str]]] = {}
        for r in cur.fetchall():
            rutas_por_vendedor.setdefault(r["usuarioId"], []).append((r["empresa"], r["ruta"]))

        cur.execute('SELECT "empresa", "ruta", COUNT(*) AS "clientes" FROM "VentaCliente" GROUP BY 1, 2')
        clientes_por_ruta = {(r["empresa"], r["ruta"]): r["clientes"] for r in cur.fetchall()}

        cur.execute(
            'SELECT "vendedorId", "empresa", "codigoCliente", "llegadaEn", "salidaEn", "distanciaClienteM" '
            'FROM "Visita" WHERE "semana" = %s',
            (lunes,),
        )
        visitas_por_vendedor: dict[str, list[dict]] = {}
        for v in cur.fetchall():
            visitas_por_vendedor.setdefault(v["vendedorId"], []).append(v)

        meses = _meses_con_datos(cur)
        filas = []
        for vendedor in vendedores:
            rutas = sorted(rutas_por_vendedor.get(vendedor["id"], []), key=lambda r: (r[0], iv.orden_ruta(r[1])))
            visitas = visitas_por_vendedor.get(vendedor["id"], [])
            asignados = sum(clientes_por_ruta.get(r, 0) for r in rutas)
            atendidos = {(v["empresa"], v["codigoCliente"]) for v in visitas if v["salidaEn"]}
            minutos = [(v["salidaEn"] - v["llegadaEn"]).total_seconds() / 60 for v in visitas if v["salidaEn"]]
            una_empresa = len({e for e, _ in rutas}) <= 1
            filas.append({
                "vendedorId": vendedor["id"],
                "nombre": vendedor["nombre"],
                "rutas": [ruta if una_empresa else f"{ruta} ({empresa})" for empresa, ruta in rutas],
                "clientesAsignados": asignados,
                "clientesAtendidos": len(atendidos),
                "coberturaPct": round(len(atendidos) / asignados * 100, 1) if asignados else None,
                "visitas": len(visitas),
                "promedioMinEnCliente": round(sum(minutos) / len(minutos), 1) if minutos else None,
                "visitasLejos": sum(
                    1 for v in visitas
                    if v["distanciaClienteM"] is not None and v["distanciaClienteM"] > DISTANCIA_MAX_AL_CLIENTE_M
                ),
                "ultimaVisita": max((v["llegadaEn"] for v in visitas), default=None),
                "ventaNetaMes": _venta_de_sus_rutas(cur, rutas, meses) if rutas else None,
            })

    return {
        "semana": lunes,
        "mesVenta": max((desde for desde, _ in meses.values()), default=None),
        "distanciaMaxM": DISTANCIA_MAX_AL_CLIENTE_M,
        "porVendedor": filas,
    }
