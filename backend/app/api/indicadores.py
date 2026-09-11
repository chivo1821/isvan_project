"""Indicadores de venta — solo ADMIN.

Dos partes:

- Cargas: el extracto de ventas se sube, se valida y recien despues se
  confirma (la validacion es, segun el cliente, lo mas valioso del modulo).
  Toda carga queda registrada y se puede revertir.
- Indicadores: todo se agrega en la base. Las definiciones viven en un solo
  lugar, app/services/indicadores_venta.py; aca solo se eligen periodo,
  filtros y agrupacion.

Regla de solape: el archivo nuevo manda en su periodo. Al confirmar una
carga, las filas de cargas anteriores con fecha dentro de su rango quedan
marcadas como reemplazadas (no se borran), asi el cierre mensual reemplaza
a los extractos diarios sin contar dos veces, y revertir el cierre los
devuelve.
"""

from __future__ import annotations

import statistics
import uuid
from dataclasses import replace
from datetime import date

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from psycopg.types.json import Jsonb

from app.core.auth import requiere_rol
from app.core.db import get_connection
from app.core.ubicacion import fuera_de_venezuela, sin_ubicacion
from app.services import indicadores_venta as iv
from app.services.ventas_import import ExtractoVentas, leer_extracto

router = APIRouter(
    prefix="/indicadores",
    tags=["indicadores"],
    dependencies=[Depends(requiere_rol("ADMIN"))],
)

EMPRESAS = ("ISVAN", "TRALOG")
# Limite de Vercel para el cuerpo de una request (4.5 MB). Se valida aca
# tambien para que en local el error sea el mismo que en produccion.
TAMANO_MAXIMO_BYTES = 4_500_000
# Una carga analizada y nunca confirmada ni descartada se limpia sola.
HORAS_CARGA_PENDIENTE = 24
# Tasa Bs/USD fuera de +-50% de la mediana del archivo = fila sospechosa.
# Tambien la tasa 1 exacta: bolivares copiados en la columna de divisas.
RANGO_TASA = 0.5
MUESTRA = 15
LIMITE_LISTA = 200


def _validar_empresa(empresa: str) -> str:
    if empresa not in EMPRESAS:
        raise HTTPException(400, "empresa debe ser ISVAN o TRALOG")
    return empresa


def _filtros(
    empresa: str,
    desde: date,
    hasta: date,
    ruta: list[str] = Query(default=[]),
    grupo: list[str] = Query(default=[]),
    tipo_cliente: list[str] = Query(default=[]),
    cliente: list[str] = Query(default=[]),
    producto: list[int] = Query(default=[]),
) -> iv.Filtros:
    _validar_empresa(empresa)
    if desde > hasta:
        raise HTTPException(400, "La fecha desde no puede ser posterior a la fecha hasta")
    return iv.Filtros(empresa, desde, hasta, ruta, grupo, tipo_cliente, cliente, producto)


# Compartido con app/api/vendedor.py.
_orden_ruta = iv.orden_ruta


# ---------- Indicadores ----------


@router.get("/opciones")
def opciones(empresa: str):
    """Valores para los filtros y el rango de fechas con datos."""
    _validar_empresa(empresa)
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute('SELECT DISTINCT "ruta" FROM "VentaCliente" WHERE "empresa" = %s', (empresa,))
        rutas = sorted((r["ruta"] for r in cur.fetchall()), key=_orden_ruta)
        cur.execute('SELECT DISTINCT "grupo" FROM "VentaProducto" WHERE "empresa" = %s ORDER BY 1', (empresa,))
        grupos = [r["grupo"] for r in cur.fetchall()]
        cur.execute('SELECT DISTINCT "tipo" FROM "VentaCliente" WHERE "empresa" = %s ORDER BY 1', (empresa,))
        tipos = [r["tipo"] for r in cur.fetchall()]
        # Para los filtros de cliente y de producto (SKU), que traen buscador.
        cur.execute(
            'SELECT "codigo", "nombre", "ruta" FROM "VentaCliente" WHERE "empresa" = %s ORDER BY "nombre", "codigo"',
            (empresa,),
        )
        clientes = cur.fetchall()
        cur.execute(
            'SELECT "codigo"::text AS "codigo", "nombre", "grupo" FROM "VentaProducto" '
            'WHERE "empresa" = %s ORDER BY "nombre", "codigo"',
            (empresa,),
        )
        productos = cur.fetchall()
        cur.execute(
            'SELECT MIN(v."fecha") AS "desde", MAX(v."fecha") AS "hasta" '
            'FROM "Venta" v JOIN "VentaCarga" c ON c."id" = v."cargaId" AND c."estado" = \'CONFIRMADA\' '
            'WHERE v."empresa" = %s AND v."reemplazadaPorCargaId" IS NULL',
            (empresa,),
        )
        rango = cur.fetchone()
        cur.execute(
            "SELECT COUNT(*) FILTER (WHERE \"estado\" = 'CONFIRMADA') AS \"confirmadas\", "
            "COUNT(*) FILTER (WHERE \"estado\" = 'PENDIENTE') AS \"pendientes\" "
            'FROM "VentaCarga" WHERE "empresa" = %s',
            (empresa,),
        )
        cargas = cur.fetchone()
    return {
        "rutas": rutas,
        "grupos": grupos,
        "tiposCliente": tipos,
        "clientes": clientes,
        "productos": productos,
        "fechaMin": rango["desde"],
        "fechaMax": rango["hasta"],
        "cargasConfirmadas": cargas["confirmadas"],
        "cargasPendientes": cargas["pendientes"],
    }


@router.get("/tablero")
def tablero(f: iv.Filtros = Depends(_filtros)):
    """Todo lo que muestra la pagina de indicadores, en una sola llamada y
    con una sola conexion: en Vercel cada request es una invocacion aparte
    de la funcion, y la pagina necesita una docena de consultas."""
    with get_connection() as conn, conn.cursor() as cur:
        desgloses = {}
        for dimension in iv.DIMENSIONES:
            filas, total = iv.desglose(cur, f, dimension)
            desgloses[dimension] = {"filas": filas, "totalGrupos": total}
        return {
            "resumen": _resumen(cur, f),
            "serie": {"mes": iv.serie(cur, f, "mes"), "semana": iv.serie(cur, f, "semana")},
            "desgloses": desgloses,
            "alertas": _alertas(cur, f),
            "mapa": _mapa(cur, f),
            "brechas": _brechas(cur, f),
        }


@router.get("/resumen")
def resumen(f: iv.Filtros = Depends(_filtros)):
    """Solo los indicadores del periodo y su comparacion, sin el resto del
    tablero: es lo que muestra el dashboard de Inicio."""
    with get_connection() as conn, conn.cursor() as cur:
        return _resumen(cur, f)


def _resumen(cur, f: iv.Filtros) -> dict:
    """Indicadores del periodo, los del periodo anterior y la variacion."""
    desde_ant, hasta_ant, tipo = iv.periodo_anterior(f.desde, f.hasta)
    actual = iv.calcular(cur, f)
    anterior = iv.calcular(cur, replace(f, desde=desde_ant, hasta=hasta_ant))
    return {
        "actual": actual,
        "anterior": anterior,
        "variacion": iv.variacion(actual, anterior) if actual else None,
        "comparacion": {"desde": desde_ant, "hasta": hasta_ant, "tipo": tipo},
    }


def _alertas(cur, f: iv.Filtros) -> dict:
    """Calidad del dato: venta sin costo, costos sospechosos y productos
    con dos codigos."""
    productos = iv.productos_del_periodo(cur, f)
    cur.execute('SELECT "codigo", "nombre" FROM "VentaProducto" WHERE "empresa" = %s', (f.empresa,))
    catalogo = {r["codigo"]: r["nombre"] for r in cur.fetchall()}
    sin_costo = sorted((p for p in productos if not p["tieneCosto"]), key=lambda p: -p["ventaNeta"])
    return {
        "ventaSinCosto": sum(p["ventaNeta"] for p in sin_costo),
        "productosSinCosto": [
            {"codigo": p["codigo"], "nombre": p["nombre"], "grupo": p["grupo"], "ventaNeta": p["ventaNeta"]}
            for p in sin_costo
        ],
        "desviosMargen": iv.desvios_de_margen(productos),
        "productosDuplicados": iv.productos_duplicados(catalogo),
    }


def _mapa(cur, f: iv.Filtros) -> dict:
    """Clientes que compraron en el periodo, ubicados con las coordenadas del
    maestro de clientes de logistica (el extracto de ventas no las trae)."""
    condicion, params = iv.where(f)
    cur.execute(f'SELECT COUNT(DISTINCT v."codigoCliente") AS "n" {iv.FUENTE} {condicion}', params)
    compradores = cur.fetchone()["n"]
    cur.execute(
        'SELECT v."codigoCliente" AS "codigo", MAX(vc."nombre") AS "nombre", MAX(vc."ruta") AS "ruta", '
        'MAX(vc."tipo") AS "tipo", SUM(v."montoUsd") AS "ventaNeta", SUM(v."litros") AS "litros", '
        'MAX(v."fecha") AS "ultimaCompra", cl."lat", cl."lng", cl."ciudad" '
        f'{iv.FUENTE} '
        'JOIN "Cliente" cl ON cl."empresa" = v."empresa" AND cl."codigo" = v."codigoCliente" '
        f'{condicion} '
        'GROUP BY v."codigoCliente", cl."lat", cl."lng", cl."ciudad" '
        'ORDER BY "ventaNeta" DESC',
        params,
    )
    en_logistica = cur.fetchall()
    puntos = [
        {**c, "ventaNeta": float(c["ventaNeta"]), "litros": float(c["litros"])}
        for c in en_logistica
        if not sin_ubicacion(c["lat"], c["lng"]) and not fuera_de_venezuela(c["lat"], c["lng"])
    ]
    return {
        "compradores": compradores,
        "enLogistica": len(en_logistica),
        "conUbicacion": len(puntos),
        "puntos": puntos,
    }


def _brechas(cur, f: iv.Filtros) -> dict:
    """Donde no coinciden ventas y logistica: clientes que compran pero no
    estan en el maestro de despacho (no se les puede armar ruta), clientes
    del maestro sin compras en el periodo, y clientes cuya ruta de venta no
    es la ruta comercial cargada en logistica."""
    condicion, params = iv.where(f)
    cur.execute(
        'SELECT v."codigoCliente" AS "codigo", MAX(vc."nombre") AS "nombre", MAX(vc."ruta") AS "ruta", '
        'MAX(vc."tipo") AS "tipo", SUM(v."montoUsd") AS "ventaNeta", MAX(v."fecha") AS "ultimaCompra" '
        f'{iv.FUENTE} {condicion} '
        'AND NOT EXISTS (SELECT 1 FROM "Cliente" cl WHERE cl."empresa" = v."empresa" AND cl."codigo" = v."codigoCliente") '
        'GROUP BY v."codigoCliente" ORDER BY "ventaNeta" DESC',
        params,
    )
    fuera = [{**c, "ventaNeta": float(c["ventaNeta"])} for c in cur.fetchall()]

    # Solo el periodo: ruta, grupo y tipo son datos del sistema de ventas,
    # que un cliente sin compras no tiene.
    cur.execute(
        'SELECT cl."codigo", cl."nombre", cl."ciudad", cl."rutaComercial" FROM "Cliente" cl '
        'WHERE cl."empresa" = %(empresa)s AND NOT EXISTS ('
        '  SELECT 1 FROM "Venta" v JOIN "VentaCarga" c ON c."id" = v."cargaId" AND c."estado" = \'CONFIRMADA\' '
        '  WHERE v."empresa" = cl."empresa" AND v."codigoCliente" = cl."codigo" '
        '    AND v."reemplazadaPorCargaId" IS NULL AND v."fecha" BETWEEN %(desde)s AND %(hasta)s'
        ') ORDER BY cl."nombre"',
        params,
    )
    sin_compras = cur.fetchall()

    cur.execute(
        'SELECT vc."codigo", vc."nombre", vc."ruta" AS "rutaVenta", cl."rutaComercial" AS "rutaLogistica" '
        'FROM "VentaCliente" vc JOIN "Cliente" cl ON cl."empresa" = vc."empresa" AND cl."codigo" = vc."codigo" '
        'WHERE vc."empresa" = %s ORDER BY vc."nombre"',
        (f.empresa,),
    )
    en_ambos = cur.fetchall()
    distintas = [
        c for c in en_ambos
        if c["rutaLogistica"] and iv.ruta_comparable(c["rutaVenta"]) != iv.ruta_comparable(c["rutaLogistica"])
    ]
    return {
        "fueraDeLogistica": {
            "total": len(fuera),
            "ventaNeta": sum(c["ventaNeta"] for c in fuera),
            "clientes": fuera[:LIMITE_LISTA],
        },
        "sinCompras": {"total": len(sin_compras), "clientes": sin_compras[:LIMITE_LISTA]},
        "rutaDistinta": {
            "enAmbos": len(en_ambos),
            "sinRutaEnLogistica": sum(1 for c in en_ambos if not c["rutaLogistica"]),
            "total": len(distintas),
            "clientes": distintas[:LIMITE_LISTA],
        },
    }


# ---------- Cargas ----------

_SELECT_CARGA = (
    'SELECT c."id", c."empresa", c."archivo", c."periodoDesde", c."periodoHasta", c."filas", c."estado", '
    'c."subidaEn", c."confirmadaEn", c."revertidaEn", u."nombre" AS "subidaPor", '
    "(c.\"resumen\"->'totales'->>'ventaNeta')::float AS \"ventaNeta\", "
    '(SELECT COUNT(*) FROM "Venta" v WHERE v."cargaId" = c."id" AND v."reemplazadaPorCargaId" IS NULL) AS "filasVigentes" '
    'FROM "VentaCarga" c JOIN "Usuario" u ON u."id" = c."subidaPorId" '
)


def _obtener_carga(cur, carga_id: str) -> dict:
    cur.execute(_SELECT_CARGA + 'WHERE c."id" = %s', (carga_id,))
    carga = cur.fetchone()
    if not carga:
        raise HTTPException(404, "Carga no encontrada")
    return carga


@router.get("/cargas")
def listar_cargas(empresa: str):
    _validar_empresa(empresa)
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(_SELECT_CARGA + 'WHERE c."empresa" = %s ORDER BY c."subidaEn" DESC', (empresa,))
        return cur.fetchall()


@router.get("/cargas/{carga_id}")
def detalle_carga(carga_id: str):
    with get_connection() as conn, conn.cursor() as cur:
        carga = _obtener_carga(cur, carga_id)
        cur.execute('SELECT "resumen" FROM "VentaCarga" WHERE "id" = %s', (carga_id,))
        return {"carga": carga, "resumen": cur.fetchone()["resumen"]}


def _validar(cur, empresa: str, extracto: ExtractoVentas) -> dict:
    """La pantalla de validacion (seccion 6 del documento del cliente):
    todo lo que el ADMIN tiene que ver antes de que el archivo cuente."""
    filas = extracto.filas
    desde = min(f.fecha for f in filas)
    hasta = max(f.fecha for f in filas)

    cur.execute('SELECT "codigo", "ruta" FROM "VentaCliente" WHERE "empresa" = %s', (empresa,))
    clientes_previos = {r["codigo"]: r["ruta"] for r in cur.fetchall()}
    cur.execute('SELECT "codigo", "costoCajaUsd" FROM "VentaProducto" WHERE "empresa" = %s', (empresa,))
    costos_previos = {int(r["codigo"]): r["costoCajaUsd"] for r in cur.fetchall()}
    cur.execute('SELECT "codigo" FROM "Cliente" WHERE "empresa" = %s', (empresa,))
    en_logistica = {r["codigo"] for r in cur.fetchall()}
    cur.execute(
        'SELECT c."id", c."archivo", c."periodoDesde", c."periodoHasta", '
        'COUNT(v."id") AS "filasReemplazadas", COALESCE(SUM(v."montoUsd"), 0) AS "ventaReemplazada" '
        'FROM "VentaCarga" c JOIN "Venta" v ON v."cargaId" = c."id" '
        'WHERE c."empresa" = %(empresa)s AND c."estado" = \'CONFIRMADA\' '
        '  AND v."reemplazadaPorCargaId" IS NULL AND v."fecha" BETWEEN %(desde)s AND %(hasta)s '
        'GROUP BY c."id" ORDER BY c."periodoDesde"',
        {"empresa": empresa, "desde": desde, "hasta": hasta},
    )
    solapes = [
        {
            "cargaId": s["id"],
            "archivo": s["archivo"],
            "periodoDesde": s["periodoDesde"].isoformat(),
            "periodoHasta": s["periodoHasta"].isoformat(),
            "filasReemplazadas": s["filasReemplazadas"],
            "ventaReemplazada": float(s["ventaReemplazada"]),
        }
        for s in cur.fetchall()
    ]

    def costo_de(codigo: int) -> float | None:
        propio = extracto.productos[codigo]["costoCajaUsd"]
        if propio is not None:
            return propio
        previo = costos_previos.get(codigo)
        return float(previo) if previo is not None else None

    por_producto: dict[int, dict] = {}
    venta_por_cliente: dict[str, float] = {}
    for f in filas:
        p = por_producto.setdefault(f.codigo_producto, {"ventaNeta": 0.0, "costo": 0.0})
        p["ventaNeta"] += f.monto_usd
        costo = costo_de(f.codigo_producto)
        if costo is not None:
            p["costo"] += f.cajas * costo
        venta_por_cliente[f.codigo_cliente] = venta_por_cliente.get(f.codigo_cliente, 0.0) + f.monto_usd

    productos = [
        {
            "codigo": codigo,
            "nombre": extracto.productos[codigo]["nombre"],
            "grupo": extracto.productos[codigo]["grupo"],
            "ventaNeta": datos["ventaNeta"],
            "costo": datos["costo"],
            "tieneCosto": costo_de(codigo) is not None,
        }
        for codigo, datos in por_producto.items()
    ]
    sin_costo = sorted((p for p in productos if not p["tieneCosto"]), key=lambda p: -p["ventaNeta"])

    tasas = [(f, f.monto_bs / f.monto_usd) for f in filas if abs(f.monto_usd) >= 0.01]
    mediana = statistics.median(t for _, t in tasas) if tasas else None
    fuera_de_rango = [
        (f, t) for f, t in tasas
        if abs(t - 1) < 1e-6 or t < mediana * (1 - RANGO_TASA) or t > mediana * (1 + RANGO_TASA)
    ] if mediana else []

    rutas_en_archivo = sorted({c["ruta"] for c in extracto.clientes.values()}, key=_orden_ruta)
    rutas_conocidas = set(clientes_previos.values())
    clientes_nuevos = [c for c in extracto.clientes if c not in clientes_previos]
    productos_nuevos = [c for c in extracto.productos if c not in costos_previos]
    fuera_de_logistica = [c for c in extracto.clientes if c not in en_logistica]
    venta_bruta = sum(f.monto_usd for f in filas if f.tipo_movimiento == "VENTA")
    venta_neta = sum(f.monto_usd for f in filas)

    return {
        "hoja": extracto.hoja,
        "otrasHojasConFormato": extracto.otras_hojas_con_formato,
        "fuenteCosto": extracto.fuente_costo,
        "filasLeidas": len(filas),
        "filasVenta": sum(1 for f in filas if f.tipo_movimiento == "VENTA"),
        "filasDevolucion": sum(1 for f in filas if f.tipo_movimiento == "DEVOLUCION"),
        "periodoDesde": desde.isoformat(),
        "periodoHasta": hasta.isoformat(),
        "totales": {
            "ventaNeta": venta_neta,
            "ventaBruta": venta_bruta,
            "devoluciones": venta_bruta - venta_neta,
            "ventaNetaBs": sum(f.monto_bs for f in filas),
            "litros": sum(f.litros for f in filas),
            "cajas": sum(f.cajas for f in filas),
            "unidades": sum(f.unidades for f in filas),
        },
        "documentos": len({f.num_doc for f in filas}),
        "clientes": len(extracto.clientes),
        "solapes": solapes,
        "clientesNuevos": {
            "total": len(clientes_nuevos),
            "muestra": [
                {"codigo": c, **extracto.clientes[c]}
                for c in sorted(clientes_nuevos, key=lambda c: -venta_por_cliente.get(c, 0))[:MUESTRA]
            ],
        },
        "productosNuevos": {
            "total": len(productos_nuevos),
            "muestra": [
                {"codigo": str(c), "nombre": extracto.productos[c]["nombre"], "grupo": extracto.productos[c]["grupo"]}
                for c in productos_nuevos[:MUESTRA]
            ],
        },
        "productosSinCosto": {
            "total": len(sin_costo),
            "ventaNeta": sum(p["ventaNeta"] for p in sin_costo),
            "productos": [
                {"codigo": str(p["codigo"]), "nombre": p["nombre"], "grupo": p["grupo"], "ventaNeta": p["ventaNeta"]}
                for p in sin_costo
            ],
        },
        "rutas": {
            "enArchivo": rutas_en_archivo,
            "noReconocidas": [r for r in rutas_en_archivo if r not in rutas_conocidas] if rutas_conocidas else [],
            "primeraCarga": not rutas_conocidas,
        },
        "tasa": {
            "mediana": mediana,
            "filasFueraDeRango": len(fuera_de_rango),
            "ventaNeta": sum(f.monto_usd for f, _ in fuera_de_rango),
            "muestra": [
                {"fila": f.fila, "fecha": f.fecha.isoformat(), "numDoc": f.num_doc,
                 "montoBs": f.monto_bs, "montoUsd": f.monto_usd, "tasa": t}
                for f, t in fuera_de_rango[:MUESTRA]
            ],
        },
        "desviosMargen": iv.desvios_de_margen(productos),
        "productosDuplicados": iv.productos_duplicados(
            {c: p["nombre"] for c, p in extracto.productos.items()}
        ),
        "fueraDeLogistica": {
            "total": len(fuera_de_logistica),
            "ventaNeta": sum(venta_por_cliente[c] for c in fuera_de_logistica),
        },
    }


@router.post("/cargas/preview")
def analizar_carga(
    empresa: str = Form(...),
    archivo: UploadFile = File(...),
    usuario: dict = Depends(requiere_rol("ADMIN")),
):
    """Paso 1: lee y valida el archivo. Las filas ya quedan guardadas (la
    carga en PENDIENTE, sin contar en los indicadores) para no tener que
    mandar las ~13 mil filas de ida y vuelta al navegador."""
    _validar_empresa(empresa)
    contenido = archivo.file.read()
    if len(contenido) > TAMANO_MAXIMO_BYTES:
        raise HTTPException(
            413,
            f"El archivo pesa {len(contenido) / 1_000_000:.1f} MB y el maximo es 4.5 MB. Sube un libro solo "
            'con la hoja de ventas ("data") y la de costos ("precio de compras"), sin las tablas dinamicas.',
        )

    extracto = leer_extracto(contenido)
    if extracto.errores:
        return {"carga": None, "resumen": None, "errores": extracto.errores[:1000], "totalErrores": len(extracto.errores)}

    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            'DELETE FROM "VentaCarga" WHERE "estado" = \'PENDIENTE\' AND "subidaEn" < now() - %s::interval',
            (f"{HORAS_CARGA_PENDIENTE} hours",),
        )
        resumen_carga = _validar(cur, empresa, extracto)
        dimensiones = {
            "clientes": [{"codigo": codigo, **datos} for codigo, datos in extracto.clientes.items()],
            "productos": [{"codigo": str(codigo), **datos} for codigo, datos in extracto.productos.items()],
        }
        carga_id = f"vcarga-{uuid.uuid4().hex[:10]}"
        cur.execute(
            'INSERT INTO "VentaCarga" ("id", "empresa", "archivo", "periodoDesde", "periodoHasta", "filas", '
            '"estado", "subidaPorId", "resumen", "dimensiones") '
            "VALUES (%s, %s, %s, %s, %s, %s, 'PENDIENTE', %s, %s, %s)",
            (
                carga_id, empresa, archivo.filename or "ventas.xlsx",
                resumen_carga["periodoDesde"], resumen_carga["periodoHasta"], len(extracto.filas),
                usuario["id"], Jsonb(resumen_carga), Jsonb(dimensiones),
            ),
        )
        # COPY en vez de INSERT fila por fila: son miles de filas contra una
        # base en otra region (Neon).
        with cur.copy(
            'COPY "Venta" ("empresa", "cargaId", "fecha", "numDoc", "codTipoDoc", "tipoMovimiento", '
            '"codigoCliente", "codigoProducto", "cajas", "unidades", "litros", "montoBs", "montoUsd") FROM STDIN'
        ) as copy:
            for f in extracto.filas:
                copy.write_row((
                    empresa, carga_id, f.fecha, f.num_doc, f.cod_tipo_doc, f.tipo_movimiento,
                    f.codigo_cliente, f.codigo_producto, f.cajas, f.unidades, f.litros, f.monto_bs, f.monto_usd,
                ))
        conn.commit()
        carga = _obtener_carga(cur, carga_id)

    return {"carga": carga, "resumen": resumen_carga, "errores": [], "totalErrores": 0}


def _carga_para_actualizar(cur, carga_id: str, estado_esperado: str) -> dict:
    cur.execute('SELECT * FROM "VentaCarga" WHERE "id" = %s FOR UPDATE', (carga_id,))
    carga = cur.fetchone()
    if not carga:
        raise HTTPException(404, "Carga no encontrada")
    if carga["estado"] != estado_esperado:
        estado = {"PENDIENTE": "esta pendiente", "CONFIRMADA": "ya fue confirmada", "REVERTIDA": "ya fue revertida"}
        raise HTTPException(409, f"Esta carga {estado[carga['estado']]}")
    return carga


@router.post("/cargas/{carga_id}/confirmar")
def confirmar_carga(carga_id: str):
    """Paso 2: la carga empieza a contar, reemplaza a las anteriores en su
    periodo y actualiza clientes y productos con lo que trae el archivo."""
    with get_connection() as conn, conn.cursor() as cur:
        carga = _carga_para_actualizar(cur, carga_id, "PENDIENTE")
        cur.execute(
            'UPDATE "Venta" v SET "reemplazadaPorCargaId" = %(id)s FROM "VentaCarga" c '
            'WHERE c."id" = v."cargaId" AND c."estado" = \'CONFIRMADA\' AND v."empresa" = %(empresa)s '
            '  AND v."reemplazadaPorCargaId" IS NULL AND v."fecha" BETWEEN %(desde)s AND %(hasta)s',
            {"id": carga_id, "empresa": carga["empresa"], "desde": carga["periodoDesde"], "hasta": carga["periodoHasta"]},
        )
        reemplazadas = cur.rowcount
        _aplicar_dimensiones(cur, carga["empresa"], carga["dimensiones"])
        cur.execute(
            'UPDATE "VentaCarga" SET "estado" = \'CONFIRMADA\', "confirmadaEn" = now() WHERE "id" = %s',
            (carga_id,),
        )
        conn.commit()
        return {**_obtener_carga(cur, carga_id), "filasReemplazadas": reemplazadas}


def _aplicar_dimensiones(cur, empresa: str, dimensiones: dict) -> None:
    """Clientes y productos del archivo a VentaCliente / VentaProducto."""
    cur.executemany(
        'INSERT INTO "VentaCliente" ("id", "empresa", "codigo", "nombre", "tipo", "ruta", "listaPrecio") '
        "VALUES (%s, %s, %s, %s, %s, %s, %s) "
        'ON CONFLICT ("empresa", "codigo") DO UPDATE SET "nombre" = EXCLUDED."nombre", '
        '"tipo" = EXCLUDED."tipo", "ruta" = EXCLUDED."ruta", '
        '"listaPrecio" = COALESCE(EXCLUDED."listaPrecio", "VentaCliente"."listaPrecio")',
        [
            (f"vcli-{uuid.uuid4().hex[:10]}", empresa, c["codigo"], c["nombre"], c["tipo"],
             c["ruta"], c["listaPrecio"])
            for c in dimensiones["clientes"]
        ],
    )
    # El costo solo se pisa si el archivo lo trae: un extracto diario sin
    # la hoja de costos no debe borrar los que ya estaban cargados.
    cur.executemany(
        'INSERT INTO "VentaProducto" ("id", "empresa", "codigo", "nombre", "grupo", "codigoProveedor", '
        '"unidadesPorCaja", "litrosPorUnidad", "costoCajaUsd") VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s) '
        'ON CONFLICT ("empresa", "codigo") DO UPDATE SET "nombre" = EXCLUDED."nombre", '
        '"grupo" = EXCLUDED."grupo", '
        '"codigoProveedor" = COALESCE(EXCLUDED."codigoProveedor", "VentaProducto"."codigoProveedor"), '
        '"unidadesPorCaja" = COALESCE(EXCLUDED."unidadesPorCaja", "VentaProducto"."unidadesPorCaja"), '
        '"litrosPorUnidad" = COALESCE(EXCLUDED."litrosPorUnidad", "VentaProducto"."litrosPorUnidad"), '
        '"costoCajaUsd" = COALESCE(EXCLUDED."costoCajaUsd", "VentaProducto"."costoCajaUsd")',
        [
            (f"vprod-{uuid.uuid4().hex[:10]}", empresa, int(p["codigo"]), p["nombre"], p["grupo"],
             p["codigoProveedor"], p["unidadesPorCaja"], p["litrosPorUnidad"], p["costoCajaUsd"])
            for p in dimensiones["productos"]
        ],
    )


@router.delete("/cargas/{carga_id}", status_code=204)
def descartar_carga(carga_id: str):
    """Solo una carga pendiente: se borra entera (sus filas caen en cascada)."""
    with get_connection() as conn, conn.cursor() as cur:
        _carga_para_actualizar(cur, carga_id, "PENDIENTE")
        cur.execute('DELETE FROM "VentaCarga" WHERE "id" = %s', (carga_id,))
        conn.commit()


@router.post("/cargas/{carga_id}/revertir")
def revertir_carga(carga_id: str):
    """Saca la carga de los indicadores y devuelve lo que habia reemplazado.
    La carga queda en el historial como REVERTIDA."""
    with get_connection() as conn, conn.cursor() as cur:
        carga = _carga_para_actualizar(cur, carga_id, "CONFIRMADA")
        cur.execute('DELETE FROM "Venta" WHERE "cargaId" = %s', (carga_id,))
        # Las filas que esta carga habia reemplazado vuelven a contar... salvo
        # que otra carga confirmada DESPUES que la suya tambien cubra esa
        # fecha: entonces pasan a estar reemplazadas por esa otra.
        cur.execute(
            'UPDATE "Venta" r SET "reemplazadaPorCargaId" = ('
            '  SELECT c2."id" FROM "VentaCarga" c2 '
            '  WHERE c2."empresa" = r."empresa" AND c2."estado" = \'CONFIRMADA\' AND c2."id" <> %(id)s '
            '    AND r."fecha" BETWEEN c2."periodoDesde" AND c2."periodoHasta" '
            '    AND c2."confirmadaEn" > (SELECT c1."confirmadaEn" FROM "VentaCarga" c1 WHERE c1."id" = r."cargaId") '
            '  ORDER BY c2."confirmadaEn" DESC LIMIT 1'
            ') WHERE r."reemplazadaPorCargaId" = %(id)s',
            {"id": carga_id},
        )
        restauradas = cur.rowcount
        cur.execute(
            'UPDATE "VentaCarga" SET "estado" = \'REVERTIDA\', "revertidaEn" = now() WHERE "id" = %s',
            (carga_id,),
        )
        # Los costos, rutas y nombres que habia puesto esta carga tambien se
        # deshacen: se vuelven a aplicar, en orden, los de las cargas que
        # siguen confirmadas (la ultima manda, como al confirmar).
        cur.execute(
            'SELECT "dimensiones" FROM "VentaCarga" WHERE "empresa" = %s AND "estado" = \'CONFIRMADA\' '
            'ORDER BY "confirmadaEn"',
            (carga["empresa"],),
        )
        for confirmada in cur.fetchall():
            _aplicar_dimensiones(cur, carga["empresa"], confirmada["dimensiones"])
        conn.commit()
        return {**_obtener_carga(cur, carga_id), "filasRestauradas": restauradas}
