"""Ventas del sistema administrativo: pedidos, documentos (FA, NE, NC, ND) y
libro de ventas. Todo exige el modulo de ventas encendido para la empresa
(apagado por defecto) y su permiso. Ver app/services/ventas.py."""

from __future__ import annotations

import io
import uuid
from datetime import date
from decimal import Decimal

import openpyxl
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, model_validator

from app.core.db import get_connection
from app.core.fechas import ahora_utc, dias_caracas_en_utc
from app.core.permisos import es_vendedor, requiere_permiso, rutas_del_vendedor
from app.services import bitacora, cartera, correlativo, empresas, inventario, tareas
from app.services import ventas as sv

router = APIRouter(prefix="/ventas", tags=["ventas"])


class Renglon(BaseModel):
    productoId: str
    cajas: Decimal = Field(gt=0, le=Decimal("100000"))
    precioCajaUsd: Decimal | None = Field(default=None, ge=0)
    descuentoPct: Decimal = Field(default=Decimal("0"), ge=0, le=100)


class DemandaItemDatos(BaseModel):
    productoId: str
    cajasSolicitadas: Decimal = Field(gt=0, le=Decimal("100000"))


class PedidoDatos(BaseModel):
    # Lo puede mandar quien crea el pedido (la app, sin senal) para no duplicarlo.
    id: str | None = Field(default=None, max_length=64, pattern=r"^[A-Za-z0-9-]+$")
    empresaId: str
    clienteId: str
    almacenId: str
    origen: str = Field(default="WEB", pattern="^(WEB|APP|PORTAL)$")
    notas: str | None = Field(default=None, max_length=500)
    ajustarStock: bool = False
    items: list[Renglon] = Field(default_factory=list, max_length=300)
    demandaNoAtendida: list[DemandaItemDatos] = Field(default_factory=list, max_length=300)

    @model_validator(mode="after")
    def _al_menos_un_renglon(self):
        if not self.items and not self.demandaNoAtendida:
            raise ValueError("El pedido debe incluir al menos un item o demanda no atendida")
        return self


class Anulacion(BaseModel):
    motivo: str = Field(min_length=3, max_length=300)


class Facturacion(BaseModel):
    tipo: str = Field(default="FA", pattern="^(FA|NE)$")
    pagoEnDivisas: bool = False


class NotaDatos(BaseModel):
    tipo: str = Field(pattern="^(NC|ND)$")
    motivo: str = Field(min_length=3, max_length=300)
    devuelveInventario: bool = False
    items: list[Renglon] = Field(min_length=1, max_length=300)


def _emitir_en_segundo_plano(fondo: BackgroundTasks) -> None:
    """La emision sale enseguida despues de responder; si falla, la cola la
    reintenta (ver app/services/tareas.py)."""
    fondo.add_task(tareas.procesar, 5)


# ---------- Pedidos ----------


def _cliente(cur, cliente_id: str, empresa: dict, usuario: dict) -> dict:
    cur.execute('SELECT * FROM "Cliente" WHERE "id" = %s AND "empresa"::text = %s', (cliente_id, empresa["codigo"]))
    cliente = cur.fetchone()
    if not cliente:
        raise HTTPException(404, "Cliente no encontrado en esta empresa")
    if es_vendedor(usuario):
        suyas = {r for e, r in rutas_del_vendedor(cur, usuario["id"]) if e == empresa["codigo"]}
        if cliente.get("rutaVenta") not in suyas:
            raise HTTPException(403, "El cliente no es de tus rutas")
    return cliente


def _precio(cur, cliente: dict, empresa_id: str, producto_id: str) -> Decimal:
    cur.execute(
        'SELECT i."precioCajaUsd" FROM "ListaPrecioItem" i JOIN "ListaPrecio" l ON l."id" = i."listaId" '
        'WHERE l."empresaId" = %s AND l."codigo" = %s AND i."productoId" = %s',
        (empresa_id, cliente.get("listaPrecioCodigo"), producto_id),
    )
    fila = cur.fetchone()
    if not fila:
        raise HTTPException(409, "Un producto no tiene precio en la lista del cliente")
    return Decimal(fila["precioCajaUsd"])


def _pedido(cur, pedido_id: str, usuario: dict, bloquear: bool = False) -> tuple[dict, list[dict]]:
    cur.execute(f'SELECT * FROM "Pedido" WHERE "id" = %s{" FOR UPDATE" if bloquear else ""}', (pedido_id,))
    pedido = cur.fetchone()
    if not pedido:
        raise HTTPException(404, "Pedido no encontrado")
    empresas.exigir(cur, usuario, pedido["empresaId"])
    if es_vendedor(usuario) and pedido["vendedorId"] != usuario["id"]:
        raise HTTPException(404, "Pedido no encontrado")
    cur.execute(
        'SELECT i.*, p."nombre", p."codigo" FROM "PedidoItem" i JOIN "Producto" p ON p."id" = i."productoId" '
        'WHERE i."pedidoId" = %s ORDER BY p."nombre"',
        (pedido_id,),
    )
    return pedido, cur.fetchall()


def _demanda_json(f: dict) -> dict:
    from app.schemas import en_utc

    salida = {
        **f,
        "cajasSolicitadas": float(f["cajasSolicitadas"]),
        "cajasDisponibles": float(f["cajasDisponibles"]),
        "cajasFaltantes": float(f["cajasFaltantes"]),
    }
    if salida.get("productoCodigo") is not None:
        salida["productoCodigo"] = int(salida["productoCodigo"])
    if salida.get("fecha") is not None:
        salida["fecha"] = en_utc(salida["fecha"])
    return salida


def _demandas_de_pedido(cur, pedido_id: str) -> list[dict]:
    cur.execute(
        'SELECT d."id", d."productoId", p."codigo" AS "productoCodigo", p."nombre" AS "productoNombre", '
        'd."cajasSolicitadas", d."cajasDisponibles", d."cajasFaltantes", d."motivo", d."fecha" '
        'FROM "DemandaNoAtendida" d JOIN "Producto" p ON p."id" = d."productoId" '
        'WHERE d."pedidoId" = %s ORDER BY p."nombre"',
        (pedido_id,),
    )
    return [_demanda_json(f) for f in cur.fetchall()]


def _pedido_json(pedido: dict, items: list[dict], demandas: list[dict] | None = None) -> dict:
    from app.schemas import en_utc

    total = sum((sv.subtotal_item(i["cajas"], i["precioCajaUsd"], i["descuentoPct"]) for i in items), Decimal(0))
    salida = {
        **{k: (en_utc(v) if k.endswith("En") and v is not None else v) for k, v in pedido.items()},
        "subtotalUsd": float(total),
        "items": [
            {"id": i["id"], "productoId": i["productoId"], "codigo": int(i["codigo"]), "nombre": i["nombre"],
             "cajas": float(i["cajas"]), "precioCajaUsd": float(i["precioCajaUsd"]), "descuentoPct": float(i["descuentoPct"])}
            for i in items
        ],
    }
    if demandas is not None:
        salida["demandaNoAtendida"] = demandas
        salida["demandaNoAtendidaTotal"] = len(demandas)
    return salida


@router.get("/pedidos")
def listar_pedidos(
    empresaId: str,
    estado: str | None = Query(default=None, pattern="^(BORRADOR|CONFIRMADO|FACTURADO|ANULADO)$"),
    usuario: dict = Depends(requiere_permiso("ventas.pedidos.ver")),
):
    with get_connection() as conn, conn.cursor() as cur:
        empresas.exigir(cur, usuario, empresaId)
        sv.exigir_modulo(cur, empresaId)
        cur.execute(
            'SELECT p."id", p."numero", p."estado", p."origen", p."creadoEn" AT TIME ZONE \'UTC\' AS "creadoEn", '
            'c."codigo" AS "clienteCodigo", COALESCE(c."razonSocial", c."nombre") AS "cliente", '
            'u."nombre" AS "vendedor", count(i."id") AS "renglones", '
            'COALESCE(SUM(round(i."cajas" * i."precioCajaUsd" * (100 - i."descuentoPct") / 100, 2)), 0) AS "subtotalUsd" '
            'FROM "Pedido" p JOIN "Cliente" c ON c."id" = p."clienteId" LEFT JOIN "Usuario" u ON u."id" = p."vendedorId" '
            'LEFT JOIN "PedidoItem" i ON i."pedidoId" = p."id" '
            'WHERE p."empresaId" = %s AND (%s::text IS NULL OR p."estado"::text = %s) '
            'AND (%s::text IS NULL OR p."vendedorId" = %s) '
            'GROUP BY p."id", c."id", u."id" ORDER BY p."creadoEn" DESC LIMIT 500',
            (empresaId, estado, estado, usuario["id"] if es_vendedor(usuario) else None,
             usuario["id"] if es_vendedor(usuario) else None),
        )
        return [{**f, "subtotalUsd": float(f["subtotalUsd"])} for f in cur.fetchall()]


@router.post("/pedidos", status_code=201)
def crear_pedido(data: PedidoDatos, usuario: dict = Depends(requiere_permiso("ventas.pedidos.crear"))):
    with get_connection() as conn, conn.cursor() as cur:
        empresa = empresas.exigir(cur, usuario, data.empresaId)
        sv.exigir_modulo(cur, data.empresaId)
        pedido_id = data.id or f"ped-{uuid.uuid4().hex[:16]}"
        cur.execute('SELECT "id" FROM "Pedido" WHERE "id" = %s', (pedido_id,))
        if cur.fetchone():
            # Reenvio del mismo pedido (la app sin senal): se devuelve el que ya esta.
            return _pedido_json(*_pedido(cur, pedido_id, usuario), demandas=_demandas_de_pedido(cur, pedido_id))
        cliente = _cliente(cur, data.clienteId, empresa, usuario)
        cur.execute('SELECT 1 FROM "Almacen" WHERE "id" = %s', (data.almacenId,))
        if not cur.fetchone():
            raise HTTPException(400, "Almacen desconocido")

        # Validar productos y consultar disponibilidad antes de insertar.
        disponibles: dict[str, Decimal] = {}
        for pid in {r.productoId for r in data.items} | {d.productoId for d in data.demandaNoAtendida}:
            sv._producto(cur, pid, empresa["id"])
            disponibles[pid] = max(Decimal("0"), inventario.disponible(cur, data.almacenId, pid))

        vendedor_id = usuario["id"] if es_vendedor(usuario) else None
        numero = correlativo.formatear("PED", correlativo.siguiente(cur, empresa["id"], "PEDIDO"))
        cur.execute(
            'INSERT INTO "Pedido" ("id", "organizacionId", "empresaId", "numero", "clienteId", "almacenId", "vendedorId", '
            '"origen", "listaPrecioCodigo", "notas", "creadoPorId") VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)',
            (pedido_id, empresa["organizacionId"], empresa["id"], numero, cliente["id"], data.almacenId,
             vendedor_id, data.origen, cliente.get("listaPrecioCodigo"), data.notas, usuario["id"]),
        )

        solicitadas_items: dict[str, Decimal] = {}
        restante = dict(disponibles)
        for r in data.items:
            solicitadas_items[r.productoId] = solicitadas_items.get(r.productoId, Decimal("0")) + r.cajas
            if data.ajustarStock:
                cajas_item = min(r.cajas, restante[r.productoId])
                restante[r.productoId] -= cajas_item
                if cajas_item <= 0:
                    continue
            else:
                cajas_item = r.cajas
            precio = r.precioCajaUsd if r.precioCajaUsd is not None and not es_vendedor(usuario) else _precio(
                cur, cliente, empresa["id"], r.productoId
            )
            cur.execute(
                'INSERT INTO "PedidoItem" ("id", "pedidoId", "productoId", "cajas", "precioCajaUsd", "descuentoPct") '
                "VALUES (%s, %s, %s, %s, %s, %s)",
                (f"pi-{uuid.uuid4().hex[:16]}", pedido_id, r.productoId, cajas_item, precio, r.descuentoPct),
            )

        # Demanda no atendida: automatica (cuando items excede disponible) y/o
        # explicita en data.demandaNoAtendida, deduplicada por productoId.
        solicitadas_explicitas: dict[str, Decimal] = {}
        for d in data.demandaNoAtendida:
            solicitadas_explicitas[d.productoId] = solicitadas_explicitas.get(d.productoId, Decimal("0")) + d.cajasSolicitadas

        candidatos_demanda: dict[str, Decimal] = {}
        for pid, cajas_sol in solicitadas_items.items():
            if cajas_sol > disponibles[pid]:
                candidatos_demanda[pid] = cajas_sol
        for pid, cajas_sol in solicitadas_explicitas.items():
            prev = candidatos_demanda.get(pid, Decimal("0"))
            candidatos_demanda[pid] = max(prev, cajas_sol)

        for pid, cajas_sol in candidatos_demanda.items():
            cajas_disp = disponibles[pid]
            if cajas_sol <= cajas_disp:
                continue
            cajas_faltantes = cajas_sol - cajas_disp
            motivo = "SIN_STOCK" if cajas_disp <= 0 else "STOCK_PARCIAL"
            cur.execute(
                'INSERT INTO "DemandaNoAtendida" '
                '("id", "organizacionId", "empresaId", "almacenId", "clienteId", "vendedorId", "productoId", '
                '"pedidoId", "cajasSolicitadas", "cajasDisponibles", "cajasFaltantes", "motivo") '
                "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
                (
                    f"dna-{uuid.uuid4().hex[:16]}", empresa["organizacionId"], empresa["id"], data.almacenId,
                    cliente["id"], vendedor_id, pid, pedido_id, cajas_sol, cajas_disp, cajas_faltantes, motivo,
                ),
            )

        bitacora.registrar(cur, usuario["id"], "Pedido", pedido_id, "crear", None, {"numero": numero})
        conn.commit()
        return _pedido_json(*_pedido(cur, pedido_id, usuario), demandas=_demandas_de_pedido(cur, pedido_id))


def _consultar_demanda_no_atendida(
    cur,
    *,
    usuario: dict,
    empresa_id: str | None = None,
    desde: date | None = None,
    hasta: date | None = None,
    vendedor_id: str | None = None,
    producto_id: str | None = None,
) -> dict:
    if desde and hasta and hasta < desde:
        raise HTTPException(400, "La fecha final no puede ser anterior a la inicial")
    condiciones: list[str] = []
    params: list = []
    if empresa_id:
        empresas.exigir(cur, usuario, empresa_id)
        condiciones.append('d."empresaId" = %s')
        params.append(empresa_id)
    else:
        permitidas = [e["id"] for e in empresas.del_usuario(cur, usuario)]
        if not permitidas:
            return {
                "items": [],
                "resumen": {
                    "totalRegistros": 0,
                    "totalCajasSolicitadas": 0.0,
                    "totalCajasDisponibles": 0.0,
                    "totalCajasFaltantes": 0.0,
                    "sinStock": 0,
                    "stockParcial": 0,
                    "productosDistintos": 0,
                },
            }
        condiciones.append('d."empresaId" = ANY(%s)')
        params.append(permitidas)
    if desde:
        inicio, _ = dias_caracas_en_utc(desde, desde)
        condiciones.append('d."fecha" >= %s')
        params.append(inicio)
    if hasta:
        _, fin = dias_caracas_en_utc(hasta, hasta)
        condiciones.append('d."fecha" < %s')
        params.append(fin)
    vendedor_filtro = usuario["id"] if es_vendedor(usuario) else vendedor_id
    if vendedor_filtro:
        condiciones.append('d."vendedorId" = %s')
        params.append(vendedor_filtro)
    if producto_id:
        condiciones.append('d."productoId" = %s')
        params.append(producto_id)
    where_sql = f'WHERE {" AND ".join(condiciones)}' if condiciones else ""
    cur.execute(
        'SELECT d."id", d."organizacionId", d."empresaId", ef."codigo" AS "empresaCodigo", '
        'ef."razonSocial" AS "empresaNombre", d."almacenId", a."nombre" AS "almacenNombre", '
        'd."clienteId", c."codigo" AS "clienteCodigo", '
        'COALESCE(c."razonSocial", c."nombre") AS "clienteNombre", '
        'd."vendedorId", u."nombre" AS "vendedorNombre", '
        'd."productoId", p."codigo" AS "productoCodigo", p."nombre" AS "productoNombre", p."grupo" AS "productoGrupo", '
        'd."pedidoId", ped."numero" AS "pedidoNumero", '
        'd."cajasSolicitadas", d."cajasDisponibles", d."cajasFaltantes", d."motivo", d."fecha" '
        'FROM "DemandaNoAtendida" d '
        'JOIN "EmpresaFiscal" ef ON ef."id" = d."empresaId" '
        'JOIN "Almacen" a ON a."id" = d."almacenId" '
        'JOIN "Cliente" c ON c."id" = d."clienteId" '
        'JOIN "Producto" p ON p."id" = d."productoId" '
        'LEFT JOIN "Usuario" u ON u."id" = d."vendedorId" '
        'LEFT JOIN "Pedido" ped ON ped."id" = d."pedidoId" '
        f'{where_sql} '
        'ORDER BY d."fecha" DESC, d."id" DESC LIMIT 1000',
        params,
    )
    filas = [_demanda_json(f) for f in cur.fetchall()]
    resumen = {
        "totalRegistros": len(filas),
        "totalCajasSolicitadas": round(sum(f["cajasSolicitadas"] for f in filas), 3),
        "totalCajasDisponibles": round(sum(f["cajasDisponibles"] for f in filas), 3),
        "totalCajasFaltantes": round(sum(f["cajasFaltantes"] for f in filas), 3),
        "sinStock": sum(1 for f in filas if f["motivo"] == "SIN_STOCK"),
        "stockParcial": sum(1 for f in filas if f["motivo"] == "STOCK_PARCIAL"),
        "productosDistintos": len({f["productoId"] for f in filas}),
    }
    return {"items": filas, "resumen": resumen}


@router.get("/demanda-no-atendida")
def listar_demanda_no_atendida(
    empresaId: str | None = None,
    desde: date | None = None,
    hasta: date | None = None,
    vendedorId: str | None = None,
    productoId: str | None = None,
    usuario: dict = Depends(requiere_permiso("ventas.pedidos.ver")),
):
    with get_connection() as conn, conn.cursor() as cur:
        return _consultar_demanda_no_atendida(
            cur,
            usuario=usuario,
            empresa_id=empresaId,
            desde=desde,
            hasta=hasta,
            vendedor_id=vendedorId,
            producto_id=productoId,
        )


@router.get("/pedidos/{pedido_id}")
def ver_pedido(pedido_id: str, usuario: dict = Depends(requiere_permiso("ventas.pedidos.ver"))):
    with get_connection() as conn, conn.cursor() as cur:
        return _pedido_json(*_pedido(cur, pedido_id, usuario))


@router.post("/pedidos/{pedido_id}/confirmar")
def confirmar_pedido(
    pedido_id: str, forzarCredito: bool = False, usuario: dict = Depends(requiere_permiso("ventas.pedidos.crear"))
):
    """Revisa credito (deuda vencida y limite) y existencia, y lo reserva."""
    with get_connection() as conn, conn.cursor() as cur:
        pedido, items = _pedido(cur, pedido_id, usuario, bloquear=True)
        if pedido["estado"] != "BORRADOR":
            raise HTTPException(409, "Solo se confirma un pedido en borrador")
        sv.exigir_modulo(cur, pedido["empresaId"])
        cur.execute('SELECT * FROM "Cliente" WHERE "id" = %s', (pedido["clienteId"],))
        cliente = cur.fetchone()
        p = cartera.parametros(cur)
        estado = cartera.estado_cliente(cur, cliente["empresa"], cliente["codigo"], p)
        total = sum((sv.subtotal_item(i["cajas"], i["precioCajaUsd"], i["descuentoPct"]) for i in items), Decimal(0))
        problemas = []
        if estado.bloqueado(p):
            problemas.append(f"tiene deuda vencida por ${estado.vencido_usd(p.hoy):.2f}")
        if cliente.get("limiteCreditoUsd") is not None and estado.saldo_usd() + total > Decimal(cliente["limiteCreditoUsd"]):
            problemas.append(f"supera su limite de credito (${Decimal(cliente['limiteCreditoUsd']):.2f})")
        if problemas and not (forzarCredito and cartera.puede_autorizar_excepciones(usuario)):
            raise HTTPException(409, "El cliente " + " y ".join(problemas))
        for it in items:
            hay = inventario.disponible(cur, pedido["almacenId"], it["productoId"], sin_pedido=pedido_id)
            if hay < Decimal(it["cajas"]):
                raise HTTPException(409, f"No hay existencia suficiente de {it['nombre']}: hay {hay}")
        cur.execute(
            'UPDATE "Pedido" SET "estado" = \'CONFIRMADO\', "confirmadoEn" = %s WHERE "id" = %s', (ahora_utc(), pedido_id)
        )
        bitacora.registrar(cur, usuario["id"], "Pedido", pedido_id, "confirmar", None,
                           {"forzadoCredito": bool(problemas), "problemas": problemas})
        conn.commit()
        return _pedido_json(*_pedido(cur, pedido_id, usuario))


@router.post("/pedidos/{pedido_id}/anular")
def anular_pedido(pedido_id: str, data: Anulacion, usuario: dict = Depends(requiere_permiso("ventas.pedidos.anular"))):
    with get_connection() as conn, conn.cursor() as cur:
        pedido, _ = _pedido(cur, pedido_id, usuario, bloquear=True)
        if pedido["estado"] not in ("BORRADOR", "CONFIRMADO"):
            raise HTTPException(409, "Un pedido facturado se corrige con una nota de credito")
        cur.execute(
            'UPDATE "Pedido" SET "estado" = \'ANULADO\', "anuladoEn" = %s, "motivoAnulacion" = %s WHERE "id" = %s',
            (ahora_utc(), data.motivo.strip(), pedido_id),
        )
        bitacora.registrar(cur, usuario["id"], "Pedido", pedido_id, "anular", None, {"motivo": data.motivo})
        conn.commit()
    return {"ok": True}


@router.post("/pedidos/{pedido_id}/facturar")
def facturar_pedido(
    pedido_id: str, data: Facturacion, fondo: BackgroundTasks,
    usuario: dict = Depends(requiere_permiso("ventas.facturar")),
):
    """Crea la FA o NE del pedido confirmado y la manda a emitir."""
    with get_connection() as conn, conn.cursor() as cur:
        pedido, items = _pedido(cur, pedido_id, usuario, bloquear=True)
        if pedido["estado"] != "CONFIRMADO":
            raise HTTPException(409, "Solo se factura un pedido confirmado")
        cur.execute(
            "SELECT 1 FROM \"DocumentoVenta\" WHERE \"pedidoId\" = %s AND \"estado\" IN ('BORRADOR', 'EN_EMISION', 'EMITIDA')",
            (pedido_id,),
        )
        if cur.fetchone():
            raise HTTPException(409, "El pedido ya tiene un documento")
        empresa = empresas.exigir(cur, usuario, pedido["empresaId"])
        cur.execute('SELECT * FROM "Cliente" WHERE "id" = %s', (pedido["clienteId"],))
        cliente = cur.fetchone()
        doc_id = sv.crear_documento(
            cur, empresa=empresa, cliente=cliente, tipo=data.tipo, usuario_id=usuario["id"], almacen_id=pedido["almacenId"],
            pedido_id=pedido_id, pago_en_divisas=data.pagoEnDivisas,
            renglones=[{"productoId": i["productoId"], "cajas": i["cajas"], "precioCajaUsd": i["precioCajaUsd"],
                        "descuentoPct": i["descuentoPct"]} for i in items],
        )
        sv.solicitar_emision(cur, doc_id, usuario["id"])
        conn.commit()
    _emitir_en_segundo_plano(fondo)
    return {"documentoId": doc_id}


# ---------- Documentos ----------


@router.get("/documentos")
def listar_documentos(
    empresaId: str,
    desde: date | None = None,
    hasta: date | None = None,
    tipo: str | None = Query(default=None, pattern="^(FA|NE|NC|ND)$"),
    usuario: dict = Depends(requiere_permiso("ventas.documentos.ver")),
):
    with get_connection() as conn, conn.cursor() as cur:
        empresas.exigir(cur, usuario, empresaId)
        cur.execute(
            'SELECT d."id", d."tipo", d."numero", d."numeroControl", d."estado", d."fechaEmision", d."totalUsd", '
            'd."totalBs", d."errorEmision", d."creadoEn" AT TIME ZONE \'UTC\' AS "creadoEn", '
            'COALESCE(d."clienteRazonSocial", c."razonSocial", c."nombre") AS "cliente", c."codigo" AS "clienteCodigo", '
            'a."numero" AS "documentoAfectado" '
            'FROM "DocumentoVenta" d JOIN "Cliente" c ON c."id" = d."clienteId" '
            'LEFT JOIN "DocumentoVenta" a ON a."id" = d."documentoAfectadoId" '
            'WHERE d."empresaId" = %s AND (%s::date IS NULL OR COALESCE(d."fechaEmision", d."creadoEn"::date) >= %s) '
            'AND (%s::date IS NULL OR COALESCE(d."fechaEmision", d."creadoEn"::date) <= %s) '
            'AND (%s::text IS NULL OR d."tipo"::text = %s) ORDER BY d."creadoEn" DESC LIMIT 1000',
            (empresaId, desde, desde, hasta, hasta, tipo, tipo),
        )
        return [{**f, "totalUsd": float(f["totalUsd"]), "totalBs": float(f["totalBs"])} for f in cur.fetchall()]


@router.get("/documentos/{documento_id}")
def ver_documento(documento_id: str, usuario: dict = Depends(requiere_permiso("ventas.documentos.ver"))):
    with get_connection() as conn, conn.cursor() as cur:
        doc, items = sv.obtener(cur, documento_id)
        empresas.exigir(cur, usuario, doc["empresaId"])
        cur.execute(f'SELECT {empresas.COLUMNAS} FROM "EmpresaFiscal" WHERE "id" = %s', (doc["empresaId"],))
        empresa = cur.fetchone()
        cur.execute('SELECT "codigo", "nombre", "direccion", "rifCedula", "razonSocial" FROM "Cliente" WHERE "id" = %s',
                    (doc["clienteId"],))
        cliente = cur.fetchone()
        cur.execute(
            'SELECT "id", "tipo", "numero", "estado", "totalUsd" FROM "DocumentoVenta" WHERE "documentoAfectadoId" = %s',
            (documento_id,),
        )
        notas = [{**n, "totalUsd": float(n["totalUsd"])} for n in cur.fetchall()]
        afectado = None
        if doc["documentoAfectadoId"]:
            cur.execute('SELECT "id", "tipo", "numero" FROM "DocumentoVenta" WHERE "id" = %s', (doc["documentoAfectadoId"],))
            afectado = cur.fetchone()
        return {**sv.documento_json(doc, items), "empresa": empresa, "cliente": cliente, "notas": notas,
                "afectado": afectado}


@router.post("/documentos/{documento_id}/reintentar")
def reintentar_emision(
    documento_id: str, fondo: BackgroundTasks, usuario: dict = Depends(requiere_permiso("ventas.facturar"))
):
    """Un documento RECHAZADO vuelve a borrador para corregir datos (del
    cliente o la empresa) y pedir la emision de nuevo."""
    with get_connection() as conn, conn.cursor() as cur:
        doc, _ = sv.obtener(cur, documento_id, bloquear=True)
        empresas.exigir(cur, usuario, doc["empresaId"])
        if doc["estado"] != "RECHAZADA":
            raise HTTPException(409, "Solo se reintenta un documento rechazado")
        cur.execute('UPDATE "DocumentoVenta" SET "estado" = \'BORRADOR\' WHERE "id" = %s', (documento_id,))
        cur.execute('DELETE FROM "Tarea" WHERE "claveUnica" = %s AND "estado" <> \'EN_CURSO\'', (f"emitir:{documento_id}",))
        sv.solicitar_emision(cur, documento_id, usuario["id"])
        conn.commit()
    _emitir_en_segundo_plano(fondo)
    return {"ok": True}


@router.post("/documentos/{documento_id}/notas", status_code=201)
def crear_nota(
    documento_id: str, data: NotaDatos, fondo: BackgroundTasks,
    usuario: dict = Depends(requiere_permiso("ventas.notas")),
):
    """Nota de credito (devolucion, descuento, anulacion total) o de debito
    sobre un documento emitido."""
    with get_connection() as conn, conn.cursor() as cur:
        afectado, items = sv.obtener(cur, documento_id, bloquear=True)
        empresa = empresas.exigir(cur, usuario, afectado["empresaId"])
        if afectado["estado"] != "EMITIDA" or afectado["tipo"] not in ("FA", "NE"):
            raise HTTPException(409, "Las notas van sobre una factura o nota de entrega emitida")
        if data.tipo == "NC":
            # No se acredita mas de lo vendido (sumando las notas anteriores).
            cur.execute(
                'SELECT i."productoId", SUM(i."cajas") AS c FROM "DocumentoVentaItem" i JOIN "DocumentoVenta" d '
                'ON d."id" = i."documentoId" WHERE d."documentoAfectadoId" = %s AND d."tipo" = \'NC\' '
                "AND d.\"estado\" IN ('BORRADOR', 'EN_EMISION', 'EMITIDA') GROUP BY 1",
                (documento_id,),
            )
            acreditado = {f["productoId"]: Decimal(f["c"]) for f in cur.fetchall()}
            vendido: dict[str, Decimal] = {}
            for it in items:
                vendido[it["productoId"]] = vendido.get(it["productoId"], Decimal(0)) + Decimal(it["cajas"])
            for r in data.items:
                if r.cajas + acreditado.get(r.productoId, Decimal(0)) > vendido.get(r.productoId, Decimal(0)):
                    raise HTTPException(409, "La nota de credito acredita mas cajas de las vendidas")
        precios = {it["productoId"]: it for it in items}
        renglones = []
        for r in data.items:
            base = precios.get(r.productoId)
            if not base and data.tipo == "NC":
                raise HTTPException(400, "La nota de credito solo lleva productos del documento")
            renglones.append({
                "productoId": r.productoId, "cajas": r.cajas,
                "precioCajaUsd": r.precioCajaUsd if r.precioCajaUsd is not None else base["precioCajaUsd"],
                "descuentoPct": r.descuentoPct if r.precioCajaUsd is not None else base["descuentoPct"],
            })
        cur.execute('SELECT * FROM "Cliente" WHERE "id" = %s', (afectado["clienteId"],))
        cliente = cur.fetchone()
        doc_id = sv.crear_documento(
            cur, empresa=empresa, cliente=cliente, tipo=data.tipo, renglones=renglones, usuario_id=usuario["id"],
            almacen_id=afectado["almacenId"], afectado=afectado, motivo=data.motivo.strip(),
            pago_en_divisas=afectado["pagoEnDivisas"], devuelve_inventario=data.devuelveInventario and data.tipo == "NC",
        )
        sv.solicitar_emision(cur, doc_id, usuario["id"])
        conn.commit()
    _emitir_en_segundo_plano(fondo)
    return {"documentoId": doc_id}


# ---------- Libro de ventas ----------


def _libro(cur, empresa_id: str, mes: date) -> list[dict]:
    inicio = mes.replace(day=1)
    fin = date(inicio.year + (inicio.month == 12), inicio.month % 12 + 1, 1)
    cur.execute(
        """
        SELECT d."id", d."fechaEmision", d."tipo", d."numero", d."numeroControl", d."clienteRif", d."clienteRazonSocial",
               a."numero" AS "documentoAfectado", d."exentoBs", d."baseImponibleBs", d."ivaBs", d."igtfBs", d."totalBs",
               d."impuestos", d."tasa",
               COALESCE((SELECT SUM(pa."montoUsd") FROM "PagoAplicacion" pa JOIN "Pago" pg ON pg."id" = pa."pagoId"
                         JOIN "DocumentoCobro" dc ON dc."id" = pa."documentoId"
                         WHERE pg."metodo" = 'RETENCION' AND pg."estado" = 'VERIFICADO'
                           AND dc."tipoDoc" = d."tipo"::text AND dc."numero" = d."numero"), 0) AS "retencionUsd"
        FROM "DocumentoVenta" d LEFT JOIN "DocumentoVenta" a ON a."id" = d."documentoAfectadoId"
        WHERE d."empresaId" = %s AND d."estado" = 'EMITIDA' AND d."tipo" IN ('FA', 'NC', 'ND')
          AND d."fechaEmision" >= %s AND d."fechaEmision" < %s
        ORDER BY d."fechaEmision", d."numero"
        """,
        (empresa_id, inicio, fin),
    )
    filas = []
    for f in cur.fetchall():
        signo = -1 if f["tipo"] == "NC" else 1
        por_alicuota = {i["codigo"]: i for i in (f["impuestos"] or [])}
        filas.append({
            "fecha": f["fechaEmision"], "tipo": f["tipo"], "numero": f["numero"], "numeroControl": f["numeroControl"],
            "rif": f["clienteRif"], "razonSocial": f["clienteRazonSocial"], "documentoAfectado": f["documentoAfectado"],
            "totalBs": signo * float(f["totalBs"]), "exentoBs": signo * float(f["exentoBs"]),
            **{f"base{k}": signo * por_alicuota.get(c, {}).get("baseBs", 0.0)
               for k, c in (("General", "IVA_GENERAL"), ("Reducida", "IVA_REDUCIDO"), ("Adicional", "IVA_ADICIONAL"))},
            **{f"iva{k}": signo * por_alicuota.get(c, {}).get("ivaBs", 0.0)
               for k, c in (("General", "IVA_GENERAL"), ("Reducida", "IVA_REDUCIDO"), ("Adicional", "IVA_ADICIONAL"))},
            "igtfBs": signo * float(f["igtfBs"]),
            "retencionIvaBs": float(sv.redondear(Decimal(f["retencionUsd"]) * Decimal(f["tasa"] or 0))),
        })
    return filas


@router.get("/libro")
def libro_de_ventas(empresaId: str, mes: date, usuario: dict = Depends(requiere_permiso("fiscal.libros"))):
    """Las ventas del mes (FA, NC, ND emitidas) con su base e IVA por
    alicuota. Las notas de entrega no van al libro."""
    with get_connection() as conn, conn.cursor() as cur:
        empresas.exigir(cur, usuario, empresaId)
        return _libro(cur, empresaId, mes)


COLUMNAS_LIBRO = [
    ("fecha", "Fecha"), ("tipo", "Tipo"), ("numero", "N° documento"), ("numeroControl", "N° control"),
    ("rif", "RIF"), ("razonSocial", "Razón social"), ("documentoAfectado", "Doc. afectado"),
    ("totalBs", "Total con IVA (Bs)"), ("exentoBs", "Exento (Bs)"), ("baseGeneral", "Base 16 %"), ("ivaGeneral", "IVA 16 %"),
    ("baseReducida", "Base 8 %"), ("ivaReducida", "IVA 8 %"), ("baseAdicional", "Base adicional"),
    ("ivaAdicional", "IVA adicional"), ("igtfBs", "IGTF (Bs)"), ("retencionIvaBs", "IVA retenido (Bs)"),
]


@router.get("/libro.xlsx")
def libro_de_ventas_excel(empresaId: str, mes: date, usuario: dict = Depends(requiere_permiso("fiscal.libros"))):
    with get_connection() as conn, conn.cursor() as cur:
        empresa = empresas.exigir(cur, usuario, empresaId)
        filas = _libro(cur, empresaId, mes)
    libro = openpyxl.Workbook()
    hoja = libro.active
    hoja.title = "Libro de ventas"
    hoja.append([f"Libro de ventas {mes:%m/%Y} — {empresa['razonSocial']} ({empresa.get('rif') or 'sin RIF'})"])
    hoja.append([t for _, t in COLUMNAS_LIBRO])
    for f in filas:
        hoja.append([f[c] for c, _ in COLUMNAS_LIBRO])
    if filas:
        hoja.append(["Totales"] + [""] * 6 + [round(sum(f[c] for f in filas), 2) for c, _ in COLUMNAS_LIBRO[7:]])
    datos = io.BytesIO()
    libro.save(datos)
    datos.seek(0)
    nombre = f"libro_ventas_{empresa['codigo']}_{mes:%Y-%m}.xlsx"
    return StreamingResponse(
        datos, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{nombre}"'},
    )
