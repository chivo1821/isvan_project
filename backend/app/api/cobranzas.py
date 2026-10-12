"""Cobranzas: la cartera de los clientes, la verificacion de los pagos que
reportan desde el portal, los pagos que se registran a mano, las cuentas del
portal y los ajustes (tolerancia, inicio de cartera, tasa BCV, cuentas de la
empresa).

Router de un solo modulo para el rol COBRANZAS (ver ROUTERS_POR_ROL en
app/main.py); el ADMIN tambien entra. Las reglas de saldo y bloqueo estan en
app/services/cartera.py.
"""

from __future__ import annotations

import hmac
import os
import uuid
from datetime import date
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Path, Query

from app.api.portal import estado_cuenta_libro, servir_comprobante
from app.api.reportes import _como_adjunto
from app.core.auth import requiere_rol
from app.core.db import get_connection
from app.core.fechas import hoy_caracas
from app.core.portal_auth import cerrar_sesiones
from app.schemas import (
    AjustesCobranzaUpdate,
    CuentaBancariaEmpresaIn,
    Empresa,
    PagoManualCreate,
    RechazarPagoRequest,
    TasaManualRequest,
    VerificarPagoRequest,
    VincularClienteRequest,
    en_utc,
)
from app.services import bancos, cartera, configuracion, correo, documento_cobro, pagos, tablero_cobranzas, tasa_bcv
from app.services.motorizados import validar_telefono

router = APIRouter(prefix="/cobranzas", tags=["cobranzas"], dependencies=[Depends(requiere_rol("COBRANZAS"))])

CodigoPath = Annotated[str, Path(max_length=20, pattern=r"^[A-Za-z0-9-]+$")]


def _instantes(fila: dict, *campos: str) -> dict:
    return {**fila, **{c: en_utc(fila[c]) for c in campos if fila.get(c)}}


# ---------- Resumen y clientes ----------


@router.get("/resumen")
def resumen():
    """Lo que se muestra arriba en todas las pantallas de cobranzas."""
    with get_connection() as conn, conn.cursor() as cur:
        p = cartera.parametros(cur)
        estados = cartera.estados(cur, p=p)
        cur.execute(
            "SELECT count(*) FILTER (WHERE \"estado\" = 'REPORTADO') AS \"porVerificar\" FROM \"Pago\""
        )
        por_verificar = cur.fetchone()["porVerificar"]
        cur.execute("SELECT count(*) AS n FROM \"CuentaPortal\" WHERE \"estado\" = 'POR_VALIDAR'")
        cuentas = cur.fetchone()["n"]
        tasa = tasa_bcv.ultima(cur)
    return {
        "carteraUsd": float(sum((e.saldo_usd() for e in estados.values()), Decimal(0))),
        "vencidoUsd": float(sum((e.vencido_usd(p.hoy) for e in estados.values()), Decimal(0))),
        "clientesConSaldo": sum(1 for e in estados.values() if e.saldo_usd() > 0),
        "clientesBloqueados": sum(1 for e in estados.values() if e.bloqueado(p)),
        "pagosPorVerificar": por_verificar,
        "cuentasPorValidar": cuentas,
        "inicioCartera": p.inicio,
        "diasTolerancia": p.tolerancia,
        "bloqueoActivo": p.bloqueo_activo,
        "tasa": {"fecha": tasa["fecha"], "tasa": float(tasa["tasa"]), "fuente": tasa["fuente"]} if tasa else None,
    }


@router.get("/tablero")
def tablero(
    empresa: Empresa | None = None,
    desde: date | None = None,
    hasta: date | None = None,
    ruta: str | None = Query(None, max_length=40),
):
    """Por defecto, los ultimos 6 meses (desde el primer dia del mes)."""
    hoy = hoy_caracas()
    hasta = min(hasta or hoy, hoy)
    if desde is None:
        mes = hasta.month - 5
        desde = date(hasta.year + (mes - 1) // 12, (mes - 1) % 12 + 1, 1)
    if desde > hasta:
        raise HTTPException(422, "La fecha inicial es posterior a la final")
    if (hasta - desde).days > 3 * 366:
        raise HTTPException(422, "El período no puede pasar de 3 años")
    with get_connection() as conn, conn.cursor() as cur:
        return tablero_cobranzas.tablero(cur, empresa, desde, hasta, ruta)


@router.get("/clientes")
def clientes(
    empresa: Empresa | None = None,
    estado: str = Query("con_saldo", pattern="^(todos|con_saldo|vencidos|bloqueados|al_dia)$"),
):
    with get_connection() as conn, conn.cursor() as cur:
        p = cartera.parametros(cur)
        estados = cartera.estados(cur, empresa=empresa, p=p)
        datos = cartera.datos_clientes(cur, empresa=empresa)
        cur.execute(
            "SELECT \"empresa\"::text AS \"empresa\", \"codigoCliente\", count(*) AS n FROM \"Pago\" "
            "WHERE \"estado\" = 'REPORTADO' GROUP BY 1, 2"
        )
        por_verificar = {(f["empresa"], f["codigoCliente"]): f["n"] for f in cur.fetchall()}
        cur.execute(
            'SELECT "empresa"::text AS "empresa", "codigoCliente", count(*) AS n FROM "CuentaPortalCliente" GROUP BY 1, 2'
        )
        con_cuenta = {(f["empresa"], f["codigoCliente"]): f["n"] for f in cur.fetchall()}
    filas = []
    for clave, est in estados.items():
        r = est.resumen(p)
        if estado == "con_saldo" and r["saldoUsd"] <= 0:
            continue
        if estado == "vencidos" and r["vencidoUsd"] <= 0:
            continue
        if estado == "bloqueados" and not r["bloqueado"]:
            continue
        if estado == "al_dia" and r["saldoUsd"] > 0:
            continue
        dato = datos.get(clave) or {}
        filas.append({
            **r, "nombre": dato.get("nombre") or f"Cliente {clave[1]}", "ruta": dato.get("ruta"),
            "tipo": dato.get("tipo"), "pagosPorVerificar": por_verificar.get(clave, 0),
            "cuentasPortal": con_cuenta.get(clave, 0),
        })
    filas.sort(key=lambda f: (-f["vencidoUsd"], -f["saldoUsd"], f["nombre"]))
    return filas


@router.get("/clientes/{empresa}/{codigo}")
def cliente(empresa: Empresa, codigo: CodigoPath):
    clave = (empresa, codigo)
    with get_connection() as conn, conn.cursor() as cur:
        p = cartera.parametros(cur)
        est = cartera.estado_cliente(cur, empresa, codigo, p=p)
        dato = cartera.datos_clientes(cur, [clave]).get(clave)
        if dato is None and not est.documentos:
            raise HTTPException(404, "Cliente no encontrado")
        lista_pagos = _con_detalle(cur, pagos.listar(cur, 'p."empresa" = %s AND p."codigoCliente" = %s', (empresa, codigo)))
        cur.execute(
            'SELECT c."id", c."email", c."nombre", c."estado", l."origen", l."vinculadoEn" '
            'FROM "CuentaPortalCliente" l JOIN "CuentaPortal" c ON c."id" = l."cuentaId" '
            'WHERE l."empresa" = %s AND l."codigoCliente" = %s ORDER BY l."vinculadoEn"',
            (empresa, codigo),
        )
        cuentas = [_instantes(f, "vinculadoEn") for f in cur.fetchall()]
    return {
        **est.resumen(p),
        "nombre": (dato or {}).get("nombre") or f"Cliente {codigo}",
        "datos": dato,
        "documentos": sorted((d.como_dict(p.hoy) for d in est.documentos), key=lambda d: (d["vence"], d["numero"]), reverse=True),
        "pagos": lista_pagos,
        "cuentasPortal": cuentas,
    }


@router.get("/documentos/{documento_id}")
def documento(documento_id: Annotated[str, Path(max_length=64)]):
    """Una factura o nota de entrega: productos, despacho y ruta, y abonos."""
    with get_connection() as conn, conn.cursor() as cur:
        salida = documento_cobro.detalle(cur, documento_id)
    if salida is None:
        raise HTTPException(404, "Documento no encontrado")
    if salida["despacho"]:
        salida["despacho"] = _instantes(
            salida["despacho"], "fechaCreacion", "llegadaEn", "entregadoEn", "salidaProgramada", "iniciadaEn", "completadaEn"
        )
    return salida


@router.get("/clientes/{empresa}/{codigo}/estado-cuenta")
def estado_cuenta(empresa: Empresa, codigo: CodigoPath, desde: date | None = None, hasta: date | None = None):
    with get_connection() as conn, conn.cursor() as cur:
        return cartera.movimientos(cur, [(empresa, codigo)], desde, hasta)


@router.get("/clientes/{empresa}/{codigo}/estado-cuenta.xlsx")
def estado_cuenta_excel(empresa: Empresa, codigo: CodigoPath, desde: date | None = None, hasta: date | None = None):
    clave = (empresa, codigo)
    with get_connection() as conn, conn.cursor() as cur:
        dato = cartera.datos_clientes(cur, [clave]).get(clave) or {}
        libro = estado_cuenta_libro(cur, [clave], desde, hasta, f"{dato.get('nombre') or codigo} ({empresa} {codigo})")
    return _como_adjunto(libro, f"estado_de_cuenta_{empresa}_{codigo}")


# ---------- Pagos ----------


@router.get("/pagos")
def listar_pagos(
    estado: str = Query("REPORTADO", pattern="^(REPORTADO|VERIFICADO|RECHAZADO|TODOS)$"),
    empresa: Empresa | None = None,
):
    condiciones, params = ["true"], []
    if estado != "TODOS":
        condiciones.append('p."estado" = %s')
        params.append(estado)
    if empresa:
        condiciones.append('p."empresa" = %s')
        params.append(empresa)
    with get_connection() as conn, conn.cursor() as cur:
        return _con_detalle(cur, pagos.listar(cur, " AND ".join(condiciones), tuple(params)))


def _con_detalle(cur, lista: list[dict]) -> list[dict]:
    """Agrega a cada pago lo que hace falta para revisarlo: de cada documento
    que abona, su vencimiento y su saldo de hoy; y si esta por verificar,
    todo lo que el cliente tiene pendiente (para corregir a que se abona)."""
    claves = sorted({(g["empresa"], g["codigoCliente"]) for g in lista})
    p = cartera.parametros(cur)
    estados = cartera.estados(cur, claves, p=p) if claves else {}
    documentos = {d.id: d for est in estados.values() for d in est.documentos}
    salida = []
    for g in lista:
        g = _instantes(g, "reportadoEn", "revisadoEn")
        for a in g["aplicaciones"]:
            doc = documentos.get(a["documentoId"])
            # Fuera de la cartera (anterior al inicio o carga revertida): sin
            # saldo que mostrar; lo abonado cuenta como credito a favor.
            a["vence"] = doc.vence if doc else None
            a["saldoUsd"] = float(doc.saldoUsd) if doc else None
            a["estadoDocumento"] = doc.como_dict(p.hoy)["estado"] if doc else None
        if g["estado"] == "REPORTADO":
            est = estados.get((g["empresa"], g["codigoCliente"]))
            g["pendientes"] = [d.como_dict(p.hoy) for d in est.pendientes()] if est else []
        salida.append(g)
    return salida


def _avisar_cliente(cur, pago: dict, asunto: str, parrafos: list[str]) -> None:
    if not pago.get("cuentaPortalId"):
        return
    cur.execute('SELECT "email", "nombre" FROM "CuentaPortal" WHERE "id" = %s', (pago["cuentaPortalId"],))
    cuenta = cur.fetchone()
    if cuenta:
        correo.enviar_sin_fallar(cuenta["email"], asunto, [f"Hola, {cuenta['nombre']}.", *parrafos])


@router.post("/pagos", status_code=201)
def registrar_pago(data: PagoManualCreate, usuario: dict = Depends(requiere_rol("COBRANZAS"))):
    """Un pago recibido por fuera del portal (efectivo, divisas, retencion,
    ajuste, o un pago movil que el cliente no reporto). Queda verificado."""
    try:
        datos = pagos.normalizar(data.model_dump(), desde_portal=False)
    except ValueError as e:
        raise HTTPException(422, str(e)) from e
    with get_connection() as conn, conn.cursor() as cur:
        try:
            pago_id = pagos.registrar(
                cur, empresa=data.empresa, codigo=data.codigoCliente, datos=datos,
                aplicaciones=[a.model_dump() for a in data.aplicaciones], usuario_id=usuario["id"],
            )
        except ValueError as e:
            raise HTTPException(422, str(e)) from e
        conn.commit()
        return _instantes(pagos.listar(cur, 'p."id" = %s', (pago_id,))[0], "reportadoEn", "revisadoEn")


@router.post("/pagos/{pago_id}/verificar")
def verificar_pago(pago_id: str, data: VerificarPagoRequest, usuario: dict = Depends(requiere_rol("COBRANZAS"))):
    with get_connection() as conn, conn.cursor() as cur:
        try:
            pago = pagos.verificar(
                cur, pago_id, usuario["id"],
                [a.model_dump() for a in data.aplicaciones] if data.aplicaciones is not None else None,
            )
        except ValueError as e:
            raise HTTPException(422, str(e)) from e
        conn.commit()
        _avisar_cliente(cur, pago, f"Pago {pago['numero']} verificado", [
            f"Verificamos tu pago {pago['numero']} del {pago['fechaPago']:%d/%m/%Y} por "
            f"{pago['montoUsd']:,.2f} USD. Ya está abonado a tu cuenta.",
        ])
        return _instantes(pagos.listar(cur, 'p."id" = %s', (pago_id,))[0], "reportadoEn", "revisadoEn")


@router.post("/pagos/{pago_id}/rechazar")
def rechazar_pago(pago_id: str, data: RechazarPagoRequest, usuario: dict = Depends(requiere_rol("COBRANZAS"))):
    motivo = " ".join(data.motivo.split())
    with get_connection() as conn, conn.cursor() as cur:
        pago = pagos.rechazar(cur, pago_id, usuario["id"], motivo)
        conn.commit()
        _avisar_cliente(cur, pago, f"Pago {pago['numero']} no verificado", [
            f"No pudimos verificar tu pago {pago['numero']} del {pago['fechaPago']:%d/%m/%Y}.",
            f"Motivo: {motivo}",
            "Si crees que es un error, reporta el pago de nuevo con los datos correctos o comunícate con cobranzas.",
        ])
        return _instantes(pagos.listar(cur, 'p."id" = %s', (pago_id,))[0], "reportadoEn", "revisadoEn")


@router.get("/pagos/{pago_id}/comprobante")
def comprobante(pago_id: str):
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute('SELECT "comprobanteClave", "comprobanteTipo" FROM "Pago" WHERE "id" = %s', (pago_id,))
        fila = cur.fetchone()
    if not fila or not fila["comprobanteClave"]:
        raise HTTPException(404, "Comprobante no encontrado")
    return servir_comprobante(fila["comprobanteClave"], fila["comprobanteTipo"])


# ---------- Cuentas del portal ----------


@router.get("/cuentas")
def cuentas(estado: str = Query("POR_VALIDAR", pattern="^(POR_VALIDAR|ACTIVA|SUSPENDIDA|PENDIENTE_CORREO|TODAS)$")):
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            'SELECT c."id", c."email", c."nombre", c."rif", c."telefono", c."estado", '
            'c."empresaDeclarada"::text AS "empresaDeclarada", c."codigoDeclarado", c."createdAt", '
            'c."correoVerificadoEn" FROM "CuentaPortal" c '
            + ("" if estado == "TODAS" else 'WHERE c."estado" = %(estado)s ')
            + 'ORDER BY c."createdAt" DESC LIMIT 500',
            {"estado": estado},
        )
        filas = cur.fetchall()
        cur.execute(
            'SELECT "cuentaId", "empresa"::text AS "empresa", "codigoCliente", "origen" FROM "CuentaPortalCliente" '
            'WHERE "cuentaId" = ANY(%s)',
            ([f["id"] for f in filas],),
        )
        vinculos: dict[str, list] = {}
        for v in cur.fetchall():
            vinculos.setdefault(v["cuentaId"], []).append(v)
        claves = sorted({(v["empresa"], v["codigoCliente"]) for lista in vinculos.values() for v in lista}
                        | {(f["empresaDeclarada"], f["codigoDeclarado"]) for f in filas
                           if f["empresaDeclarada"] and f["codigoDeclarado"]})
        datos = cartera.datos_clientes(cur, claves) if claves else {}

    def nombre(e, c):
        return (datos.get((e, c)) or {}).get("nombre")

    return [
        {
            **_instantes(f, "createdAt", "correoVerificadoEn"),
            "nombreDeclarado": nombre(f["empresaDeclarada"], f["codigoDeclarado"]) if f["codigoDeclarado"] else None,
            "clientes": [
                {"empresa": v["empresa"], "codigoCliente": v["codigoCliente"], "origen": v["origen"],
                 "nombre": nombre(v["empresa"], v["codigoCliente"])}
                for v in vinculos.get(f["id"], [])
            ],
        }
        for f in filas
    ]


def _cuenta(cur, cuenta_id: str) -> dict:
    cur.execute('SELECT * FROM "CuentaPortal" WHERE "id" = %s FOR UPDATE', (cuenta_id,))
    cuenta = cur.fetchone()
    if not cuenta:
        raise HTTPException(404, "Cuenta no encontrada")
    return cuenta


@router.post("/cuentas/{cuenta_id}/vincular", status_code=204)
def vincular(cuenta_id: str, data: VincularClienteRequest, usuario: dict = Depends(requiere_rol("COBRANZAS"))):
    """Asocia la cuenta a un cliente (empresa + codigo de ventas). La primera
    vinculacion la activa."""
    with get_connection() as conn, conn.cursor() as cur:
        cuenta = _cuenta(cur, cuenta_id)
        if cuenta["estado"] == "PENDIENTE_CORREO":
            raise HTTPException(409, "La cuenta todavía no confirmó su correo")
        cur.execute(
            'SELECT 1 FROM "VentaCliente" WHERE "empresa" = %(e)s AND "codigo" = %(c)s UNION ALL '
            "SELECT 1 FROM \"Cliente\" WHERE \"empresa\" = %(e)s AND ltrim(\"codigo\", '0') = %(c)s UNION ALL "
            'SELECT 1 FROM "DocumentoCobro" WHERE "empresa" = %(e)s AND "codigoCliente" = %(c)s LIMIT 1',
            {"e": data.empresa, "c": data.codigoCliente},
        )
        if not cur.fetchone():
            raise HTTPException(404, f"No existe el cliente {data.codigoCliente} en {data.empresa}")
        cur.execute(
            'INSERT INTO "CuentaPortalCliente" ("id", "cuentaId", "empresa", "codigoCliente", "origen", '
            '"vinculadoPorId") VALUES (%s, %s, %s, %s, \'COBRANZAS\', %s) '
            'ON CONFLICT ("cuentaId", "empresa", "codigoCliente") DO NOTHING',
            (f"cpc-{uuid.uuid4().hex[:16]}", cuenta_id, data.empresa, data.codigoCliente, usuario["id"]),
        )
        activada = cuenta["estado"] == "POR_VALIDAR"
        if activada:
            cur.execute("UPDATE \"CuentaPortal\" SET \"estado\" = 'ACTIVA' WHERE \"id\" = %s", (cuenta_id,))
        conn.commit()
    if activada:
        correo.enviar_sin_fallar(cuenta["email"], "Tu cuenta del portal está activa", [
            f"Hola, {cuenta['nombre']}.",
            "Validamos tu cuenta: ya puedes ver tu estado de cuenta y reportar tus pagos en el portal de clientes.",
        ])


@router.post("/cuentas/{cuenta_id}/desvincular", status_code=204)
def desvincular(cuenta_id: str, data: VincularClienteRequest):
    with get_connection() as conn, conn.cursor() as cur:
        _cuenta(cur, cuenta_id)
        cur.execute(
            'DELETE FROM "CuentaPortalCliente" WHERE "cuentaId" = %s AND "empresa" = %s AND "codigoCliente" = %s',
            (cuenta_id, data.empresa, data.codigoCliente),
        )
        # Sin clientes vuelve a validacion: no hay nada que mostrarle.
        cur.execute(
            "UPDATE \"CuentaPortal\" SET \"estado\" = 'POR_VALIDAR' WHERE \"id\" = %s AND \"estado\" = 'ACTIVA' "
            'AND NOT EXISTS (SELECT 1 FROM "CuentaPortalCliente" WHERE "cuentaId" = %s)',
            (cuenta_id, cuenta_id),
        )
        conn.commit()


@router.post("/cuentas/{cuenta_id}/suspender", status_code=204)
def suspender(cuenta_id: str):
    with get_connection() as conn, conn.cursor() as cur:
        cuenta = _cuenta(cur, cuenta_id)
        if cuenta["estado"] == "PENDIENTE_CORREO":
            raise HTTPException(409, "La cuenta todavía no confirmó su correo")
        cur.execute("UPDATE \"CuentaPortal\" SET \"estado\" = 'SUSPENDIDA' WHERE \"id\" = %s", (cuenta_id,))
        cerrar_sesiones(cur, cuenta_id)
        conn.commit()


@router.post("/cuentas/{cuenta_id}/reactivar", status_code=204)
def reactivar(cuenta_id: str):
    with get_connection() as conn, conn.cursor() as cur:
        cuenta = _cuenta(cur, cuenta_id)
        if cuenta["estado"] != "SUSPENDIDA":
            raise HTTPException(409, "La cuenta no está suspendida")
        cur.execute(
            'UPDATE "CuentaPortal" SET "estado" = CASE WHEN EXISTS (SELECT 1 FROM "CuentaPortalCliente" '
            "WHERE \"cuentaId\" = %s) THEN 'ACTIVA'::\"EstadoCuentaPortal\" ELSE 'POR_VALIDAR'::\"EstadoCuentaPortal\" END, "
            '"intentosFallidos" = 0, "bloqueadoHasta" = NULL WHERE "id" = %s',
            (cuenta_id, cuenta_id),
        )
        conn.commit()


# ---------- Ajustes ----------


@router.get("/ajustes")
def ajustes():
    with get_connection() as conn, conn.cursor() as cur:
        p = cartera.parametros(cur)
        return {
            "diasTolerancia": p.tolerancia,
            "inicioCartera": p.inicio,
            "bloqueoActivo": p.bloqueo_activo,
            "ajustes": [
                {**a, "actualizadoEn": en_utc(a["actualizadoEn"]) if a["actualizadoEn"] else None}
                for a in configuracion.todos(cur, "cobranzas")
            ],
            "inicioCarteraInfo": configuracion.FECHAS["cobranzaInicioCartera"],
        }


@router.put("/ajustes")
def guardar_ajustes(data: AjustesCobranzaUpdate, usuario: dict = Depends(requiere_rol("ADMIN"))):
    with get_connection() as conn, conn.cursor() as cur:
        try:
            if data.diasTolerancia is not None:
                configuracion.guardar(cur, "cobranzaDiasTolerancia", float(data.diasTolerancia), usuario["id"])
            if data.inicioCartera is not None:
                if data.inicioCartera > hoy_caracas():
                    raise ValueError("El inicio de la cartera no puede ser una fecha futura")
                configuracion.guardar_fecha(cur, "cobranzaInicioCartera", data.inicioCartera, usuario["id"])
        except ValueError as e:
            raise HTTPException(422, str(e)) from e
        conn.commit()
    return ajustes()


# ---------- Tasa BCV ----------


@router.get("/tasas")
def tasas():
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            'SELECT t."fecha", t."tasa", t."fuente", t."registradoEn", u."nombre" AS "registradoPor" '
            'FROM "TasaCambio" t LEFT JOIN "Usuario" u ON u."id" = t."registradoPorId" '
            'ORDER BY t."fecha" DESC LIMIT 30'
        )
        return [{**_instantes(f, "registradoEn"), "tasa": float(f["tasa"])} for f in cur.fetchall()]


@router.put("/tasas")
def guardar_tasa(data: TasaManualRequest, usuario: dict = Depends(requiere_rol("COBRANZAS"))):
    """Carga manual (si DolarApi no responde o no coincide con el BCV). Una
    tasa manual no la pisa la actualizacion automatica."""
    with get_connection() as conn, conn.cursor() as cur:
        try:
            tasa_bcv.guardar_manual(cur, data.fecha, Decimal(str(data.tasa)), usuario["id"])
        except ValueError as e:
            raise HTTPException(422, str(e)) from e
        conn.commit()
    return tasas()


@router.post("/tasas/actualizar")
def actualizar_tasas():
    with get_connection() as conn, conn.cursor() as cur:
        try:
            cambios = tasa_bcv.actualizar(cur)
        except tasa_bcv.TasaNoDisponible as e:
            raise HTTPException(503, str(e)) from e
        conn.commit()
    return {"actualizadas": cambios, "tasas": tasas()}


# ---------- Cuentas de la empresa (donde pagan los clientes) ----------


def _cuenta_empresa_valida(data: CuentaBancariaEmpresaIn) -> dict:
    try:
        banco = bancos.validar_banco(data.bancoCodigo)
        if data.tipo == "TRANSFERENCIA":
            numero = bancos.normalizar_cuenta(data.numero)
            if numero[:4] != banco:
                raise ValueError("La cuenta no es del banco elegido")
        else:
            numero = validar_telefono(data.numero)
        rif = bancos.normalizar_cedula_rif(data.rif)
    except ValueError as e:
        raise HTTPException(422, str(e)) from e
    return {"empresa": data.empresa, "bancoCodigo": banco, "tipo": data.tipo, "numero": numero, "rif": rif,
            "titular": " ".join(data.titular.split()), "activa": data.activa}


@router.get("/cuentas-empresa")
def cuentas_empresa():
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            'SELECT "id", "empresa"::text AS "empresa", "bancoCodigo", "tipo", "numero", "rif", "titular", "activa" '
            'FROM "CuentaBancariaEmpresa" ORDER BY "empresa", "tipo", "creadaEn"'
        )
        return [{**f, "banco": bancos.nombre(f["bancoCodigo"])} for f in cur.fetchall()]


@router.post("/cuentas-empresa", status_code=201, dependencies=[Depends(requiere_rol("ADMIN"))])
def crear_cuenta_empresa(data: CuentaBancariaEmpresaIn):
    valores = _cuenta_empresa_valida(data)
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            'INSERT INTO "CuentaBancariaEmpresa" ("id", "empresa", "bancoCodigo", "tipo", "numero", "rif", "titular", "activa") '
            "VALUES (%(id)s, %(empresa)s, %(bancoCodigo)s, %(tipo)s, %(numero)s, %(rif)s, %(titular)s, %(activa)s)",
            {**valores, "id": f"cbe-{uuid.uuid4().hex[:12]}"},
        )
        conn.commit()
    return cuentas_empresa()


@router.put("/cuentas-empresa/{cuenta_id}", dependencies=[Depends(requiere_rol("ADMIN"))])
def editar_cuenta_empresa(cuenta_id: str, data: CuentaBancariaEmpresaIn):
    valores = _cuenta_empresa_valida(data)
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            'UPDATE "CuentaBancariaEmpresa" SET "empresa" = %(empresa)s, "bancoCodigo" = %(bancoCodigo)s, '
            '"tipo" = %(tipo)s, "numero" = %(numero)s, "rif" = %(rif)s, "titular" = %(titular)s, '
            '"activa" = %(activa)s WHERE "id" = %(id)s',
            {**valores, "id": cuenta_id},
        )
        if cur.rowcount == 0:
            raise HTTPException(404, "Cuenta no encontrada")
        conn.commit()
    return cuentas_empresa()


@router.delete("/cuentas-empresa/{cuenta_id}", status_code=204, dependencies=[Depends(requiere_rol("ADMIN"))])
def borrar_cuenta_empresa(cuenta_id: str):
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute('DELETE FROM "CuentaBancariaEmpresa" WHERE "id" = %s', (cuenta_id,))
        conn.commit()


# ---------- Tareas programadas ----------

tareas_router = APIRouter(prefix="/tareas", tags=["tareas"])


@tareas_router.get("/tasa-bcv")
def tarea_tasa_bcv(authorization: str | None = Header(default=None)):
    """La llama el cron de Vercel una vez al dia (vercel.json) con
    "Authorization: Bearer <CRON_SECRET>"."""
    secreto = os.getenv("CRON_SECRET")
    if not secreto:
        raise HTTPException(503, "CRON_SECRET no esta configurado")
    if not authorization or not hmac.compare_digest(authorization.encode(), f"Bearer {secreto}".encode()):
        raise HTTPException(401, "No autorizado")
    with get_connection() as conn, conn.cursor() as cur:
        try:
            cambios = tasa_bcv.actualizar(cur)
        except tasa_bcv.TasaNoDisponible as e:
            raise HTTPException(503, str(e)) from e
        conn.commit()
    return {"actualizadas": cambios}
