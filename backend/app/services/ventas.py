"""Documentos de venta del sistema administrativo: calculo, emision y enlace
con lo que ya existe.

Flujo:
1. crear_documento(): BORRADOR con los renglones (copia de producto, precio y
   alicuota) y totales de vista previa.
2. solicitar_emision(): valida (datos fiscales, existencia, tasa) y lo pone
   EN_EMISION con una tarea "ventas.emitir" en la cola.
3. emitir() (la tarea): con la tasa vigente recalcula los Bs, toma el numero
   (Correlativo), saca el inventario, lo manda a la imprenta digital y, si sale
   bien, lo deja EMITIDA y lo enlaza:
   - cobranzas: un DocumentoCobro (origen SISTEMA);
   - indicadores: filas de Venta en la carga permanente "SISTEMA" de la
     empresa (los indicadores, el cuadro de metas y delivery no cambian);
   - logistica: un Despacho (FA y NE) con la llave numeroDocumento +
     tipoDocumento, como los del Excel;
   - el pedido pasa a FACTURADO.
   Numero, inventario y emision van en un mismo punto de guardado: si la
   imprenta rechaza, se deshace todo (no queda numero saltado) y el documento
   queda RECHAZADA. Si no responde, se reintenta.

Montos: NUMERIC y Decimal. Los Bs salen de redondear base e IVA por alicuota
(no renglon por renglon), como en un libro de ventas.
"""

from __future__ import annotations

import math
import uuid
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal
from types import SimpleNamespace

from fastapi import HTTPException
from psycopg.types.json import Jsonb

from app.core.fechas import ahora_utc, hoy_caracas
from app.services import bitacora, correlativo, emision, empresas, inventario, tareas

CENTAVO = Decimal("0.01")
CERO = Decimal("0")
IGTF_PORCENTAJE = Decimal("3")
SIGNO = {"FA": 1, "NE": 1, "ND": 1, "NC": -1}


def redondear(valor) -> Decimal:
    return Decimal(valor).quantize(CENTAVO, rounding=ROUND_HALF_UP)


# ---------- Calculo ----------


def subtotal_item(cajas, precio, descuento_pct) -> Decimal:
    bruto = Decimal(cajas) * Decimal(precio)
    return redondear(bruto * (Decimal(100) - Decimal(descuento_pct)) / Decimal(100))


def calcular_totales(items: list[dict], tasa: Decimal | None, pago_en_divisas: bool, igtf_pct: Decimal = IGTF_PORCENTAJE) -> dict:
    """items: [{subtotalUsd, impuestoCodigo, porcentajeImpuesto}]. Devuelve los
    totales en USD y, si hay tasa, en Bs, con el desglose por alicuota."""
    grupos: dict[tuple[str, Decimal], Decimal] = {}
    for it in items:
        clave = (it["impuestoCodigo"], Decimal(it["porcentajeImpuesto"]))
        grupos[clave] = grupos.get(clave, CERO) + Decimal(it["subtotalUsd"])
    t = {k: CERO for k in ("baseImponibleUsd", "exentoUsd", "ivaUsd", "baseImponibleBs", "exentoBs", "ivaBs")}
    desglose = []
    for (codigo, pct), base_usd in sorted(grupos.items()):
        iva_usd = redondear(base_usd * pct / 100)
        base_bs = redondear(base_usd * tasa) if tasa else CERO
        iva_bs = redondear(base_bs * pct / 100) if tasa else CERO
        if pct == CERO:
            t["exentoUsd"] += base_usd
            t["exentoBs"] += base_bs
        else:
            t["baseImponibleUsd"] += base_usd
            t["ivaUsd"] += iva_usd
            t["baseImponibleBs"] += base_bs
            t["ivaBs"] += iva_bs
        desglose.append({"codigo": codigo, "porcentaje": float(pct), "baseUsd": float(base_usd), "ivaUsd": float(iva_usd),
                         "baseBs": float(base_bs), "ivaBs": float(iva_bs)})
    pct_igtf = igtf_pct if pago_en_divisas else CERO
    total_sin_igtf_usd = t["baseImponibleUsd"] + t["exentoUsd"] + t["ivaUsd"]
    total_sin_igtf_bs = t["baseImponibleBs"] + t["exentoBs"] + t["ivaBs"]
    igtf_usd = redondear(total_sin_igtf_usd * pct_igtf / 100)
    igtf_bs = redondear(total_sin_igtf_bs * pct_igtf / 100) if tasa else CERO
    return {
        **t,
        "igtfPorcentaje": pct_igtf,
        "igtfUsd": igtf_usd,
        "igtfBs": igtf_bs,
        "totalUsd": total_sin_igtf_usd + igtf_usd,
        "totalBs": total_sin_igtf_bs + igtf_bs,
        "impuestos": desglose,
    }


# ---------- Lectura ----------

_DOC_NUMEROS = (
    "baseImponibleUsd", "exentoUsd", "ivaUsd", "igtfUsd", "totalUsd", "baseImponibleBs", "exentoBs", "ivaBs", "igtfBs",
    "totalBs", "tasa", "igtfPorcentaje",
)


def documento_json(doc: dict, items: list[dict] | None = None) -> dict:
    salida = {k: (float(v) if k in _DOC_NUMEROS and v is not None else v) for k, v in doc.items()}
    for k in ("creadoEn", "emitidoEn"):
        if salida.get(k) is not None and salida[k].tzinfo is None:
            from app.schemas import en_utc

            salida[k] = en_utc(salida[k])
    if doc.get("clienteContribuyenteEspecial") and doc.get("clientePorcentajeRetencionIva"):
        salida["retencionIvaEsperadaBs"] = float(redondear(Decimal(doc["ivaBs"]) * doc["clientePorcentajeRetencionIva"] / 100))
    if items is not None:
        salida["items"] = [
            {**i, "codigoProducto": int(i["codigoProducto"]),
             **{k: float(i[k]) for k in ("cajas", "precioCajaUsd", "descuentoPct", "porcentajeImpuesto", "subtotalUsd")}}
            for i in items
        ]
    return salida


def obtener(cur, documento_id: str, bloquear: bool = False) -> tuple[dict, list[dict]]:
    cur.execute(f'SELECT * FROM "DocumentoVenta" WHERE "id" = %s{" FOR UPDATE" if bloquear else ""}', (documento_id,))
    doc = cur.fetchone()
    if not doc:
        raise HTTPException(404, "Documento no encontrado")
    cur.execute('SELECT * FROM "DocumentoVentaItem" WHERE "documentoId" = %s ORDER BY "descripcion"', (documento_id,))
    return doc, cur.fetchall()


# ---------- Crear (borrador) ----------


def exigir_modulo(cur, empresa_id: str, modulo: str = "ventas") -> None:
    if not empresas.modulo_activo(cur, modulo, empresa_id):
        raise HTTPException(409, f"El modulo de {modulo} no esta activo para esta empresa")


def _producto(cur, producto_id: str, empresa_id: str) -> dict:
    cur.execute('SELECT * FROM "Producto" WHERE "id" = %s AND "empresaId" = %s', (producto_id, empresa_id))
    p = cur.fetchone()
    if not p:
        raise HTTPException(400, "Un producto no es de esta empresa")
    return p


def crear_documento(
    cur,
    *,
    empresa: dict,
    cliente: dict,
    tipo: str,
    renglones: list[dict],
    usuario_id: str,
    almacen_id: str | None,
    pedido_id: str | None = None,
    afectado: dict | None = None,
    motivo: str | None = None,
    pago_en_divisas: bool = False,
    devuelve_inventario: bool = False,
) -> str:
    """renglones: [{productoId, cajas, precioCajaUsd, descuentoPct}]."""
    from app.api.catalogo import alicuota_vigente

    if not renglones:
        raise HTTPException(400, "El documento no tiene renglones")
    doc_id = f"dv-{uuid.uuid4().hex[:16]}"
    items = []
    for r in renglones:
        if Decimal(r["cajas"]) <= CERO:
            raise HTTPException(400, "Las cajas deben ser mayores que cero")
        p = _producto(cur, r["productoId"], empresa["id"])
        pct = CERO if p["impuestoCodigo"] == "EXENTO" else alicuota_vigente(cur, p["impuestoCodigo"], empresa["organizacionId"])
        items.append({
            "id": f"dvi-{uuid.uuid4().hex[:16]}", "documentoId": doc_id, "productoId": p["id"],
            "codigoProducto": p["codigo"], "descripcion": p["nombre"], "cajas": Decimal(r["cajas"]),
            "unidadesPorCaja": p["unidadesPorCaja"], "precioCajaUsd": Decimal(r["precioCajaUsd"]),
            "descuentoPct": Decimal(r.get("descuentoPct") or 0), "impuestoCodigo": p["impuestoCodigo"],
            "porcentajeImpuesto": pct,
            "subtotalUsd": subtotal_item(r["cajas"], r["precioCajaUsd"], r.get("descuentoPct") or 0),
        })
    totales = calcular_totales(items, None, pago_en_divisas)
    cur.execute(
        'INSERT INTO "DocumentoVenta" ("id", "organizacionId", "empresaId", "tipo", "pedidoId", "documentoAfectadoId", '
        '"motivo", "devuelveInventario", "clienteId", "almacenId", "pagoEnDivisas", "igtfPorcentaje", '
        '"baseImponibleUsd", "exentoUsd", "ivaUsd", "igtfUsd", "totalUsd", "impuestos", "creadoPorId") '
        "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
        (
            doc_id, empresa["organizacionId"], empresa["id"], tipo, pedido_id, afectado["id"] if afectado else None,
            motivo, devuelve_inventario, cliente["id"], almacen_id, pago_en_divisas, totales["igtfPorcentaje"],
            totales["baseImponibleUsd"], totales["exentoUsd"], totales["ivaUsd"], totales["igtfUsd"], totales["totalUsd"],
            Jsonb(totales["impuestos"]), usuario_id,
        ),
    )
    cur.executemany(
        'INSERT INTO "DocumentoVentaItem" ("id", "documentoId", "productoId", "codigoProducto", "descripcion", "cajas", '
        '"unidadesPorCaja", "precioCajaUsd", "descuentoPct", "impuestoCodigo", "porcentajeImpuesto", "subtotalUsd") '
        "VALUES (%(id)s, %(documentoId)s, %(productoId)s, %(codigoProducto)s, %(descripcion)s, %(cajas)s, "
        "%(unidadesPorCaja)s, %(precioCajaUsd)s, %(descuentoPct)s, %(impuestoCodigo)s, %(porcentajeImpuesto)s, %(subtotalUsd)s)",
        items,
    )
    bitacora.registrar(cur, usuario_id, "DocumentoVenta", doc_id, "crear", None, {"tipo": tipo, "pedidoId": pedido_id})
    return doc_id


# ---------- Validar y pedir la emision ----------


def _faltantes_cliente(cliente: dict) -> list[str]:
    return [c for c in ("rifCedula", "razonSocial") if not (cliente.get(c) or "").strip()]


def solicitar_emision(cur, documento_id: str, usuario_id: str) -> None:
    from app.api.administracion import tasa_para_emitir

    doc, items = obtener(cur, documento_id, bloquear=True)
    if doc["estado"] != "BORRADOR":
        raise HTTPException(409, "Solo se emite un documento en borrador")
    exigir_modulo(cur, doc["empresaId"])
    cur.execute(f'SELECT {empresas.COLUMNAS} FROM "EmpresaFiscal" WHERE "id" = %s', (doc["empresaId"],))
    empresa = cur.fetchone()
    if empresas.faltantes_para_facturar(empresa):
        raise HTTPException(409, f"Faltan datos fiscales de la empresa: {', '.join(empresas.faltantes_para_facturar(empresa))}")
    cur.execute('SELECT * FROM "Cliente" WHERE "id" = %s', (doc["clienteId"],))
    cliente = cur.fetchone()
    if doc["tipo"] == "FA" and _faltantes_cliente(cliente):
        raise HTTPException(409, f"Faltan datos fiscales del cliente: {', '.join(_faltantes_cliente(cliente))}")
    tasa_para_emitir(cur)
    if doc["tipo"] in ("FA", "NE"):
        if not doc["almacenId"]:
            raise HTTPException(400, "El documento no tiene almacen de salida")
        por_producto: dict[str, Decimal] = {}
        for it in items:
            por_producto[it["productoId"]] = por_producto.get(it["productoId"], CERO) + Decimal(it["cajas"])
        for producto_id, cajas in por_producto.items():
            hay = inventario.disponible(cur, doc["almacenId"], producto_id, sin_pedido=doc["pedidoId"])
            if hay < cajas:
                nombre = next(i["descripcion"] for i in items if i["productoId"] == producto_id)
                raise HTTPException(409, f"No hay existencia suficiente de {nombre}: hay {hay}, se piden {cajas}")
    cur.execute(
        'UPDATE "DocumentoVenta" SET "estado" = \'EN_EMISION\', "errorEmision" = NULL WHERE "id" = %s', (documento_id,)
    )
    tareas.encolar(cur, "ventas.emitir", {"documentoId": documento_id}, clave_unica=f"emitir:{documento_id}",
                   organizacion_id=doc["organizacionId"])
    bitacora.registrar(cur, usuario_id, "DocumentoVenta", documento_id, "solicitar_emision")


# ---------- Emitir (tarea de la cola) ----------


@tareas.manejador("ventas.emitir")
def emitir(cur, datos: dict) -> None:
    from app.api.administracion import estado_tasa as leer_estado_tasa

    doc, items = obtener(cur, datos["documentoId"], bloquear=True)
    if doc["estado"] != "EN_EMISION":
        return
    # Sin tasa reciente no se emite, pero tampoco se rechaza: la tarea se
    # reintenta mas tarde (la tasa del dia puede llegar en un rato).
    estado_tasa = leer_estado_tasa(cur)
    if not estado_tasa["vigente"]:
        raise emision.EmisorNoDisponible("No hay tasa BCV reciente para emitir")
    emisor = None
    try:
        with cur.connection.transaction():
            emisor = emision.obtener_emisor()
            tasa = Decimal(str(estado_tasa["tasa"]))
            totales = calcular_totales(items, tasa, doc["pagoEnDivisas"], Decimal(doc["igtfPorcentaje"]) or IGTF_PORCENTAJE)
            numero = correlativo.formatear(doc["tipo"], correlativo.siguiente(cur, doc["empresaId"], doc["tipo"]))
            cur.execute('SELECT * FROM "Cliente" WHERE "id" = %s', (doc["clienteId"],))
            cliente = cur.fetchone()
            hoy = hoy_caracas()
            _mover_inventario(cur, doc, items)
            respuesta = emisor.emitir({**doc, "numero": numero, "totales": totales, "items": items, "cliente": cliente})
            cur.execute(
                'UPDATE "DocumentoVenta" SET "estado" = \'EMITIDA\', "numero" = %s, "numeroControl" = %s, '
                '"fechaEmision" = %s, "vencimiento" = %s, "tasa" = %s, "fechaTasa" = %s, '
                '"clienteRif" = %s, "clienteRazonSocial" = %s, "clienteDomicilio" = %s, '
                '"clienteContribuyenteEspecial" = %s, "clientePorcentajeRetencionIva" = %s, '
                '"baseImponibleUsd" = %s, "exentoUsd" = %s, "ivaUsd" = %s, "igtfUsd" = %s, "totalUsd" = %s, '
                '"baseImponibleBs" = %s, "exentoBs" = %s, "ivaBs" = %s, "igtfBs" = %s, "totalBs" = %s, '
                '"impuestos" = %s, "emisorFiscal" = %s, "respuestaEmisor" = %s, "emitidoEn" = %s WHERE "id" = %s',
                (
                    numero, respuesta.get("numeroControl"), hoy,
                    hoy + timedelta(days=cliente.get("diasCredito") or 0) if doc["tipo"] in ("FA", "NE", "ND") else None,
                    tasa, estado_tasa["fecha"], cliente.get("rifCedula"), cliente.get("razonSocial") or cliente["nombre"],
                    cliente.get("domicilioFiscal") or cliente.get("direccion"), cliente.get("contribuyenteEspecial") or False,
                    cliente.get("porcentajeRetencionIva"), totales["baseImponibleUsd"], totales["exentoUsd"],
                    totales["ivaUsd"], totales["igtfUsd"], totales["totalUsd"], totales["baseImponibleBs"],
                    totales["exentoBs"], totales["ivaBs"], totales["igtfBs"], totales["totalBs"],
                    Jsonb(totales["impuestos"]), emisor.nombre, Jsonb(respuesta), ahora_utc(), doc["id"],
                ),
            )
            emitido = {**doc, "numero": numero, "fechaEmision": hoy, "tasa": tasa, **totales}
            _enlazar(cur, emitido, items, cliente)
            bitacora.registrar(cur, doc["creadoPorId"], "DocumentoVenta", doc["id"], "emitido", None,
                               {"numero": numero, "numeroControl": respuesta.get("numeroControl")})
    except emision.EmisionRechazada as e:
        _rechazar(cur, doc, str(e), emisor)
    except inventario.SinExistencia as e:
        _rechazar(cur, doc, f"Sin existencia al emitir: {e}", emisor)
    except HTTPException as e:
        _rechazar(cur, doc, str(e.detail), emisor)


def _rechazar(cur, doc: dict, motivo: str, emisor) -> None:
    cur.execute(
        'UPDATE "DocumentoVenta" SET "estado" = \'RECHAZADA\', "errorEmision" = %s, "emisorFiscal" = %s WHERE "id" = %s',
        (motivo[:1000], getattr(emisor, "nombre", None), doc["id"]),
    )
    bitacora.registrar(cur, doc["creadoPorId"], "DocumentoVenta", doc["id"], "rechazado", None, {"motivo": motivo})


def _mover_inventario(cur, doc: dict, items: list[dict]) -> None:
    if doc["tipo"] in ("FA", "NE"):
        for it in items:
            inventario.salida_por_vencimiento(
                cur, empresa_id=doc["empresaId"], almacen_id=doc["almacenId"], producto_id=it["productoId"],
                cajas=Decimal(it["cajas"]), tipo="SALIDA_VENTA", documento_id=doc["id"], usuario_id=doc["creadoPorId"],
            )
    elif doc["tipo"] == "NC" and doc["devuelveInventario"] and doc["documentoAfectadoId"]:
        for it in items:
            inventario.devolver_de_documento(
                cur, documento_origen_id=doc["documentoAfectadoId"], documento_id=doc["id"],
                producto_id=it["productoId"], cajas=Decimal(it["cajas"]), usuario_id=doc["creadoPorId"],
            )


# ---------- Enlaces con cobranzas, indicadores y logistica ----------


def _carga_sistema(cur, empresa_codigo: str, usuario_id: str, fecha: date) -> str:
    carga_id = f"carga-sistema-{empresa_codigo.lower()}"
    cur.execute(
        'INSERT INTO "VentaCarga" ("id", "empresa", "archivo", "periodoDesde", "periodoHasta", "filas", "estado", '
        '"subidaPorId", "confirmadaEn", "resumen", "dimensiones", "origen") '
        "VALUES (%s, %s, 'Sistema administrativo', %s, %s, 0, 'CONFIRMADA', %s, %s, '{}', '{}', 'SISTEMA') "
        'ON CONFLICT ("id") DO UPDATE SET "periodoDesde" = LEAST("VentaCarga"."periodoDesde", EXCLUDED."periodoDesde"), '
        '"periodoHasta" = GREATEST("VentaCarga"."periodoHasta", EXCLUDED."periodoHasta")',
        (carga_id, empresa_codigo, fecha, fecha, usuario_id, ahora_utc()),
    )
    return carga_id


def _enlazar(cur, doc: dict, items: list[dict], cliente: dict) -> None:
    from app.api.despachos import _crear_despacho_interno

    cur.execute('SELECT "codigo" FROM "EmpresaFiscal" WHERE "id" = %s', (doc["empresaId"],))
    empresa_codigo = cur.fetchone()["codigo"]
    signo = SIGNO[doc["tipo"]]

    # Cobranzas
    vence = doc["fechaEmision"] + timedelta(days=cliente.get("diasCredito") or 0)
    cur.execute(
        'INSERT INTO "DocumentoCobro" ("id", "empresa", "tipoDoc", "numero", "codigoCliente", "fecha", "vencimiento", '
        '"montoUsd", "montoBs", "origen", "vigente", "actualizadoEn") '
        "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, 'SISTEMA', true, %s)",
        (
            f"doc-{uuid.uuid4().hex[:16]}", empresa_codigo, doc["tipo"], doc["numero"], cliente["codigo"],
            doc["fechaEmision"], vence if signo > 0 else None, signo * doc["totalUsd"], signo * doc["totalBs"], ahora_utc(),
        ),
    )

    # Indicadores: filas de Venta (sin IVA), con cliente y producto en las
    # tablas que usan los indicadores para la ruta y el grupo.
    carga_id = _carga_sistema(cur, empresa_codigo, doc["creadoPorId"], doc["fechaEmision"])
    cur.execute(
        'INSERT INTO "VentaCliente" ("id", "empresa", "codigo", "nombre", "tipo", "ruta", "listaPrecio") '
        "VALUES (%s, %s, %s, %s, %s, %s, %s) ON CONFLICT (\"empresa\", \"codigo\") DO NOTHING",
        (f"vc-{uuid.uuid4().hex[:12]}", empresa_codigo, cliente["codigo"], cliente.get("razonSocial") or cliente["nombre"],
         cliente.get("tipoVenta") or "TRADICIONAL", cliente.get("rutaVenta") or "SIN RUTA", cliente.get("listaPrecioCodigo")),
    )
    tipo_venta = "VENTA" if signo > 0 else "DEVOLUCION"
    cod_tipo = {"FA": "FA", "NE": "NE", "ND": "FA", "NC": "DV"}[doc["tipo"]]
    for it in items:
        cur.execute('SELECT * FROM "Producto" WHERE "id" = %s', (it["productoId"],))
        p = cur.fetchone()
        cur.execute(
            'INSERT INTO "VentaProducto" ("id", "empresa", "codigo", "nombre", "grupo", "codigoProveedor", '
            '"unidadesPorCaja", "litrosPorUnidad") VALUES (%s, %s, %s, %s, %s, %s, %s, %s) '
            'ON CONFLICT ("empresa", "codigo") DO NOTHING',
            (f"vp-{uuid.uuid4().hex[:12]}", empresa_codigo, p["codigo"], p["nombre"], p["grupo"] or "SIN GRUPO",
             p["codigoProveedor"], p["unidadesPorCaja"], p["litrosPorUnidad"]),
        )
        cajas = Decimal(it["cajas"])
        unidades = int((cajas * p["unidadesPorCaja"]).to_integral_value())
        litros = (Decimal(p["litrosPorUnidad"]) * unidades) if p["litrosPorUnidad"] is not None else CERO
        monto_usd = Decimal(it["subtotalUsd"])
        cur.execute(
            'INSERT INTO "Venta" ("empresa", "cargaId", "fecha", "numDoc", "codTipoDoc", "tipoMovimiento", '
            '"codigoCliente", "codigoProducto", "cajas", "unidades", "litros", "montoBs", "montoUsd") '
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
            (empresa_codigo, carga_id, doc["fechaEmision"], doc["numero"], cod_tipo, tipo_venta, cliente["codigo"],
             p["codigo"], signo * cajas, signo * unidades, signo * litros, signo * redondear(monto_usd * doc["tasa"]),
             signo * monto_usd),
        )
    cur.execute('UPDATE "VentaCarga" SET "filas" = "filas" + %s WHERE "id" = %s', (len(items), carga_id))

    # Logistica: el despacho, como los que llegan por Excel.
    if doc["tipo"] in ("FA", "NE"):
        renglones = []
        for it in items:
            cur.execute('SELECT "pesoCajaKg", "requiereFrio" FROM "Producto" WHERE "id" = %s', (it["productoId"],))
            p = cur.fetchone()
            renglones.append(SimpleNamespace(
                descripcion=it["descripcion"], cantidad=max(1, math.ceil(Decimal(it["cajas"]))),
                pesoUnitarioKg=float(p["pesoCajaKg"] or 0), requiereFrio=p["requiereFrio"],
            ))
        _crear_despacho_interno(
            cur, destino_cliente_id=cliente["id"], numero_documento=doc["numero"], tipo_documento=doc["tipo"],
            creado_por_id=doc["creadoPorId"], items=renglones,
        )

    if doc.get("pedidoId"):
        cur.execute('UPDATE "Pedido" SET "estado" = \'FACTURADO\' WHERE "id" = %s', (doc["pedidoId"],))
