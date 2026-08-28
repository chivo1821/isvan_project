"""Despachos: creacion (manual o via importacion de Excel), aprobacion, y
ajuste de cantidades. La asignacion de vehiculo, el calculo de ruta
multi-parada y el inicio/entrega del viaje viven en app/api/rutas.py — un
despacho por si solo ya no calcula ni guarda su propia ruta (ver Ruta).
"""

from __future__ import annotations

import io
import re
import uuid
from datetime import datetime

import openpyxl
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from app.core.auth import requiere_rol
from app.core.db import get_connection
from app.core.excel_utils import mapear_columnas, valor_a_texto
from app.core.numero import siguiente_numero, siguientes_numeros
from app.schemas import (
    ActualizarCantidadDespachoItemRequest,
    Despacho,
    DespachoAprobacionCreate,
    DespachoCreate,
    ImportarExcelConfirmarRequest,
    ImportarExcelPreviewResponse,
)

router = APIRouter(prefix="/despachos", tags=["despachos"])

ALMACEN_BASE_ID = "alm-catia"


def _con_items(cur, despacho_row: dict) -> dict:
    cur.execute(
        'SELECT "id", "descripcion", "cantidad", "cantidadSolicitada", "pesoUnitarioKg", "requiereFrio" '
        'FROM "DespachoItem" WHERE "despachoId" = %s',
        (despacho_row["id"],),
    )
    return {**despacho_row, "items": cur.fetchall()}


def _con_items_lote(cur, despachos: list[dict]) -> list[dict]:
    """Version en lote de _con_items: una sola consulta para todos los
    despachos (WHERE despachoId = ANY(...)) en vez de una por despacho —
    evita N+1 round-trips, que con la base en otra region (Neon) se notan
    mucho mas que en local."""
    if not despachos:
        return []
    ids = [d["id"] for d in despachos]
    cur.execute(
        'SELECT "id", "despachoId", "descripcion", "cantidad", "cantidadSolicitada", "pesoUnitarioKg", "requiereFrio" '
        'FROM "DespachoItem" WHERE "despachoId" = ANY(%s)',
        (ids,),
    )
    items_por_despacho: dict[str, list[dict]] = {}
    for item in cur.fetchall():
        despacho_id = item.pop("despachoId")
        items_por_despacho.setdefault(despacho_id, []).append(item)
    return [{**d, "items": items_por_despacho.get(d["id"], [])} for d in despachos]


def _crear_despacho_interno(cur, *, destino_cliente_id: str, numero_documento: str, creado_por_id: str, items) -> dict:
    numero = siguiente_numero(cur, "Despacho", "D", 4)
    despacho_id = f"despacho-{uuid.uuid4().hex[:10]}"
    cur.execute(
        'INSERT INTO "Despacho" '
        '("id", "numero", "numeroDocumento", "origenId", "destinoClienteId", "creadoPorId", "estado") '
        "VALUES (%s, %s, %s, %s, %s, %s, 'PENDIENTE_APROBACION') RETURNING *",
        (despacho_id, numero, numero_documento, ALMACEN_BASE_ID, destino_cliente_id, creado_por_id),
    )
    despacho_row = cur.fetchone()

    filas_items = []
    for item in items:
        item_id = f"di-{uuid.uuid4().hex[:10]}"
        cur.execute(
            'INSERT INTO "DespachoItem" '
            '("id", "despachoId", "descripcion", "cantidad", "cantidadSolicitada", "pesoUnitarioKg", "requiereFrio") '
            "VALUES (%s, %s, %s, %s, %s, %s, %s)",
            (item_id, despacho_id, item.descripcion, item.cantidad, item.cantidad, item.pesoUnitarioKg, item.requiereFrio),
        )
        filas_items.append({
            "id": item_id, "descripcion": item.descripcion, "cantidad": item.cantidad,
            "cantidadSolicitada": item.cantidad, "pesoUnitarioKg": item.pesoUnitarioKg,
            "requiereFrio": item.requiereFrio,
        })

    return {**despacho_row, "items": filas_items}


@router.get("", response_model=list[Despacho])
def listar_despachos():
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute('SELECT * FROM "Despacho" ORDER BY "fechaCreacion" DESC')
        return _con_items_lote(cur, cur.fetchall())


@router.get("/aprobacion", response_model=list[Despacho])
def listar_despachos_pendientes_aprobacion():
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute('SELECT * FROM "Despacho" WHERE "estado" = \'PENDIENTE_APROBACION\' ORDER BY "fechaCreacion"')
        return _con_items_lote(cur, cur.fetchall())


@router.get("/disponibles-para-ruta", response_model=list[Despacho])
def listar_despachos_disponibles_para_ruta():
    """Despachos ya aprobados y que todavia no forman parte de ninguna Ruta —
    el set del que se arma una nueva ruta multi-parada (ver POST /rutas)."""
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            'SELECT * FROM "Despacho" WHERE "estado" = \'APROBADO\' AND "rutaId" IS NULL ORDER BY "fechaCreacion"'
        )
        return _con_items_lote(cur, cur.fetchall())


@router.get("/{despacho_id}", response_model=Despacho)
def obtener_despacho(despacho_id: str):
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute('SELECT * FROM "Despacho" WHERE "id" = %s', (despacho_id,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Despacho no encontrado")
        return _con_items(cur, row)


@router.post("", response_model=Despacho, status_code=201, dependencies=[Depends(requiere_rol("DESPACHOS"))])
def crear_despacho(data: DespachoCreate):
    """Carga manual de un despacho (un cliente, ítems escritos a mano) — el
    mismo camino de creación que usa la importación de Excel confirmada
    (ver _crear_despacho_interno), útil para un pedido suelto sin planilla."""
    if not data.items:
        raise HTTPException(400, "El despacho debe tener al menos un item")

    with get_connection() as conn, conn.cursor() as cur:
        cur.execute('SELECT 1 FROM "Cliente" WHERE "id" = %s', (data.destinoClienteId,))
        if not cur.fetchone():
            raise HTTPException(404, "Cliente no encontrado")

        cur.execute('SELECT 1 FROM "Despacho" WHERE "numeroDocumento" = %s', (data.numeroDocumento,))
        if cur.fetchone():
            raise HTTPException(400, f'El documento "{data.numeroDocumento}" ya tiene un despacho generado')

        despacho_row = _crear_despacho_interno(
            cur,
            destino_cliente_id=data.destinoClienteId,
            numero_documento=data.numeroDocumento,
            creado_por_id=data.creadoPorId,
            items=data.items,
        )
        conn.commit()
        return despacho_row


# ---------- Importacion de Excel ----------
#
# Formato real confirmado con el cliente: es el extracto crudo de ventas tal
# como sale del sistema de ISVAN/TRALOG (no una plantilla armada a mano para
# despacho), con columnas como "codigo cliente", "num docum", "producto",
# "unidades", "litros", etc. Reglas de negocio confirmadas sobre ese
# extracto:
#
# - Una fila = un producto. El "num docum" agrupa filas en un despacho por
#   cliente (no el codigo de cliente, que se repite entre documentos).
# - Filas con "unidades" <= 0 son devoluciones/notas de credito — se ignoran
#   en silencio (no son un error, simplemente no generan despacho).
# - No hay columna de peso: se calcula por prioridad — (1) columna de peso
#   directa si el archivo la trae (plantillas futuras); (2) el tamano de
#   presentacion en la propia descripcion del producto (ej. "1X550GRS" en
#   una pizza da 0.55 kg exactos, sin aproximar); (3) "litros" (litros
#   totales de la fila) con un factor de densidad promedio de helado, solo
#   para productos liquidos sin peso explicito en la descripcion.
# - No hay columna de cadena de frio: todo el catalogo de ISVAN/TRALOG la
#   requiere, se marca siempre True.

ALIAS_COLUMNAS: dict[str, list[str]] = {
    "codigo_cliente": ["codigo_cliente", "codigo_de_cliente", "cod_cliente", "codigo"],
    "numero_documento": ["numero_documento", "nro_documento", "n_documento", "documento", "num_docum", "factura", "nota_de_entrega"],
    "descripcion_item": ["descripcion_item", "descripcion", "producto", "item", "articulo"],
    "cantidad": ["cantidad", "cant", "unidades"],
    "peso_unitario_kg": ["peso_unitario_kg", "peso_unitario", "peso_kg", "peso"],
    "litros": ["litros"],
}
CAMPOS_REQUERIDOS = ["codigo_cliente", "numero_documento", "descripcion_item", "cantidad"]

# Densidad promedio de helado (kg por litro) — solo se usa como ultimo
# recurso, cuando ni la descripcion ni una columna de peso directa traen el
# dato (ver _peso_unitario_desde_descripcion). Ajustable si el negocio da un
# factor mas preciso.
FACTOR_LITROS_A_KG = 0.55

# La descripcion del producto en el extracto de ventas trae el tamano de
# presentacion en el patron "<unidades_por_caja>X<tamano><unidad>", ej.
# "36X135ML" (helado, se mide por volumen) o "1X550GRS" (pizza, se mide por
# peso real). Cuando la unidad ya es de peso (GR/KG) se usa tal cual — mucho
# mas preciso que aproximar por densidad, que solo tiene sentido para
# liquidos/helado. Si no hay match, se cae al calculo por litros.
_PATRON_TAMANO_PRESENTACION = re.compile(
    r"(?<!\d)\d+\s*[xX]\s*(\d+(?:[.,]\d+)?)\s*(GRS?|KGS?|MLS?|LTS?|L)\b"
)


def _peso_unitario_desde_descripcion(descripcion: str) -> float | None:
    match = _PATRON_TAMANO_PRESENTACION.search(descripcion.upper())
    if not match:
        return None
    cantidad_str, unidad = match.groups()
    cantidad = float(cantidad_str.replace(",", "."))
    if unidad.startswith("GR"):
        return round(cantidad / 1000, 4)
    if unidad.startswith("KG"):
        return round(cantidad, 4)
    if unidad.startswith("ML"):
        return round((cantidad / 1000) * FACTOR_LITROS_A_KG, 4)
    return round(cantidad * FACTOR_LITROS_A_KG, 4)  # LT/LTS/L


def _mapear_columnas(fila_encabezados: tuple) -> dict[str, int]:
    mapa = mapear_columnas(fila_encabezados, ALIAS_COLUMNAS, CAMPOS_REQUERIDOS)
    if "peso_unitario_kg" not in mapa and "litros" not in mapa:
        raise HTTPException(400, "Faltan columnas obligatorias en el Excel: peso_unitario_kg o litros")
    return mapa


@router.post(
    "/importar/preview",
    response_model=ImportarExcelPreviewResponse,
    dependencies=[Depends(requiere_rol("DESPACHOS"))],
)
def importar_excel_preview(empresa: str = Form(...), archivo: UploadFile = File(...)):
    if empresa not in ("ISVAN", "TRALOG"):
        raise HTTPException(400, "empresa debe ser ISVAN o TRALOG")

    try:
        libro = openpyxl.load_workbook(io.BytesIO(archivo.file.read()), read_only=True, data_only=True)
        filas = list(libro.active.iter_rows(values_only=True))
    except Exception:
        raise HTTPException(400, "No se pudo leer el archivo — verifica que sea un Excel (.xlsx) valido")

    if not filas:
        raise HTTPException(400, "El archivo esta vacio")

    mapa = _mapear_columnas(filas[0])
    errores: list[dict] = []
    filas_validas: list[dict] = []

    with get_connection() as conn, conn.cursor() as cur:
        # Se traen de una sola vez los clientes de la empresa y los numeros de
        # documento ya importados, en vez de consultar por cada fila del Excel
        # (un archivo real trae miles de filas -> miles de round-trips a la
        # base, insoportable con Postgres en otra region).
        cur.execute('SELECT * FROM "Cliente" WHERE "empresa" = %s', (empresa,))
        clientes_por_codigo = {c["codigo"]: c for c in cur.fetchall()}
        cur.execute('SELECT "numeroDocumento" FROM "Despacho"')
        documentos_ya_importados = {r["numeroDocumento"] for r in cur.fetchall()}

        for n, fila in enumerate(filas[1:], start=2):
            if fila is None or all(v is None for v in fila):
                continue  # fila vacia, se ignora

            def val(campo: str):
                idx = mapa.get(campo)
                return fila[idx] if idx is not None and idx < len(fila) else None

            codigo_cliente = valor_a_texto(val("codigo_cliente"))
            numero_documento = valor_a_texto(val("numero_documento"))
            descripcion = str(val("descripcion_item") or "").strip()
            cantidad_raw = val("cantidad")

            # Filas con cantidad <= 0 son devoluciones/notas de credito del
            # extracto de ventas -- se ignoran en silencio, no es un error.
            try:
                cantidad_parseada: int | None = int(float(cantidad_raw))
            except (TypeError, ValueError):
                cantidad_parseada = None
            if cantidad_parseada is not None and cantidad_parseada <= 0:
                continue

            error: tuple[str, str] | None = None
            if not codigo_cliente:
                error = ("codigo_cliente", "Falta el codigo de cliente")
            elif not numero_documento:
                error = ("numero_documento", "Falta el numero de documento")
            elif not descripcion:
                error = ("descripcion_item", "Falta la descripcion del item")
            elif cantidad_parseada is None:
                error = ("cantidad", "La cantidad debe ser un numero")

            cantidad = cantidad_parseada

            peso = None
            if error is None:
                peso_directo = val("peso_unitario_kg")
                if peso_directo is not None:
                    try:
                        peso = float(peso_directo)
                        if peso < 0:
                            raise ValueError
                    except (TypeError, ValueError):
                        error = ("peso_unitario_kg", "El peso debe ser un numero mayor o igual a 0")
                else:
                    peso = _peso_unitario_desde_descripcion(descripcion)
                    if peso is None:
                        try:
                            litros = abs(float(val("litros")))
                            peso = round((litros / cantidad) * FACTOR_LITROS_A_KG, 4)
                        except (TypeError, ValueError):
                            error = ("litros", "No se pudo calcular el peso del item (ni desde la descripcion ni desde litros)")

            cliente = None
            if error is None:
                cliente = clientes_por_codigo.get(codigo_cliente)
                if not cliente:
                    error = ("codigo_cliente", f'No existe el cliente "{codigo_cliente}" en {empresa}')
                elif cliente["lat"] is None or cliente["lng"] is None:
                    error = ("codigo_cliente", f'El cliente "{codigo_cliente}" no tiene coordenadas registradas')

            if error is None and numero_documento in documentos_ya_importados:
                error = ("numero_documento", f'El documento "{numero_documento}" ya fue importado antes')

            if error is not None:
                columna, motivo = error
                errores.append({"fila": n, "columna": columna, "motivo": motivo})
                continue

            filas_validas.append({
                "fila": n, "numeroDocumento": numero_documento, "clienteId": cliente["id"],
                "clienteCodigo": cliente["codigo"], "clienteNombre": cliente["nombre"],
                "descripcion": descripcion, "cantidad": cantidad, "pesoUnitarioKg": peso,
                "requiereFrio": True,
            })

    # Agrupa por numero de documento (llave real del despacho, no el codigo
    # de cliente — un documento debe pertenecer a un solo cliente).
    grupos_raw: dict[str, list[dict]] = {}
    for f in filas_validas:
        grupos_raw.setdefault(f["numeroDocumento"], []).append(f)

    grupos: list[dict] = []
    for doc, filas_doc in grupos_raw.items():
        clientes_distintos = {f["clienteId"] for f in filas_doc}
        if len(clientes_distintos) > 1:
            for f in filas_doc:
                errores.append({
                    "fila": f["fila"], "columna": "numero_documento",
                    "motivo": f'El documento "{doc}" aparece con mas de un cliente distinto',
                })
            continue
        primero = filas_doc[0]
        grupos.append({
            "numeroDocumento": doc, "clienteId": primero["clienteId"],
            "clienteCodigo": primero["clienteCodigo"], "clienteNombre": primero["clienteNombre"],
            "items": [{
                "descripcion": f["descripcion"], "cantidad": f["cantidad"],
                "pesoUnitarioKg": f["pesoUnitarioKg"], "requiereFrio": f["requiereFrio"],
            } for f in filas_doc],
        })

    errores.sort(key=lambda e: e["fila"])
    return {"grupos": grupos, "errores": errores}


@router.post(
    "/importar/confirmar",
    response_model=list[Despacho],
    dependencies=[Depends(requiere_rol("DESPACHOS"))],
)
def importar_excel_confirmar(data: ImportarExcelConfirmarRequest):
    if not data.grupos:
        raise HTTPException(400, "No hay documentos validos para importar")

    with get_connection() as conn, conn.cursor() as cur:
        # Revalida unicidad de numeroDocumento por si cambio algo entre el
        # preview y la confirmacion (ej. otra persona importo el mismo
        # documento mientras tanto) -- en una sola consulta, no una por grupo.
        numeros_documento = [grupo.numeroDocumento for grupo in data.grupos]
        cur.execute('SELECT "numeroDocumento" FROM "Despacho" WHERE "numeroDocumento" = ANY(%s)', (numeros_documento,))
        ya_existentes = {r["numeroDocumento"] for r in cur.fetchall()}
        if ya_existentes:
            raise HTTPException(
                400,
                f'Estos documentos ya fueron importados (por otra carga): {", ".join(sorted(ya_existentes))}',
            )

        # Todo en lote: 1 consulta para los correlativos + 1 insert masivo de
        # despachos + 1 insert masivo de items. Antes era ~8 round-trips por
        # documento (correlativo + despacho + un insert por item), lo que con
        # cientos de documentos y la base en otra region se pasaba del tiempo
        # limite de la funcion serverless (error 500 en produccion).
        numeros = siguientes_numeros(cur, "Despacho", "D", 4, len(data.grupos))
        ahora = datetime.now()

        filas_despacho = []
        filas_item = []
        creados = []
        for grupo, numero in zip(data.grupos, numeros):
            despacho_id = f"despacho-{uuid.uuid4().hex[:10]}"
            filas_despacho.append(
                (despacho_id, numero, grupo.numeroDocumento, ALMACEN_BASE_ID, grupo.clienteId, data.creadoPorId, ahora)
            )
            items_creados = []
            for item in grupo.items:
                item_id = f"di-{uuid.uuid4().hex[:10]}"
                filas_item.append(
                    (item_id, despacho_id, item.descripcion, item.cantidad, item.cantidad,
                     item.pesoUnitarioKg, item.requiereFrio)
                )
                items_creados.append({
                    "id": item_id, "descripcion": item.descripcion, "cantidad": item.cantidad,
                    "cantidadSolicitada": item.cantidad, "pesoUnitarioKg": item.pesoUnitarioKg,
                    "requiereFrio": item.requiereFrio,
                })
            creados.append({
                "id": despacho_id, "numero": numero, "numeroDocumento": grupo.numeroDocumento,
                "origenId": ALMACEN_BASE_ID, "destinoClienteId": grupo.clienteId,
                "creadoPorId": data.creadoPorId, "estado": "PENDIENTE_APROBACION",
                "fechaCreacion": ahora, "fechaEstimadaEntrega": None,
                "rutaId": None, "ordenEnRuta": None, "items": items_creados,
            })

        cur.executemany(
            'INSERT INTO "Despacho" '
            '("id", "numero", "numeroDocumento", "origenId", "destinoClienteId", "creadoPorId", "fechaCreacion", "estado") '
            "VALUES (%s, %s, %s, %s, %s, %s, %s, 'PENDIENTE_APROBACION')",
            filas_despacho,
        )
        cur.executemany(
            'INSERT INTO "DespachoItem" '
            '("id", "despachoId", "descripcion", "cantidad", "cantidadSolicitada", "pesoUnitarioKg", "requiereFrio") '
            "VALUES (%s, %s, %s, %s, %s, %s, %s)",
            filas_item,
        )
        conn.commit()
        return creados


@router.post(
    "/{despacho_id}/aprobacion",
    response_model=Despacho,
    dependencies=[Depends(requiere_rol("APROBADOR"))],
)
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


@router.patch(
    "/{despacho_id}/items/{item_id}",
    response_model=Despacho,
    dependencies=[Depends(requiere_rol("DESPACHOS"))],
)
def ajustar_cantidad_item(despacho_id: str, item_id: str, data: ActualizarCantidadDespachoItemRequest):
    """El coordinador ajusta a mano cuanto se va a despachar de un item,
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
