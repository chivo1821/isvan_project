"""Pagos de clientes: los que reportan desde el portal (pago movil o
transferencia, quedan REPORTADOS hasta que cobranzas los verifica) y los que
registra cobranzas a mano (efectivo, divisas, retenciones, ajustes; quedan
VERIFICADOS de una vez).

La deuda esta en USD. Un pago en Bs se convierte con la tasa BCV vigente en
la fecha del pago (app/services/tasa_bcv.py); el monto en USD lo calcula
siempre el servidor.
"""

from __future__ import annotations

import re
import uuid
from datetime import date
from decimal import Decimal

import psycopg
from fastapi import HTTPException

from app.core.fechas import ahora_utc, hoy_caracas
from app.core.numero import siguiente_numero
from app.services import bancos, cartera, tasa_bcv
from app.services.cartera import CENTAVO, CERO, redondear
from app.services.motorizados import validar_telefono

METODOS_PORTAL = ("PAGO_MOVIL", "TRANSFERENCIA")
METODOS = ("PAGO_MOVIL", "TRANSFERENCIA", "EFECTIVO", "DIVISAS", "RETENCION", "AJUSTE")
METODO_ETIQUETA = {
    "PAGO_MOVIL": "Pago móvil",
    "TRANSFERENCIA": "Transferencia",
    "EFECTIVO": "Efectivo (Bs)",
    "DIVISAS": "Divisas",
    "RETENCION": "Retención",
    "AJUSTE": "Ajuste",
}

_REFERENCIA = re.compile(r"[A-Za-z0-9]{4,30}")
MONTO_MAXIMO = Decimal("10000000000")


def _referencia(valor: str | None, obligatoria: bool) -> str | None:
    limpio = re.sub(r"[\s\-]", "", valor or "")
    if not limpio:
        if obligatoria:
            raise ValueError("Falta el número de referencia del pago")
        return None
    if not _REFERENCIA.fullmatch(limpio):
        raise ValueError("La referencia debe tener entre 4 y 30 letras o números")
    return limpio.upper()


def _monto(valor, nombre: str) -> Decimal | None:
    if valor is None:
        return None
    monto = redondear(Decimal(str(valor)))
    if monto <= CERO or monto > MONTO_MAXIMO:
        raise ValueError(f"El monto en {nombre} debe ser mayor que cero")
    return monto


def normalizar(datos: dict, *, desde_portal: bool) -> dict:
    """Valida y normaliza los datos de un pago segun su metodo. Lanza
    ValueError con un mensaje para el usuario."""
    metodo = datos.get("metodo")
    if metodo not in (METODOS_PORTAL if desde_portal else METODOS):
        raise ValueError("Método de pago no válido")
    fecha: date = datos["fechaPago"]
    if fecha > hoy_caracas():
        raise ValueError("La fecha del pago no puede ser futura")
    if fecha < date(2020, 1, 1):
        raise ValueError("La fecha del pago no es válida")

    salida = {
        "metodo": metodo, "fechaPago": fecha, "bancoCodigo": None, "telefono": None, "cedulaRif": None,
        "cuenta": None, "referencia": None, "montoBs": _monto(datos.get("montoBs"), "Bs"),
        "montoUsd": _monto(datos.get("montoUsd"), "USD"), "nota": (datos.get("nota") or "").strip()[:500] or None,
    }
    if metodo == "PAGO_MOVIL":
        salida["bancoCodigo"] = bancos.validar_banco(datos.get("bancoCodigo") or "")
        salida["telefono"] = validar_telefono(datos.get("telefono") or "")
        salida["cedulaRif"] = bancos.normalizar_cedula_rif(datos.get("cedulaRif") or "")
        salida["referencia"] = _referencia(datos.get("referencia"), True)
    elif metodo == "TRANSFERENCIA":
        salida["cuenta"] = bancos.normalizar_cuenta(datos.get("cuenta") or "")
        salida["bancoCodigo"] = salida["cuenta"][:4]
        salida["cedulaRif"] = bancos.normalizar_cedula_rif(datos.get("cedulaRif") or "")
        salida["referencia"] = _referencia(datos.get("referencia"), True)
    else:
        salida["referencia"] = _referencia(datos.get("referencia"), False)
        if datos.get("bancoCodigo"):
            salida["bancoCodigo"] = bancos.validar_banco(datos["bancoCodigo"])

    if metodo in METODOS_PORTAL:
        if salida["montoBs"] is None:
            raise ValueError("Indica el monto pagado en bolívares")
        salida["montoUsd"] = None  # lo calcula el servidor con la tasa
    elif metodo in ("DIVISAS", "AJUSTE"):
        if salida["montoUsd"] is None:
            raise ValueError("Indica el monto en dólares")
        salida["montoBs"] = None
    elif (salida["montoBs"] is None) == (salida["montoUsd"] is None):
        raise ValueError("Indica el monto en bolívares o en dólares (uno solo)")
    if metodo == "AJUSTE" and not salida["nota"]:
        raise ValueError("Un ajuste necesita una nota que explique el motivo")
    return salida


def _aplicaciones_validas(cur, empresa: str, codigo: str, aplicaciones: list[dict], monto_usd: Decimal) -> list[tuple[str, Decimal]]:
    """[(documentoId, montoUsd)] verificados contra la cartera del cliente:
    cada documento suyo, por cobrar, y sin abonarle mas de su saldo."""
    if not aplicaciones:
        return []
    por_doc: dict[str, Decimal] = {}
    for a in aplicaciones:
        monto = _monto(a.get("montoUsd"), "USD")
        if a.get("documentoId") in por_doc:
            raise ValueError("Un documento aparece dos veces")
        por_doc[a["documentoId"]] = monto
    if sum(por_doc.values(), CERO) > monto_usd + CENTAVO:
        raise ValueError("Lo abonado a los documentos supera el monto del pago")
    estado = cartera.estado_cliente(cur, empresa, codigo)
    saldos = {d.id: d.saldoUsd for d in estado.documentos}
    for doc_id, monto in por_doc.items():
        if doc_id not in saldos:
            raise ValueError("Uno de los documentos no es de este cliente o no está por cobrar")
        if monto > saldos[doc_id] + CENTAVO:
            raise ValueError("A un documento se le abona más que su saldo pendiente")
    return list(por_doc.items())


def registrar(cur, *, empresa: str, codigo: str, datos: dict, aplicaciones: list[dict],
              cuenta_portal_id: str | None = None, usuario_id: str | None = None,
              comprobante: tuple[str, str] | None = None) -> str:
    """Guarda un pago y devuelve su id. Desde el portal queda REPORTADO; si
    lo registra cobranzas (usuario_id), VERIFICADO.

    `datos` ya pasado por normalizar(). Llamar antes de escribir nada mas en
    la transaccion: la busqueda de la tasa puede hacer commit."""
    tasa = None
    monto_usd = datos["montoUsd"]
    if datos["montoBs"] is not None:
        try:
            vigente = tasa_bcv.tasa_para(cur, datos["fechaPago"])
        except tasa_bcv.TasaNoDisponible as e:
            raise HTTPException(503, f"{e}. Intenta más tarde.") from e
        tasa = Decimal(vigente["tasa"])
        monto_usd = redondear(datos["montoBs"] / tasa)
        if monto_usd <= CERO:
            raise ValueError("El monto es muy pequeño")

    lista = _aplicaciones_validas(cur, empresa, codigo, aplicaciones, monto_usd)

    # Numeracion correlativa sin choques entre dos reportes simultaneos.
    cur.execute("SELECT pg_advisory_xact_lock(hashtext('Pago.numero'))")
    numero = siguiente_numero(cur, "Pago", "P", 6)
    pago_id = f"pago-{uuid.uuid4().hex[:16]}"
    verificado = usuario_id is not None
    ahora = ahora_utc()
    cur.execute("SAVEPOINT pago_nuevo")
    try:
        _insertar(cur, pago_id, numero, empresa, codigo, cuenta_portal_id, usuario_id, datos, tasa, monto_usd,
                  comprobante, verificado, ahora)
    except psycopg.errors.UniqueViolation as e:
        cur.execute("ROLLBACK TO SAVEPOINT pago_nuevo")
        raise HTTPException(409, "Ese pago ya fue reportado (mismo banco, referencia y fecha)") from e
    _guardar_aplicaciones(cur, pago_id, lista)
    return pago_id


def _insertar(cur, pago_id, numero, empresa, codigo, cuenta_portal_id, usuario_id, datos, tasa, monto_usd,
              comprobante, verificado, ahora) -> None:
    cur.execute(
        'INSERT INTO "Pago" ("id", "numero", "empresa", "codigoCliente", "cuentaPortalId", "registradoPorId", '
        '"metodo", "bancoCodigo", "telefono", "cedulaRif", "cuenta", "referencia", "fechaPago", "montoBs", "tasa", '
        '"montoUsd", "comprobanteClave", "comprobanteTipo", "nota", "estado", "reportadoEn", "revisadoPorId", '
        '"revisadoEn", "metodoVerificacion") '
        "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
        (
            pago_id, numero, empresa, codigo, cuenta_portal_id, usuario_id, datos["metodo"], datos["bancoCodigo"],
            datos["telefono"], datos["cedulaRif"], datos["cuenta"], datos["referencia"], datos["fechaPago"],
            datos["montoBs"], tasa, monto_usd, comprobante[0] if comprobante else None,
            comprobante[1] if comprobante else None, datos["nota"],
            "VERIFICADO" if verificado else "REPORTADO", ahora,
            usuario_id if verificado else None, ahora if verificado else None, "MANUAL" if verificado else None,
        ),
    )


def _guardar_aplicaciones(cur, pago_id: str, lista: list[tuple[str, Decimal]]) -> None:
    cur.execute('DELETE FROM "PagoAplicacion" WHERE "pagoId" = %s', (pago_id,))
    cur.executemany(
        'INSERT INTO "PagoAplicacion" ("id", "pagoId", "documentoId", "montoUsd") VALUES (%s, %s, %s, %s)',
        [(f"papl-{uuid.uuid4().hex[:16]}", pago_id, doc_id, monto) for doc_id, monto in lista],
    )


def _para_revisar(cur, pago_id: str) -> dict:
    cur.execute('SELECT * FROM "Pago" WHERE "id" = %s FOR UPDATE', (pago_id,))
    pago = cur.fetchone()
    if not pago:
        raise HTTPException(404, "Pago no encontrado")
    if pago["estado"] != "REPORTADO":
        raise HTTPException(409, "Este pago ya fue revisado")
    return pago


def verificar(cur, pago_id: str, usuario_id: str, aplicaciones: list[dict] | None) -> dict:
    """Cobranzas confirma que el dinero llego. Puede corregir a que
    documentos se abona; si no manda aplicaciones, quedan las del cliente."""
    pago = _para_revisar(cur, pago_id)
    if aplicaciones is not None:
        lista = _aplicaciones_validas(cur, pago["empresa"], pago["codigoCliente"], aplicaciones, Decimal(pago["montoUsd"]))
        _guardar_aplicaciones(cur, pago_id, lista)
    else:
        # Las del cliente pueden haber quedado de mas si otro pago ya saldo
        # esos documentos: se validan igual.
        cur.execute('SELECT "documentoId", "montoUsd" FROM "PagoAplicacion" WHERE "pagoId" = %s', (pago_id,))
        _aplicaciones_validas(cur, pago["empresa"], pago["codigoCliente"], cur.fetchall(), Decimal(pago["montoUsd"]))
    cur.execute(
        "UPDATE \"Pago\" SET \"estado\" = 'VERIFICADO', \"revisadoPorId\" = %s, \"revisadoEn\" = %s, "
        "\"metodoVerificacion\" = 'MANUAL' WHERE \"id\" = %s",
        (usuario_id, ahora_utc(), pago_id),
    )
    return pago


def rechazar(cur, pago_id: str, usuario_id: str, motivo: str) -> dict:
    pago = _para_revisar(cur, pago_id)
    cur.execute(
        "UPDATE \"Pago\" SET \"estado\" = 'RECHAZADO', \"revisadoPorId\" = %s, \"revisadoEn\" = %s, "
        '"motivoRechazo" = %s WHERE "id" = %s',
        (usuario_id, ahora_utc(), motivo, pago_id),
    )
    return pago


_SELECT_PAGO = (
    'SELECT p."id", p."numero", p."empresa"::text AS "empresa", p."codigoCliente", p."metodo", p."bancoCodigo", '
    'p."telefono", p."cedulaRif", p."cuenta", p."referencia", p."fechaPago", p."montoBs", p."tasa", p."montoUsd", '
    'p."comprobanteClave" IS NOT NULL AS "tieneComprobante", p."comprobanteTipo", p."nota", p."estado", '
    'p."reportadoEn", p."revisadoEn", p."motivoRechazo", p."cuentaPortalId", '
    'r."nombre" AS "revisadoPor", g."nombre" AS "registradoPor", cp."nombre" AS "reportadoPor", cp."email" AS "reportadoPorEmail", '
    'COALESCE(vc."nombre", c."nombre") AS "cliente" '
    'FROM "Pago" p LEFT JOIN "Usuario" r ON r."id" = p."revisadoPorId" '
    'LEFT JOIN "Usuario" g ON g."id" = p."registradoPorId" '
    'LEFT JOIN "CuentaPortal" cp ON cp."id" = p."cuentaPortalId" '
    'LEFT JOIN "VentaCliente" vc ON vc."empresa" = p."empresa" AND vc."codigo" = p."codigoCliente" '
    'LEFT JOIN LATERAL (SELECT "nombre" FROM "Cliente" WHERE "empresa" = p."empresa" '
    '  AND ltrim("codigo", \'0\') = p."codigoCliente" LIMIT 1) c ON true '
)


def listar(cur, where: str, params: dict | tuple = ()) -> list[dict]:
    """Pagos con sus aplicaciones, para las pantallas."""
    cur.execute(f"{_SELECT_PAGO} WHERE {where} ORDER BY p.\"reportadoEn\" DESC LIMIT 500", params)
    filas = cur.fetchall()
    if not filas:
        return []
    cur.execute(
        'SELECT a."pagoId", a."documentoId", a."montoUsd", d."tipoDoc", d."numero", d."fecha", '
        'd."montoUsd" AS "montoDocumentoUsd", d."vigente" '
        'FROM "PagoAplicacion" a JOIN "DocumentoCobro" d ON d."id" = a."documentoId" '
        'WHERE a."pagoId" = ANY(%s) ORDER BY d."fecha", d."numero"',
        ([f["id"] for f in filas],),
    )
    por_pago: dict[str, list] = {}
    for a in cur.fetchall():
        por_pago.setdefault(a["pagoId"], []).append(
            {"documentoId": a["documentoId"], "tipoDoc": a["tipoDoc"], "numero": a["numero"],
             "fecha": a["fecha"], "montoUsd": float(a["montoUsd"]),
             "montoDocumentoUsd": float(a["montoDocumentoUsd"]), "vigente": a["vigente"]}
        )
    return [
        {
            **f,
            "banco": bancos.nombre(f["bancoCodigo"]),
            "montoBs": float(f["montoBs"]) if f["montoBs"] is not None else None,
            "tasa": float(f["tasa"]) if f["tasa"] is not None else None,
            "montoUsd": float(f["montoUsd"]),
            "aplicaciones": por_pago.get(f["id"], []),
        }
        for f in filas
    ]
