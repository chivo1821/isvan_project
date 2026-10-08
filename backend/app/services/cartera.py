"""Cartera de clientes: saldos, vencimientos y bloqueo para despacho.

Las reglas viven solo aca (portal, cobranzas y aprobacion de despachos las
consultan):

- Cargos: las FA y NE vigentes (DocumentoCobro), desde la fecha de inicio de
  la cartera si esta definida (lo anterior se da por saldado).
- Abonos: las DV y DN (montos negativos) y los pagos VERIFICADOS. Un pago
  reportado y todavia no verificado no descuenta nada.
- Un pago abona primero a los documentos que se le aplicaron. Lo que sobra
  de cada pago, mas las DV/DN, es credito a favor que se reparte FIFO: a los
  documentos que vencen antes.
- Un documento vence en su `vencimiento` si el origen lo trae (CxC) o, si no,
  a los `cobranzaDiasTolerancia` dias de su fecha. Vencido = vence antes de
  hoy (Caracas) y tiene saldo.
- Bloqueado para despacho = tiene algun documento vencido. Sin fecha de
  inicio de cartera no se bloquea a nadie (asi un despliegue no deja a todos
  los clientes sin despacho de golpe).

Los clientes se identifican por (empresa, codigo del sistema de ventas): el
mismo codigo que usa Cliente (logistica) y el extracto de ventas.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal

from app.core.fechas import hoy_caracas
from app.services import configuracion

CENTAVO = Decimal("0.01")
CERO = Decimal("0")
TIPOS_CARGO = ("FA", "NE")
TIPOS_CREDITO = ("DV", "DN")

Clave = tuple[str, str]  # (empresa, codigoCliente)


def redondear(valor: Decimal) -> Decimal:
    return valor.quantize(CENTAVO, rounding=ROUND_HALF_UP)


# ---------- Sincronizacion con el extracto de ventas ----------

_DOCUMENTOS_DE_VENTAS = (
    'SELECT v."empresa", v."codTipoDoc" AS "tipoDoc", v."numDoc" AS "numero", '
    'min(v."codigoCliente") AS "codigoCliente", min(v."fecha") AS "fecha", '
    'round(sum(v."montoUsd"), 2) AS "montoUsd", round(sum(v."montoBs"), 2) AS "montoBs" '
    'FROM "Venta" v JOIN "VentaCarga" c ON c."id" = v."cargaId" '
    "WHERE c.\"estado\" = 'CONFIRMADA' AND v.\"reemplazadaPorCargaId\" IS NULL AND v.\"empresa\" = %(empresa)s "
    'GROUP BY v."empresa", v."codTipoDoc", v."numDoc"'
)


def sincronizar_documentos(cur, empresa: str) -> None:
    """Pone la cartera de una empresa al dia con sus ventas confirmadas. Se
    llama dentro de la transaccion que confirma o revierte una carga.

    Los documentos que ya no estan (se revirtio su carga) quedan como no
    vigentes en vez de borrarse: puede haber pagos que los referencian."""
    cur.execute(
        'INSERT INTO "DocumentoCobro" ("id", "empresa", "tipoDoc", "numero", "codigoCliente", "fecha", '
        '"montoUsd", "montoBs", "origen", "vigente", "actualizadoEn") '
        "SELECT 'doc-' || substr(md5(d.\"empresa\"::text || d.\"tipoDoc\" || d.\"numero\"), 1, 16), "
        'd."empresa", d."tipoDoc", d."numero", d."codigoCliente", d."fecha", d."montoUsd", d."montoBs", '
        "'EXTRACTO_VENTAS', true, now() AT TIME ZONE 'UTC' "
        f"FROM ({_DOCUMENTOS_DE_VENTAS}) d "
        'ON CONFLICT ("empresa", "tipoDoc", "numero") DO UPDATE SET '
        '"codigoCliente" = EXCLUDED."codigoCliente", "fecha" = EXCLUDED."fecha", '
        '"montoUsd" = EXCLUDED."montoUsd", "montoBs" = EXCLUDED."montoBs", "vigente" = true, '
        '"actualizadoEn" = EXCLUDED."actualizadoEn" '
        # Un documento que vino de otro origen (CxC, manual) manda sobre el extracto.
        "WHERE \"DocumentoCobro\".\"origen\" = 'EXTRACTO_VENTAS' AND ("
        '"DocumentoCobro"."montoUsd" <> EXCLUDED."montoUsd" OR "DocumentoCobro"."montoBs" <> EXCLUDED."montoBs" '
        'OR "DocumentoCobro"."fecha" <> EXCLUDED."fecha" OR "DocumentoCobro"."codigoCliente" <> EXCLUDED."codigoCliente" '
        'OR NOT "DocumentoCobro"."vigente")',
        {"empresa": empresa},
    )
    cur.execute(
        "UPDATE \"DocumentoCobro\" d SET \"vigente\" = false, \"actualizadoEn\" = now() AT TIME ZONE 'UTC' "
        "WHERE d.\"empresa\" = %(empresa)s AND d.\"origen\" = 'EXTRACTO_VENTAS' AND d.\"vigente\" "
        f'AND (d."tipoDoc", d."numero") NOT IN (SELECT a."tipoDoc", a."numero" FROM ({_DOCUMENTOS_DE_VENTAS}) a)',
        {"empresa": empresa},
    )


# ---------- Parametros ----------


@dataclass(frozen=True)
class Parametros:
    inicio: date | None
    tolerancia: int
    hoy: date

    @property
    def bloqueo_activo(self) -> bool:
        return self.inicio is not None


def parametros(cur) -> Parametros:
    return Parametros(
        inicio=configuracion.leer_fecha(cur, "cobranzaInicioCartera"),
        tolerancia=int(configuracion.leer(cur, "cobranzaDiasTolerancia")),
        hoy=hoy_caracas(),
    )


# ---------- Calculo ----------


@dataclass
class DocumentoSaldo:
    id: str
    empresa: str
    codigoCliente: str
    tipoDoc: str
    numero: str
    fecha: date
    vence: date
    montoUsd: Decimal
    montoBs: Decimal
    aplicadoUsd: Decimal = CERO  # pagos aplicados a este documento
    creditoUsd: Decimal = CERO  # credito a favor repartido FIFO
    saldoUsd: Decimal = CERO

    def vencido(self, hoy: date) -> bool:
        return self.saldoUsd > CERO and self.vence < hoy

    def dias_atraso(self, hoy: date) -> int:
        return (hoy - self.vence).days if self.vencido(hoy) else 0

    def como_dict(self, hoy: date) -> dict:
        estado = "PAGADO" if self.saldoUsd <= CERO else ("VENCIDO" if self.vencido(hoy) else "PENDIENTE")
        return {
            "id": self.id, "empresa": self.empresa, "codigoCliente": self.codigoCliente,
            "tipoDoc": self.tipoDoc, "numero": self.numero, "fecha": self.fecha, "vence": self.vence,
            "montoUsd": float(self.montoUsd), "montoBs": float(self.montoBs),
            "abonadoUsd": float(self.montoUsd - self.saldoUsd), "saldoUsd": float(self.saldoUsd),
            "estado": estado, "diasAtraso": self.dias_atraso(hoy),
        }


@dataclass
class EstadoCliente:
    empresa: str
    codigoCliente: str
    documentos: list[DocumentoSaldo] = field(default_factory=list)
    aFavorUsd: Decimal = CERO

    def pendientes(self) -> list[DocumentoSaldo]:
        return [d for d in self.documentos if d.saldoUsd > CERO]

    def saldo_usd(self) -> Decimal:
        return sum((d.saldoUsd for d in self.documentos), CERO) - self.aFavorUsd

    def vencido_usd(self, hoy: date) -> Decimal:
        return sum((d.saldoUsd for d in self.documentos if d.vencido(hoy)), CERO)

    def dias_atraso(self, hoy: date) -> int:
        return max((d.dias_atraso(hoy) for d in self.documentos), default=0)

    def bloqueado(self, p: Parametros) -> bool:
        return p.bloqueo_activo and self.vencido_usd(p.hoy) > CERO

    def resumen(self, p: Parametros) -> dict:
        pendientes = self.pendientes()
        return {
            "empresa": self.empresa,
            "codigoCliente": self.codigoCliente,
            "saldoUsd": float(self.saldo_usd()),
            "vencidoUsd": float(self.vencido_usd(p.hoy)),
            "aFavorUsd": float(self.aFavorUsd),
            "documentosPendientes": len(pendientes),
            "documentosVencidos": sum(1 for d in pendientes if d.vencido(p.hoy)),
            "diasAtraso": self.dias_atraso(p.hoy),
            "proximoVencimiento": min((d.vence for d in pendientes if not d.vencido(p.hoy)), default=None),
            "bloqueado": self.bloqueado(p),
        }


def calcular(documentos: list[dict], pagos: list[dict], aplicaciones: list[dict], p: Parametros) -> dict[Clave, EstadoCliente]:
    """El corazon de la cartera, sin base de datos (para poder probarlo).

    documentos: filas de DocumentoCobro (vigentes). pagos: los VERIFICADOS.
    aplicaciones: las de esos pagos."""
    estados: dict[Clave, EstadoCliente] = {}

    def estado(clave: Clave) -> EstadoCliente:
        if clave not in estados:
            estados[clave] = EstadoCliente(*clave)
        return estados[clave]

    credito: dict[Clave, Decimal] = defaultdict(lambda: CERO)
    cargos: dict[str, DocumentoSaldo] = {}
    for d in documentos:
        if p.inicio is not None and d["fecha"] < p.inicio:
            continue
        clave = (d["empresa"], d["codigoCliente"])
        monto = Decimal(d["montoUsd"])
        if d["tipoDoc"] in TIPOS_CARGO and monto > CERO:
            doc = DocumentoSaldo(
                id=d["id"], empresa=d["empresa"], codigoCliente=d["codigoCliente"], tipoDoc=d["tipoDoc"],
                numero=d["numero"], fecha=d["fecha"],
                vence=d.get("vencimiento") or d["fecha"] + timedelta(days=p.tolerancia),
                montoUsd=monto, montoBs=Decimal(d["montoBs"]),
            )
            cargos[doc.id] = doc
            estado(clave).documentos.append(doc)
        elif d["tipoDoc"] in TIPOS_CREDITO and monto < CERO:
            credito[clave] += -monto
            estado(clave)

    aplicado_por_pago: dict[str, Decimal] = defaultdict(lambda: CERO)
    for a in aplicaciones:
        doc = cargos.get(a["documentoId"])
        if doc is None:
            continue  # documento fuera de la cartera: lo aplicado queda como credito
        monto = Decimal(a["montoUsd"])
        doc.aplicadoUsd += monto
        aplicado_por_pago[a["pagoId"]] += monto

    for pago in pagos:
        clave = (pago["empresa"], pago["codigoCliente"])
        credito[clave] += Decimal(pago["montoUsd"]) - aplicado_por_pago[pago["id"]]
        estado(clave)

    for clave, est in estados.items():
        libre = credito[clave]
        for doc in est.documentos:
            doc.saldoUsd = doc.montoUsd - doc.aplicadoUsd
            if doc.saldoUsd < CERO:  # se le aplico de mas: el excedente es credito
                libre += -doc.saldoUsd
                doc.saldoUsd = CERO
        est.documentos.sort(key=lambda d: (d.vence, d.fecha, d.numero))
        for doc in est.documentos:
            if libre <= CERO:
                break
            usado = min(libre, doc.saldoUsd)
            doc.creditoUsd = usado
            doc.saldoUsd -= usado
            libre -= usado
        for doc in est.documentos:
            # Restos de centavos por redondeos de los pagos no cuentan como deuda.
            if doc.saldoUsd < CENTAVO:
                doc.saldoUsd = CERO
        est.aFavorUsd = libre if libre >= CENTAVO else CERO
    return estados


# ---------- Consultas ----------


def _filtro(claves: list[Clave] | None, empresa: str | None, alias: str = "") -> tuple[str, dict]:
    pre = f"{alias}." if alias else ""
    if claves is not None:
        if not claves:
            return "false", {}
        return (
            f'({pre}"empresa"::text, {pre}"codigoCliente") IN (SELECT * FROM unnest(%(empresas)s::text[], %(codigos)s::text[]))',
            {"empresas": [c[0] for c in claves], "codigos": [c[1] for c in claves]},
        )
    if empresa:
        return f'{pre}"empresa" = %(empresa)s', {"empresa": empresa}
    return "true", {}


def _cargar(cur, claves: list[Clave] | None, empresa: str | None) -> tuple[list, list, list]:
    filtro, params = _filtro(claves, empresa)
    cur.execute(
        'SELECT "id", "empresa"::text AS "empresa", "codigoCliente", "tipoDoc", "numero", "fecha", "vencimiento", '
        f'"montoUsd", "montoBs" FROM "DocumentoCobro" WHERE "vigente" AND {filtro}',
        params,
    )
    documentos = cur.fetchall()
    cur.execute(
        'SELECT "id", "empresa"::text AS "empresa", "codigoCliente", "montoUsd" FROM "Pago" '
        f"WHERE \"estado\" = 'VERIFICADO' AND {filtro}",
        params,
    )
    pagos = cur.fetchall()
    filtro_a, params_a = _filtro(claves, empresa, "p")
    cur.execute(
        'SELECT a."pagoId", a."documentoId", a."montoUsd" FROM "PagoAplicacion" a JOIN "Pago" p ON p."id" = a."pagoId" '
        f"WHERE p.\"estado\" = 'VERIFICADO' AND {filtro_a}",
        params_a,
    )
    return documentos, pagos, cur.fetchall()


def datos_clientes(cur, claves: list[Clave] | None = None, empresa: str | None = None) -> dict[Clave, dict]:
    """Nombre, ruta y contacto de los clientes. El nombre y la ruta salen del
    sistema de ventas (VentaCliente); si no esta ahi, del maestro de
    logistica (Cliente, con el codigo sin ceros a la izquierda)."""
    filtro_v, params = _filtro(claves, empresa, "")
    filtro_v = filtro_v.replace('"codigoCliente"', '"codigo"')
    cur.execute(
        'SELECT "empresa"::text AS "empresa", "codigo", "nombre", "ruta", "tipo" FROM "VentaCliente" '
        f"WHERE {filtro_v}",
        params,
    )
    salida: dict[Clave, dict] = {
        (f["empresa"], f["codigo"]): {"nombre": f["nombre"], "ruta": f["ruta"], "tipo": f["tipo"],
                                      "telefono": None, "email": None, "ciudad": None}
        for f in cur.fetchall()
    }
    filtro_c = filtro_v.replace('"codigo"', "ltrim(\"codigo\", '0')")
    cur.execute(
        "SELECT \"empresa\"::text AS \"empresa\", ltrim(\"codigo\", '0') AS \"codigo\", \"nombre\", \"telefono\", "
        f'"email", "ciudad", "rutaComercial" FROM "Cliente" WHERE {filtro_c}',
        params,
    )
    for f in cur.fetchall():
        dato = salida.setdefault(
            (f["empresa"], f["codigo"]),
            {"nombre": f["nombre"], "ruta": f["rutaComercial"], "tipo": None},
        )
        dato.update({"telefono": f["telefono"], "email": f["email"], "ciudad": f["ciudad"]})
    return salida


def estados(cur, claves: list[Clave] | None = None, empresa: str | None = None,
            p: Parametros | None = None) -> dict[Clave, EstadoCliente]:
    """Estado de los clientes pedidos (o de todos / los de una empresa)."""
    p = p or parametros(cur)
    return calcular(*_cargar(cur, claves, empresa), p)


def estado_cliente(cur, empresa: str, codigo: str, p: Parametros | None = None) -> EstadoCliente:
    return estados(cur, [(empresa, codigo)], p=p).get((empresa, codigo)) or EstadoCliente(empresa, codigo)


def estado_de_despachos(cur, despacho_ids: list[str], p: Parametros | None = None) -> dict[str, dict]:
    """Resumen de cartera del cliente de cada despacho (por su destino:
    Cliente.empresa + codigo sin ceros, el mismo codigo del extracto)."""
    if not despacho_ids:
        return {}
    p = p or parametros(cur)
    cur.execute(
        "SELECT d.\"id\", c.\"empresa\"::text AS \"empresa\", ltrim(c.\"codigo\", '0') AS \"codigo\" "
        'FROM "Despacho" d JOIN "Cliente" c ON c."id" = d."destinoClienteId" WHERE d."id" = ANY(%s)',
        (despacho_ids,),
    )
    filas = cur.fetchall()
    claves = sorted({(f["empresa"], f["codigo"]) for f in filas})
    todos = estados(cur, claves, p=p)
    return {
        f["id"]: (todos.get((f["empresa"], f["codigo"])) or EstadoCliente(f["empresa"], f["codigo"])).resumen(p)
        for f in filas
    }


def puede_autorizar_excepciones(usuario: dict) -> bool:
    return usuario["rol"] == "ADMIN" or bool(usuario.get("autorizaExcepciones"))


def movimientos(cur, claves: list[Clave], desde: date | None, hasta: date | None,
                p: Parametros | None = None) -> dict:
    """Estado de cuenta: cargos, devoluciones y pagos verificados en orden,
    con el saldo corrido. Lo anterior a `desde` entra como saldo inicial."""
    p = p or parametros(cur)
    filtro, params = _filtro(claves, None)
    inicio = p.inicio or date(2000, 1, 1)
    cur.execute(
        'SELECT "empresa"::text AS "empresa", "codigoCliente", "tipoDoc", "numero", "fecha", "montoUsd", "montoBs" '
        f'FROM "DocumentoCobro" WHERE "vigente" AND "fecha" >= %(inicio)s AND {filtro} '
        "AND (\"tipoDoc\" IN ('FA', 'NE') AND \"montoUsd\" > 0 OR \"tipoDoc\" IN ('DV', 'DN') AND \"montoUsd\" < 0)",
        {**params, "inicio": inicio},
    )
    filas = [
        {"fecha": d["fecha"], "empresa": d["empresa"], "codigoCliente": d["codigoCliente"],
         "tipo": d["tipoDoc"], "referencia": d["numero"],
         "cargoUsd": float(d["montoUsd"]) if d["montoUsd"] > 0 else 0.0,
         "abonoUsd": float(-d["montoUsd"]) if d["montoUsd"] < 0 else 0.0,
         "montoBs": float(abs(d["montoBs"]))}
        for d in cur.fetchall()
    ]
    cur.execute(
        'SELECT "empresa"::text AS "empresa", "codigoCliente", "numero", "metodo", "referencia", "fechaPago", '
        '"montoUsd", "montoBs" FROM "Pago" '
        f"WHERE \"estado\" = 'VERIFICADO' AND {filtro}",
        params,
    )
    filas += [
        {"fecha": g["fechaPago"], "empresa": g["empresa"], "codigoCliente": g["codigoCliente"],
         "tipo": "PAGO", "referencia": g["numero"] + (f" · ref. {g['referencia']}" if g["referencia"] else ""),
         "metodo": g["metodo"], "cargoUsd": 0.0, "abonoUsd": float(g["montoUsd"]),
         "montoBs": float(g["montoBs"]) if g["montoBs"] is not None else None}
        for g in cur.fetchall()
    ]
    # A igual fecha, primero los cargos: el saldo corrido no pasa por negativo.
    filas.sort(key=lambda f: (f["fecha"], f["cargoUsd"] == 0, f["referencia"]))
    saldo_inicial = Decimal("0")
    salida = []
    saldo = Decimal("0")
    for f in filas:
        neto = Decimal(str(f["cargoUsd"])) - Decimal(str(f["abonoUsd"]))
        if desde and f["fecha"] < desde:
            saldo_inicial += neto
            saldo += neto
            continue
        if hasta and f["fecha"] > hasta:
            continue
        saldo += neto
        salida.append({**f, "saldoUsd": float(saldo)})
    return {"saldoInicialUsd": float(saldo_inicial), "movimientos": salida, "saldoFinalUsd": float(saldo)}
