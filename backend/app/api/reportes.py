"""Descargas en Excel para el seguimiento del negocio: cartera de clientes,
despachos realizados y rutas realizadas.

Son reportes de gestion, asi que quedan fuera del alcance del REPARTIDOR
(ver app/core/permisos.py): quien reparte no descarga la operacion completa.

Cada endpoint arma el archivo en memoria con openpyxl y lo devuelve como
adjunto. Las consultas traen todo de una vez (sin N+1) porque un reporte
puede abarcar miles de filas.
"""

from __future__ import annotations

import io
from datetime import datetime

import openpyxl
from fastapi import APIRouter, Depends, Response
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

from app.core.auth import requiere_rol
from app.core.db import get_connection
from app.core.ubicacion import sin_ubicacion
from app.schemas import ResumenRendimiento

router = APIRouter(
    prefix="/reportes",
    tags=["reportes"],
    dependencies=[Depends(requiere_rol("DESPACHOS", "APROBADOR"))],
)

# Mismo naranja de la interfaz, para que el archivo se vea de la casa.
_RELLENO_ENCABEZADO = PatternFill("solid", fgColor="E8492C")
_LETRA_ENCABEZADO = Font(color="FFFFFF", bold=True)
_ANCHO_MAXIMO = 60


def _escribir_hoja(hoja, encabezados: list[str], filas: list[list]) -> None:
    """Vuelca una tabla con encabezado fijo, filtros y columnas al ancho de
    su contenido — para que el Excel sea usable sin tener que acomodarlo."""
    hoja.append(encabezados)
    for celda in hoja[1]:
        celda.fill = _RELLENO_ENCABEZADO
        celda.font = _LETRA_ENCABEZADO
        celda.alignment = Alignment(vertical="center")
    for fila in filas:
        hoja.append(fila)

    hoja.freeze_panes = "A2"
    if filas:
        hoja.auto_filter.ref = f"A1:{get_column_letter(len(encabezados))}{len(filas) + 1}"

    for i, encabezado in enumerate(encabezados, start=1):
        largos = [len(str(encabezado))] + [
            len(str(fila[i - 1])) for fila in filas if i <= len(fila) and fila[i - 1] is not None
        ]
        hoja.column_dimensions[get_column_letter(i)].width = min(_ANCHO_MAXIMO, max(largos) + 2)


def _como_adjunto(libro, nombre: str) -> Response:
    buffer = io.BytesIO()
    libro.save(buffer)
    fecha = datetime.now().strftime("%Y-%m-%d")
    return Response(
        content=buffer.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{nombre}_{fecha}.xlsx"'},
    )


def _minutos(desde, hasta) -> float | None:
    if desde is None or hasta is None:
        return None
    return round((hasta - desde).total_seconds() / 60, 1)


# El conductor de un viaje es el usuario REPARTIDOR que tiene ese vehiculo
# asignado; si no hay ninguno, el nombre suelto de la ficha del vehiculo.
_CONDUCTOR = 'COALESCE(u."nombre", v."conductorNombre")'
_JOIN_CONDUCTOR = (
    'LEFT JOIN "Usuario" u ON u."vehiculoAsignadoId" = v."id" AND u."rol" = \'REPARTIDOR\''
)


@router.get("/clientes.xlsx")
def reporte_clientes():
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute('SELECT * FROM "Cliente" ORDER BY "empresa", "nombre"')
        clientes = cur.fetchall()

    filas = [
        [
            c["empresa"], c["codigo"], c["nombre"], c["tipo"], c["direccion"], c["ciudad"],
            c["rutaComercial"], c["telefono"], c["email"], c["lat"], c["lng"],
            "No" if sin_ubicacion(c["lat"], c["lng"]) else "Si",
        ]
        for c in clientes
    ]
    libro = openpyxl.Workbook()
    libro.active.title = "Clientes"
    _escribir_hoja(
        libro.active,
        ["Empresa", "Codigo", "Nombre", "Tipo", "Direccion", "Ciudad", "Ruta comercial",
         "Telefono", "Email", "Latitud", "Longitud", "Ubicacion valida"],
        filas,
    )
    return _como_adjunto(libro, "clientes")


@router.get("/despachos.xlsx")
def reporte_despachos():
    """Un despacho por fila, con su cliente, su viaje y los tiempos de la
    parada; y una segunda hoja con el detalle de productos despachados."""
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            'SELECT d.*, '
            'c."empresa" AS "clienteEmpresa", c."codigo" AS "clienteCodigo", c."nombre" AS "clienteNombre", '
            'c."ciudad" AS "clienteCiudad", c."direccion" AS "clienteDireccion", '
            'c."telefono" AS "clienteTelefono", c."rutaComercial" AS "clienteRutaComercial", '
            'r."numero" AS "rutaNumero", r."iniciadaEn" AS "rutaIniciadaEn", '
            'v."placa" AS "vehiculoPlaca", '
            f'{_CONDUCTOR} AS "conductor", '
            'usr."nombre" AS "creadoPor" '
            'FROM "Despacho" d '
            'JOIN "Cliente" c ON c."id" = d."destinoClienteId" '
            'JOIN "Usuario" usr ON usr."id" = d."creadoPorId" '
            'LEFT JOIN "Ruta" r ON r."id" = d."rutaId" '
            'LEFT JOIN "Vehiculo" v ON v."id" = r."vehiculoId" '
            f'{_JOIN_CONDUCTOR} '
            'ORDER BY d."fechaCreacion" DESC, d."numero"',
            (),
        )
        despachos = cur.fetchall()

        cur.execute(
            'SELECT "despachoId", "descripcion", "cantidadSolicitada", "cantidad", "pesoUnitarioKg" '
            'FROM "DespachoItem"'
        )
        items_por_despacho: dict[str, list[dict]] = {}
        for item in cur.fetchall():
            items_por_despacho.setdefault(item["despachoId"], []).append(item)

    # Tiempo de traslado: desde que se entrego la parada anterior del mismo
    # viaje hasta que se llego a esta. Para la primera parada, desde que la
    # ruta salio del almacen.
    entrega_anterior: dict[str, datetime] = {}
    for d in sorted(
        (d for d in despachos if d["rutaId"]),
        key=lambda d: (d["rutaId"], d["ordenEnRuta"] or 0),
    ):
        previa = entrega_anterior.get(d["rutaId"]) or d["rutaIniciadaEn"]
        d["trasladoMin"] = _minutos(previa, d["llegadaEn"])
        if d["entregadoEn"]:
            entrega_anterior[d["rutaId"]] = d["entregadoEn"]

    filas = []
    for d in despachos:
        items = items_por_despacho.get(d["id"], [])
        peso = sum(i["cantidad"] * i["pesoUnitarioKg"] for i in items)
        filas.append([
            d["numero"], d["numeroDocumento"], d["estado"], d["fechaCreacion"],
            d["clienteEmpresa"], d["clienteCodigo"], d["clienteNombre"], d["clienteCiudad"],
            d["clienteDireccion"], d["clienteTelefono"], d["clienteRutaComercial"],
            d["rutaNumero"], d["ordenEnRuta"], d["vehiculoPlaca"], d["conductor"],
            len(items), round(peso, 3),
            d["llegadaEn"], d["entregadoEn"],
            _minutos(d["llegadaEn"], d["entregadoEn"]), d.get("trasladoMin"),
            d["creadoPor"],
        ])

    libro = openpyxl.Workbook()
    libro.active.title = "Despachos"
    _escribir_hoja(
        libro.active,
        ["N Despacho", "Documento", "Estado", "Fecha creacion", "Empresa", "Cod. cliente",
         "Cliente", "Ciudad", "Direccion", "Telefono", "Ruta comercial", "Ruta (viaje)",
         "Orden en ruta", "Vehiculo", "Conductor", "N items", "Peso total (kg)",
         "Llegada", "Entrega", "Min. en el cliente", "Min. de traslado", "Creado por"],
        filas,
    )

    detalle = [
        [d["numero"], d["numeroDocumento"], d["clienteNombre"], d["rutaNumero"],
         i["descripcion"], i["cantidadSolicitada"], i["cantidad"], i["pesoUnitarioKg"],
         round(i["cantidad"] * i["pesoUnitarioKg"], 3)]
        for d in despachos
        for i in items_por_despacho.get(d["id"], [])
    ]
    _escribir_hoja(
        libro.create_sheet("Productos"),
        ["N Despacho", "Documento", "Cliente", "Ruta (viaje)", "Producto", "Solicitado",
         "Despachado", "Peso unitario (kg)", "Peso total (kg)"],
        detalle,
    )
    return _como_adjunto(libro, "despachos")


@router.get("/rutas.xlsx")
def reporte_rutas():
    """Un viaje por fila: vehiculo, conductor, paradas, kilometros y la
    duracion real contra la estimada."""
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            'SELECT r.*, v."placa" AS "vehiculoPlaca", v."tipo" AS "vehiculoTipo", '
            'v."capacidadKg" AS "vehiculoCapacidad", '
            f'{_CONDUCTOR} AS "conductor", '
            'usr."nombre" AS "creadoPor" '
            'FROM "Ruta" r '
            'JOIN "Vehiculo" v ON v."id" = r."vehiculoId" '
            'JOIN "Usuario" usr ON usr."id" = r."creadoPorId" '
            f'{_JOIN_CONDUCTOR} '
            'ORDER BY r."fechaCreacion" DESC'
        )
        rutas = cur.fetchall()

        cur.execute(
            'SELECT d."rutaId", d."id", d."estado", d."llegadaEn", d."entregadoEn", '
            'COALESCE(SUM(i."cantidad" * i."pesoUnitarioKg"), 0) AS "peso" '
            'FROM "Despacho" d LEFT JOIN "DespachoItem" i ON i."despachoId" = d."id" '
            'WHERE d."rutaId" IS NOT NULL '
            'GROUP BY d."rutaId", d."id", d."estado", d."llegadaEn", d."entregadoEn"'
        )
        por_ruta: dict[str, list[dict]] = {}
        for fila in cur.fetchall():
            por_ruta.setdefault(fila["rutaId"], []).append(fila)

    filas = []
    for r in rutas:
        paradas = por_ruta.get(r["id"], [])
        entregadas = [p for p in paradas if p["estado"] == "ENTREGADO"]
        atenciones = [m for p in paradas if (m := _minutos(p["llegadaEn"], p["entregadoEn"])) is not None]
        duracion_real = _minutos(r["iniciadaEn"], r["completadaEn"])
        filas.append([
            r["numero"], r["estado"], r["fechaCreacion"], r["vehiculoPlaca"], r["vehiculoTipo"],
            r["vehiculoCapacidad"], r["conductor"],
            len(paradas), len(entregadas), round(sum(p["peso"] for p in paradas), 3),
            r["distanciaTotalKm"], r["tiempoTotalMin"],
            r["iniciadaEn"], r["completadaEn"], duracion_real,
            round(duracion_real - r["tiempoTotalMin"], 1)
            if duracion_real is not None and r["tiempoTotalMin"] is not None
            else None,
            round(sum(atenciones) / len(atenciones), 1) if atenciones else None,
            r["creadoPor"],
        ])

    libro = openpyxl.Workbook()
    libro.active.title = "Rutas"
    _escribir_hoja(
        libro.active,
        ["N Ruta", "Estado", "Fecha creacion", "Vehiculo", "Tipo", "Capacidad (kg)", "Conductor",
         "Paradas", "Entregadas", "Peso total (kg)", "Distancia (km)", "Tiempo estimado (min)",
         "Salida del almacen", "Fin del viaje", "Duracion real (min)", "Desvio vs estimado (min)",
         "Promedio por parada (min)", "Creada por"],
        filas,
    )
    return _como_adjunto(libro, "rutas")


# Ventana de los indicadores del dashboard: lo suficientemente corta para
# reflejar como viene operando el equipo, no el historico completo.
DIAS_DE_RENDIMIENTO = 30

# Una parada entregada, con sus dos marcas y el traslado desde la entrega
# anterior del mismo viaje (o desde la salida del almacen, si es la
# primera). LAG hace ese "anterior" en una sola pasada, sin traerse todo a
# Python.
_PARADAS_CON_TIEMPOS = f"""
    WITH paradas AS (
        SELECT d."rutaId", d."llegadaEn", d."entregadoEn", r."iniciadaEn", r."vehiculoId",
               LAG(d."entregadoEn") OVER (
                   PARTITION BY d."rutaId" ORDER BY d."ordenEnRuta"
               ) AS "entregaAnterior"
        FROM "Despacho" d
        JOIN "Ruta" r ON r."id" = d."rutaId"
        WHERE d."entregadoEn" IS NOT NULL
          AND d."entregadoEn" >= now() - interval '{DIAS_DE_RENDIMIENTO} days'
    )
    SELECT "vehiculoId",
           EXTRACT(EPOCH FROM ("entregadoEn" - "llegadaEn")) / 60 AS atencion,
           EXTRACT(EPOCH FROM ("llegadaEn" - COALESCE("entregaAnterior", "iniciadaEn"))) / 60 AS traslado
    FROM paradas
    WHERE "llegadaEn" IS NOT NULL
"""


def _promedio(valores: list[float]) -> float | None:
    limpios = [v for v in valores if v is not None]
    return round(sum(limpios) / len(limpios), 1) if limpios else None


@router.get("/resumen", response_model=ResumenRendimiento, dependencies=[Depends(requiere_rol("ADMIN"))])
def resumen_rendimiento():
    """Indicadores de rendimiento del reparto para el dashboard: cuanto se
    entrego, cuanto se tarda en cada cliente y como le va a cada conductor.
    Solo ADMIN — es la foto completa de la operacion."""
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(f'SELECT * FROM ({_PARADAS_CON_TIEMPOS}) t')
        tiempos = cur.fetchall()

        cur.execute(
            'SELECT COUNT(DISTINCT d."id") AS "entregas", '
            '       COALESCE(SUM(i."cantidad" * i."pesoUnitarioKg"), 0) AS "kg" '
            'FROM "Despacho" d '
            'LEFT JOIN "DespachoItem" i ON i."despachoId" = d."id" '
            'WHERE d."entregadoEn" >= now() - %s::interval',
            (f"{DIAS_DE_RENDIMIENTO} days",),
        )
        totales = cur.fetchone()
        entregas = totales["entregas"]

        cur.execute(
            f'SELECT {_CONDUCTOR} AS "conductor", v."placa", '
            '       COUNT(DISTINCT r."id") AS "viajes", '
            '       COUNT(d."id") FILTER (WHERE d."entregadoEn" IS NOT NULL) AS "entregas", '
            '       COALESCE(SUM(DISTINCT r."distanciaTotalKm"), 0) AS "km" '
            'FROM "Ruta" r '
            'JOIN "Vehiculo" v ON v."id" = r."vehiculoId" '
            f'{_JOIN_CONDUCTOR} '
            'LEFT JOIN "Despacho" d ON d."rutaId" = r."id" '
            'WHERE r."fechaCreacion" >= now() - %s::interval '
            f'GROUP BY {_CONDUCTOR}, v."placa" '
            'ORDER BY "entregas" DESC',
            (f"{DIAS_DE_RENDIMIENTO} days",),
        )
        por_vehiculo = cur.fetchall()

    atencion_por_vehiculo: dict[str, list[float]] = {}
    for t in tiempos:
        atencion_por_vehiculo.setdefault(t["vehiculoId"], []).append(t["atencion"])

    return {
        "dias": DIAS_DE_RENDIMIENTO,
        "entregas": entregas,
        "kgEntregados": round(float(totales["kg"]), 1),
        "paradasMedidas": len(tiempos),
        "promedioAtencionMin": _promedio([t["atencion"] for t in tiempos]),
        "promedioTrasladoMin": _promedio([t["traslado"] for t in tiempos]),
        "porConductor": [
            {
                "conductor": v["conductor"],
                "placa": v["placa"],
                "viajes": v["viajes"],
                "entregas": v["entregas"],
                "distanciaKm": round(float(v["km"]), 1),
            }
            for v in por_vehiculo
        ],
    }
