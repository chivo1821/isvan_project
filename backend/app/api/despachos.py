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

from app.core.auth import get_current_user, requiere_rol
from app.core.db import get_connection
from app.core.permisos import es_repartidor, vehiculo_asignado
from app.core.excel_utils import mapear_columnas, valor_a_texto
from app.core.numero import siguiente_numero, siguientes_numeros
from app.core.ubicacion import sin_ubicacion
from app.schemas import (
    ActualizarCantidadDespachoItemRequest,
    AprobacionMasivaRequest,
    AprobacionMasivaResponse,
    Despacho,
    DespachoAprobacionCreate,
    DespachoCreate,
    ImportarExcelConfirmarRequest,
    ImportarExcelPreviewResponse,
)

router = APIRouter(prefix="/despachos", tags=["despachos"])

ALMACEN_BASE_ID = "alm-catia"


def _verificar_almacen_base(cur) -> None:
    """Todo despacho nace en el almacen base. Si esa fila no existe (base
    recien creada a la que solo se le cargo el usuario admin), el INSERT
    reventaba con un ForeignKeyViolation sin capturar -> 500 opaco. Mejor
    decir exactamente que falta y como resolverlo."""
    cur.execute('SELECT 1 FROM "Almacen" WHERE "id" = %s', (ALMACEN_BASE_ID,))
    if not cur.fetchone():
        raise HTTPException(
            400,
            f'No existe el almacen de origen "{ALMACEN_BASE_ID}" en la base de datos. '
            "Hay que crearlo antes de poder registrar despachos (ver README, seccion de datos iniciales).",
        )


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
def listar_despachos(usuario: dict = Depends(get_current_user)):
    """Un REPARTIDOR no ve la cola de despachos: solo los que son parada de
    la ruta de su vehiculo (ver app/core/permisos.py)."""
    with get_connection() as conn, conn.cursor() as cur:
        if es_repartidor(usuario):
            vehiculo_id = vehiculo_asignado(usuario)
            if not vehiculo_id:
                return []
            cur.execute(
                'SELECT d.* FROM "Despacho" d JOIN "Ruta" r ON r."id" = d."rutaId" '
                'WHERE r."vehiculoId" = %s ORDER BY d."fechaCreacion" DESC',
                (vehiculo_id,),
            )
        else:
            cur.execute('SELECT * FROM "Despacho" ORDER BY "fechaCreacion" DESC')
        return _con_items_lote(cur, cur.fetchall())


@router.get("/aprobacion", response_model=list[Despacho], dependencies=[Depends(requiere_rol("APROBADOR", "DESPACHOS"))])
def listar_despachos_pendientes_aprobacion():
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute('SELECT * FROM "Despacho" WHERE "estado" = \'PENDIENTE_APROBACION\' ORDER BY "fechaCreacion"')
        return _con_items_lote(cur, cur.fetchall())


@router.get(
    "/disponibles-para-ruta",
    response_model=list[Despacho],
    dependencies=[Depends(requiere_rol("DESPACHOS", "APROBADOR"))],
)
def listar_despachos_disponibles_para_ruta():
    """Despachos ya aprobados y que todavia no forman parte de ninguna Ruta —
    el set del que se arma una nueva ruta multi-parada (ver POST /rutas)."""
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            'SELECT * FROM "Despacho" WHERE "estado" = \'APROBADO\' AND "rutaId" IS NULL ORDER BY "fechaCreacion"'
        )
        return _con_items_lote(cur, cur.fetchall())


@router.get("/{despacho_id}", response_model=Despacho)
def obtener_despacho(despacho_id: str, usuario: dict = Depends(get_current_user)):
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            'SELECT d.*, r."vehiculoId" FROM "Despacho" d '
            'LEFT JOIN "Ruta" r ON r."id" = d."rutaId" WHERE d."id" = %s',
            (despacho_id,),
        )
        row = cur.fetchone()
        if not row:
            raise HTTPException(404, "Despacho no encontrado")
        # Un despacho que no va en la ruta de su vehiculo no existe para un
        # repartidor (404, no 403, para no revelar que hay algo ahi).
        vehiculo_de_la_ruta = row.pop("vehiculoId")
        if es_repartidor(usuario) and vehiculo_de_la_ruta != vehiculo_asignado(usuario):
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
        _verificar_almacen_base(cur)
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
#   directa si el archivo la trae (plantillas futuras); (2) la columna
#   "litros", que es la fuente confiable y se toma como kilos 1 a 1 (ver
#   _peso_unitario_de_la_fila); (3) el tamano de presentacion en la
#   descripcion, solo como ultimo recurso si la fila no trae "litros".
# - No hay columna de cadena de frio: todo el catalogo de ISVAN/TRALOG la
#   requiere, se marca siempre True.
# - Columna opcional "ruta": la ruta comercial (de venta/reparto) a la que el
#   negocio tiene asignado a ese cliente. El extracto de ventas es la fuente
#   de verdad de ese dato, asi que al confirmar la importacion se guarda en
#   el Cliente (ver mas abajo); de ahi lo toma el motor de sugerencia de
#   rutas para agrupar juntos a los clientes de una misma ruta comercial.

ALIAS_COLUMNAS: dict[str, list[str]] = {
    "codigo_cliente": ["codigo_cliente", "codigo_de_cliente", "cod_cliente", "codigo"],
    "numero_documento": ["numero_documento", "nro_documento", "n_documento", "documento", "num_docum", "factura", "nota_de_entrega"],
    "descripcion_item": ["descripcion_item", "descripcion", "producto", "item", "articulo"],
    "cantidad": ["cantidad", "cant", "unidades"],
    "peso_unitario_kg": ["peso_unitario_kg", "peso_unitario", "peso_kg", "peso"],
    "litros": ["litros"],
    "ruta": ["ruta", "ruta_comercial", "cod_ruta", "codigo_ruta", "nro_ruta", "zona"],
}
CAMPOS_REQUERIDOS = ["codigo_cliente", "numero_documento", "descripcion_item", "cantidad"]

# El negocio confirma que para su catalogo la equivalencia es 1 a 1: un pote
# de 850 ml pesa 0.85 kg. Por eso el numero de la columna "litros" se toma
# como kilos tal cual, sin factor de densidad — y da lo mismo si el producto
# se mide por volumen (helados) o por peso (pizzas, donde esa columna ya
# venia en kilos: "FULL PIZZA HOME 12 1X550GRS", 10 unidades, litros = 5.5).


def _peso_unitario_de_la_fila(contenido: float, cantidad: int) -> float:
    """Peso por unidad a partir de la columna "litros" (el contenido total
    de la fila), que es la fuente confiable: sale del propio sistema de
    ventas y ya contempla las presentaciones multi-empaque, que la
    descripcion no permite deducir bien (ej. "10X5X135ML")."""
    return round(abs(contenido) / cantidad, 4)


# Ultimo recurso, solo si la fila no trae "litros": deduce el tamano de la
# presentacion desde la descripcion ("1X550GRS" -> 0.55 kg; "1X850ML" ->
# 0.85 kg, por la equivalencia 1 a 1). Es menos fiable que la columna de
# litros porque no distingue los multi-empaque.
_PATRON_TAMANO_PRESENTACION = re.compile(
    r"(?<!\d)\d+\s*[xX]\s*(\d+(?:[.,]\d+)?)\s*(GRS?|KGS?|MLS?|LTS?|L)\b"
)


def _peso_unitario_desde_descripcion(descripcion: str) -> float | None:
    match = _PATRON_TAMANO_PRESENTACION.search(descripcion.upper())
    if not match:
        return None
    cantidad_str, unidad = match.groups()
    cantidad = float(cantidad_str.replace(",", "."))
    # Gramos y mililitros van a kilos igual (1 ml = 1 g); kilos y litros ya
    # estan en la unidad final.
    if unidad.startswith(("GR", "ML")):
        return round(cantidad / 1000, 4)
    return round(cantidad, 4)  # KG/KGS, LT/LTS/L


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
            ruta_comercial = valor_a_texto(val("ruta")) or None

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
                    # La columna "litros" manda: es el contenido real de la
                    # fila segun el sistema de ventas. La descripcion queda
                    # como respaldo por si esa columna viene vacia.
                    try:
                        contenido = abs(float(val("litros")))
                    except (TypeError, ValueError):
                        contenido = 0.0
                    if contenido:
                        peso = _peso_unitario_de_la_fila(contenido, cantidad)
                    else:
                        peso = _peso_unitario_desde_descripcion(descripcion)
                        if peso is None:
                            error = ("litros", "No se pudo calcular el peso del item (ni desde litros ni desde la descripcion)")

            cliente = None
            if error is None:
                cliente = clientes_por_codigo.get(codigo_cliente)
                if not cliente:
                    error = ("codigo_cliente", f'No existe el cliente "{codigo_cliente}" en {empresa}')
                elif sin_ubicacion(cliente["lat"], cliente["lng"]):
                    error = (
                        "codigo_cliente",
                        f'El cliente "{codigo_cliente}" no tiene una ubicacion valida '
                        "(faltan las coordenadas o estan en 0,0)",
                    )

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
                "requiereFrio": True, "rutaComercial": ruta_comercial,
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
        # La ruta comercial es del cliente, no del item: se toma la primera
        # que traiga el documento (todas sus filas son del mismo cliente).
        ruta_comercial_doc = next((f["rutaComercial"] for f in filas_doc if f["rutaComercial"]), None)
        grupos.append({
            "numeroDocumento": doc, "clienteId": primero["clienteId"],
            "clienteCodigo": primero["clienteCodigo"], "clienteNombre": primero["clienteNombre"],
            "rutaComercial": ruta_comercial_doc,
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
        _verificar_almacen_base(cur)

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

        # El extracto de ventas es la fuente de verdad de la ruta comercial
        # del cliente: si el archivo la trae, se refresca en el Cliente (solo
        # las filas donde realmente cambio). Si un cliente aparece en varios
        # documentos del mismo archivo, gana el ultimo.
        rutas_por_cliente = {g.clienteId: g.rutaComercial for g in data.grupos if g.rutaComercial}
        if rutas_por_cliente:
            cur.executemany(
                'UPDATE "Cliente" SET "rutaComercial" = %s '
                'WHERE "id" = %s AND "rutaComercial" IS DISTINCT FROM %s',
                [(ruta, cliente_id, ruta) for cliente_id, ruta in rutas_por_cliente.items()],
            )

        conn.commit()
        return creados


# Ojo: esta ruta tiene que declararse ANTES de "/{despacho_id}/aprobacion",
# porque esa tambien son dos segmentos y capturaria "aprobacion" como si
# fuera un id de despacho.
@router.post("/aprobacion/masiva", response_model=AprobacionMasivaResponse)
def aprobar_despachos_masivo(
    data: AprobacionMasivaRequest,
    # Solo ADMIN: requiere_rol deja pasar siempre a ADMIN y, al no listar
    # ningun otro rol, rechaza al resto (incluido APROBADOR, que si puede
    # aprobar de a uno). Aprobar toda la cola de una es una accion de
    # administracion, no del dia a dia de quien revisa despacho por despacho.
    usuario: dict = Depends(requiere_rol("ADMIN")),
):
    """Aprueba de una sola vez todos los despachos pendientes (o solo los
    `despachoIds` que se manden). Deja la misma auditoria que la aprobacion
    individual: una fila en DespachoAprobacion por despacho, a nombre del
    ADMIN que ejecuto la accion."""
    with get_connection() as conn, conn.cursor() as cur:
        # El UPDATE filtra por estado y devuelve lo que realmente cambio, en
        # una sola sentencia: si alguien aprueba o rechaza algo entre medias,
        # no se audita un despacho que este endpoint no movio.
        sql = 'UPDATE "Despacho" SET "estado" = \'APROBADO\' WHERE "estado" = \'PENDIENTE_APROBACION\''
        parametros: tuple = ()
        if data.despachoIds:
            sql += ' AND "id" = ANY(%s)'
            parametros = (data.despachoIds,)
        cur.execute(f'{sql} RETURNING "id", "numero"', parametros)
        aprobados = cur.fetchall()

        if not aprobados:
            raise HTTPException(400, "No hay despachos pendientes de aprobacion")

        cur.executemany(
            'INSERT INTO "DespachoAprobacion" ("id", "despachoId", "usuarioId", "accion", "comentario") '
            "VALUES (%s, %s, %s, 'APROBADA', %s)",
            [
                (f"dap-{uuid.uuid4().hex[:10]}", d["id"], usuario["id"], data.comentario)
                for d in aprobados
            ],
        )
        conn.commit()

    return {"aprobados": len(aprobados), "numeros": [d["numero"] for d in aprobados]}


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
