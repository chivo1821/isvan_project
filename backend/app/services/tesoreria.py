"""Tesorería, cuentas bancarias / cajas, libro de movimientos y flujo de caja.

Reglas clave del negocio:
- Todo acceso exige el módulo `bancos` encendido para la empresa (`exigir_modulo`).
- `registrar_movimiento` bloquea la cuenta con `SELECT ... FOR UPDATE` y
  **permite saldo negativo** (sobregiro / cheques o cargos en tránsito): nunca
  lanza error por saldo insuficiente y expone `enNegativo: bool`.
- Soporta cuentas en `VES` y `USD`, calculando siempre `montoUsd` y `montoBs`
  con tasa explícita o tasa BCV (`para_fecha` / `ultima`).
- `transferir_entre_cuentas` bloquea ambas cuentas en orden determinístico de
  ID (sin deadlocks) y soporta tanto traspasos en la misma moneda como cambio
  de divisas (`VES <-> USD` con tasa pactada), enlazando ambos asientos con
  `transferenciaGrupoId`.
- `anular_movimiento` nunca borra filas (`DELETE`): marca `anuladoEn` y
  `motivoAnulacion` en el movimiento original e inserta un contra-asiento con
  `reversoDeId`.
"""

from __future__ import annotations

import io
import uuid
from collections import defaultdict
from datetime import date, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal

import openpyxl
from fastapi import HTTPException
from openpyxl.styles import Alignment, Font, PatternFill

from app.core.fechas import ahora_utc, hoy_caracas
from app.schemas import en_utc
from app.services import bancos, bitacora, tasa_bcv
from app.services.ventas import exigir_modulo

CENTAVO = Decimal("0.01")
CERO = Decimal("0")
MONTO_MAXIMO = Decimal("1000000000000")

TIPOS_CUENTA = (
    "BANCO_CORRIENTE",
    "BANCO_AHORRO",
    "BANCO_CUSTODIA_USD",
    "CAJA_EFECTIVO",
    "BILLETERA_DIGITAL",
)
MONEDAS = ("VES", "USD")
TIPOS_MOVIMIENTO = (
    "INGRESO",
    "EGRESO",
    "TRANSFERENCIA_SALIDA",
    "TRANSFERENCIA_ENTRADA",
    "AJUSTE",
)
METODOS_MOVIMIENTO = (
    "TRANSFERENCIA",
    "PAGO_MOVIL",
    "EFECTIVO",
    "DIVISAS",
    "ZELLE",
    "CHEQUE",
    "POS",
    "COMISION_IGTF",
    "RETENCION",
    "AJUSTE",
    "OTRO",
)
CATEGORIAS_SUGERIDAS = (
    "COBRANZA_CLIENTES",
    "COMPRA_INVENTARIO",
    "GASTO_OPERATIVO",
    "NOMINA",
    "DELIVERY",
    "IMPUESTOS_IGTF",
    "TRASPASO",
    "APORTE_CAPITAL",
    "OTRO",
)


def redondear(valor: Decimal | float | int | str) -> Decimal:
    return Decimal(str(valor)).quantize(CENTAVO, rounding=ROUND_HALF_UP)


def _iso_instante(valor: datetime | None) -> str | None:
    if valor is None:
        return None
    return en_utc(valor).isoformat().replace("+00:00", "Z")


def _iso_fecha(valor: date | datetime | str | None) -> str | None:
    if valor is None:
        return None
    if isinstance(valor, datetime):
        return valor.date().isoformat()
    if isinstance(valor, date):
        return valor.isoformat()
    return str(valor)


def obtener_tasa_fecha(cur, fecha: date) -> Decimal | None:
    """Busca la tasa BCV vigente para `fecha` (o la última anterior), con
    respaldo a `tasa_bcv.ultima(cur)`."""
    fn_para_fecha = getattr(tasa_bcv, "para_fecha", None)
    if callable(fn_para_fecha):
        res = fn_para_fecha(cur, fecha)
        if res is not None:
            val = res["tasa"] if isinstance(res, dict) else res
            return Decimal(str(val))
    cur.execute(
        'SELECT "fecha", "tasa", "fuente" FROM "TasaCambio" '
        'WHERE "fecha" <= %s ORDER BY "fecha" DESC LIMIT 1',
        (fecha,),
    )
    fila = cur.fetchone()
    if fila is None:
        fila = tasa_bcv.ultima(cur)
    if fila is None:
        return None
    return Decimal(str(fila["tasa"]))


def _tasa_actual_valor(cur) -> tuple[Decimal | None, date | None]:
    try:
        fila = tasa_bcv.tasa_actual(cur, hacer_commit=False)
    except tasa_bcv.TasaNoDisponible:
        fila = None
    if not fila:
        return None, None
    return Decimal(str(fila["tasa"])), fila["fecha"]


def _validar_datos_cuenta(
    *,
    nombre: str,
    tipo: str,
    moneda: str,
    banco_codigo: str | None,
    numero_cuenta: str | None,
    titular: str | None,
    rif: str | None,
) -> dict:
    nombre_limpio = " ".join((nombre or "").split())
    if len(nombre_limpio) < 2 or len(nombre_limpio) > 120:
        raise HTTPException(400, "El nombre de la cuenta debe tener entre 2 y 120 caracteres")
    if tipo not in TIPOS_CUENTA:
        raise HTTPException(400, "Tipo de cuenta de tesorería no válido")
    if moneda not in MONEDAS:
        raise HTTPException(400, "Moneda de cuenta no válida (usa VES o USD)")

    codigo_limpio = (banco_codigo or "").strip() or None
    cuenta_limpia = (numero_cuenta or "").strip() or None

    # Si no enviaron bancoCodigo pero la cuenta tiene 20 dígitos de un banco venezolano, inferirlo.
    if not codigo_limpio and cuenta_limpia:
        solo_digitos = "".join(c for c in cuenta_limpia if c.isdigit())
        if len(solo_digitos) == 20 and solo_digitos[:4] in bancos.BANCOS:
            codigo_limpio = solo_digitos[:4]

    if codigo_limpio is not None:
        try:
            codigo_limpio = bancos.validar_banco(codigo_limpio)
        except ValueError as e:
            raise HTTPException(400, str(e)) from e

    if cuenta_limpia:
        solo_digitos = "".join(c for c in cuenta_limpia if c.isdigit())
        if len(solo_digitos) == 20 and all(c.isdigit() or c in " -" for c in cuenta_limpia):
            if codigo_limpio and solo_digitos[:4] != codigo_limpio:
                raise HTTPException(400, "Los primeros 4 dígitos del número de cuenta no coinciden con el banco elegido")
            cuenta_limpia = solo_digitos
        elif codigo_limpio and len(solo_digitos) == 20 and solo_digitos[:4] != codigo_limpio:
            raise HTTPException(400, "Los primeros 4 dígitos del número de cuenta no coinciden con el banco elegido")

    rif_limpio = (rif or "").strip()[:30] or None
    if rif_limpio:
        try:
            rif_limpio = bancos.normalizar_cedula_rif(rif_limpio)
        except ValueError:
            # Permite RIF con guiones o identificadores externos si el usuario lo carga distinto
            rif_limpio = rif_limpio.upper()

    titular_limpio = " ".join((titular or "").split())[:150] or None

    return {
        "nombre": nombre_limpio,
        "tipo": tipo,
        "moneda": moneda,
        "bancoCodigo": codigo_limpio,
        "numeroCuenta": cuenta_limpia[:60] if cuenta_limpia else None,
        "titular": titular_limpio,
        "rif": rif_limpio,
    }


def cuenta_json(fila: dict, tasa_bcv_actual: Decimal | None) -> dict:
    saldo_inicial = redondear(Decimal(fila["saldoInicial"]))
    saldo_actual = redondear(Decimal(fila["saldoActual"]))
    moneda = fila["moneda"]
    if moneda == "USD":
        equiv_usd = saldo_actual
    elif tasa_bcv_actual is not None and tasa_bcv_actual > CERO:
        equiv_usd = redondear(saldo_actual / tasa_bcv_actual)
    else:
        equiv_usd = CERO

    return {
        "id": fila["id"],
        "empresaId": fila["empresaId"],
        "nombre": fila["nombre"],
        "tipo": fila["tipo"],
        "moneda": moneda,
        "bancoCodigo": fila["bancoCodigo"],
        "bancoNombre": bancos.nombre(fila["bancoCodigo"]),
        "numeroCuenta": fila["numeroCuenta"],
        "titular": fila["titular"],
        "rif": fila["rif"],
        "saldoInicial": float(saldo_inicial),
        "fechaSaldoInicial": _iso_fecha(fila["fechaSaldoInicial"]),
        "saldoActual": float(saldo_actual),
        "saldoEquivalenteUsd": float(equiv_usd),
        "enNegativo": bool(saldo_actual < CERO),
        "cuentaPortalId": fila.get("cuentaPortalId"),
        "activa": bool(fila["activa"]),
        "ultimoMovimientoEn": _iso_instante(fila.get("ultimoMovimientoEn")),
    }


_SELECT_CUENTA_CON_ULTIMO = """
    SELECT c.*,
           (SELECT MAX(m."creadoEn")
              FROM "MovimientoBancario" m
             WHERE m."cuentaId" = c."id" AND m."anuladoEn" IS NULL) AS "ultimoMovimientoEn"
      FROM "CuentaTesoreria" c
"""


def obtener_cuenta(cur, cuenta_id: str, *, empresa_id: str | None = None, bloquear: bool = False) -> dict:
    if bloquear:
        cur.execute('SELECT * FROM "CuentaTesoreria" WHERE "id" = %s FOR UPDATE', (cuenta_id,))
    else:
        cur.execute(f'{_SELECT_CUENTA_CON_ULTIMO} WHERE c."id" = %s', (cuenta_id,))
    fila = cur.fetchone()
    if not fila or (empresa_id and fila["empresaId"] != empresa_id):
        raise HTTPException(404, "Cuenta de tesorería no encontrada")
    return fila


def listar_cuentas(cur, empresa_id: str, *, solo_activas: bool = False) -> list[dict]:
    exigir_modulo(cur, empresa_id, "bancos")
    tasa_val, _ = _tasa_actual_valor(cur)
    condicion = 'WHERE c."empresaId" = %s' + (' AND c."activa" = true' if solo_activas else "")
    cur.execute(
        f'{_SELECT_CUENTA_CON_ULTIMO} {condicion} ORDER BY c."activa" DESC, c."moneda" DESC, c."nombre" ASC',
        (empresa_id,),
    )
    return [cuenta_json(f, tasa_val) for f in cur.fetchall()]


def crear_cuenta(
    cur,
    *,
    empresa_id: str,
    organizacion_id: str = "org-principal",
    nombre: str,
    tipo: str,
    moneda: str,
    banco_codigo: str | None = None,
    numero_cuenta: str | None = None,
    titular: str | None = None,
    rif: str | None = None,
    saldo_inicial: Decimal | float = Decimal("0"),
    fecha_saldo_inicial: date | None = None,
    cuenta_portal_id: str | None = None,
    activa: bool = True,
    usuario_id: str | None = None,
) -> dict:
    exigir_modulo(cur, empresa_id, "bancos")
    validados = _validar_datos_cuenta(
        nombre=nombre,
        tipo=tipo,
        moneda=moneda,
        banco_codigo=banco_codigo,
        numero_cuenta=numero_cuenta,
        titular=titular,
        rif=rif,
    )
    saldo_ini = redondear(saldo_inicial)
    if abs(saldo_ini) > MONTO_MAXIMO:
        raise HTTPException(400, "El saldo inicial excede el límite permitido")
    fecha_ini = fecha_saldo_inicial or hoy_caracas()
    cuenta_id = f"ctes-{uuid.uuid4().hex[:14]}"
    ahora = ahora_utc()
    portal_id = (cuenta_portal_id or "").strip() or None

    cur.execute(
        'INSERT INTO "CuentaTesoreria" '
        '("id", "organizacionId", "empresaId", "nombre", "tipo", "moneda", "bancoCodigo", "numeroCuenta", '
        '"titular", "rif", "saldoInicial", "fechaSaldoInicial", "saldoActual", "cuentaPortalId", "activa", '
        '"creadaEn", "actualizadaEn") '
        "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
        (
            cuenta_id,
            organizacion_id,
            empresa_id,
            validados["nombre"],
            validados["tipo"],
            validados["moneda"],
            validados["bancoCodigo"],
            validados["numeroCuenta"],
            validados["titular"],
            validados["rif"],
            saldo_ini,
            fecha_ini,
            saldo_ini,
            portal_id,
            activa,
            ahora,
            ahora,
        ),
    )
    tasa_val, _ = _tasa_actual_valor(cur)
    creada = cuenta_json(obtener_cuenta(cur, cuenta_id), tasa_val)
    bitacora.registrar(
        cur,
        usuario_id,
        "CuentaTesoreria",
        cuenta_id,
        "crear",
        None,
        creada,
        organizacion_id=organizacion_id,
    )
    return creada


def actualizar_cuenta(
    cur,
    cuenta_id: str,
    *,
    empresa_id: str | None = None,
    nombre: str | None = None,
    tipo: str | None = None,
    moneda: str | None = None,
    banco_codigo: str | None = None,
    banco_codigo_enviado: bool = False,
    numero_cuenta: str | None = None,
    numero_cuenta_enviado: bool = False,
    titular: str | None = None,
    titular_enviado: bool = False,
    rif: str | None = None,
    rif_enviado: bool = False,
    saldo_inicial: Decimal | float | None = None,
    fecha_saldo_inicial: date | None = None,
    cuenta_portal_id: str | None = None,
    cuenta_portal_enviado: bool = False,
    activa: bool | None = None,
    usuario_id: str | None = None,
) -> dict:
    actual = obtener_cuenta(cur, cuenta_id, empresa_id=empresa_id, bloquear=True)
    exigir_modulo(cur, actual["empresaId"], "bancos")

    nueva_moneda = moneda if moneda is not None else actual["moneda"]
    if nueva_moneda != actual["moneda"]:
        cur.execute('SELECT 1 FROM "MovimientoBancario" WHERE "cuentaId" = %s LIMIT 1', (cuenta_id,))
        if cur.fetchone():
            raise HTTPException(409, "No se puede cambiar la moneda de una cuenta que ya tiene movimientos")

    validados = _validar_datos_cuenta(
        nombre=nombre if nombre is not None else actual["nombre"],
        tipo=tipo if tipo is not None else actual["tipo"],
        moneda=nueva_moneda,
        banco_codigo=banco_codigo if banco_codigo_enviado else actual["bancoCodigo"],
        numero_cuenta=numero_cuenta if numero_cuenta_enviado else actual["numeroCuenta"],
        titular=titular if titular_enviado else actual["titular"],
        rif=rif if rif_enviado else actual["rif"],
    )

    nuevo_saldo_ini = redondear(saldo_inicial) if saldo_inicial is not None else redondear(actual["saldoInicial"])
    delta_ini = nuevo_saldo_ini - redondear(actual["saldoInicial"])
    nuevo_saldo_actual = redondear(Decimal(actual["saldoActual"]) + delta_ini)
    nueva_fecha_ini = fecha_saldo_inicial if fecha_saldo_inicial is not None else actual["fechaSaldoInicial"]
    nuevo_portal = ((cuenta_portal_id or "").strip() or None) if cuenta_portal_enviado else actual["cuentaPortalId"]
    nueva_activa = activa if activa is not None else actual["activa"]

    tasa_val, _ = _tasa_actual_valor(cur)
    antes_json = cuenta_json(actual, tasa_val)

    cur.execute(
        'UPDATE "CuentaTesoreria" SET '
        '"nombre" = %s, "tipo" = %s, "moneda" = %s, "bancoCodigo" = %s, "numeroCuenta" = %s, '
        '"titular" = %s, "rif" = %s, "saldoInicial" = %s, "fechaSaldoInicial" = %s, "saldoActual" = %s, '
        '"cuentaPortalId" = %s, "activa" = %s, "actualizadaEn" = %s '
        'WHERE "id" = %s',
        (
            validados["nombre"],
            validados["tipo"],
            validados["moneda"],
            validados["bancoCodigo"],
            validados["numeroCuenta"],
            validados["titular"],
            validados["rif"],
            nuevo_saldo_ini,
            nueva_fecha_ini,
            nuevo_saldo_actual,
            nuevo_portal,
            nueva_activa,
            ahora_utc(),
            cuenta_id,
        ),
    )
    despues_json = cuenta_json(obtener_cuenta(cur, cuenta_id), tasa_val)
    bitacora.registrar(
        cur,
        usuario_id,
        "CuentaTesoreria",
        cuenta_id,
        "editar",
        antes_json,
        despues_json,
        organizacion_id=actual.get("organizacionId", "org-principal"),
    )
    return despues_json


# ---------- Movimientos bancarios ----------


_SELECT_MOVIMIENTO = """
    SELECT m.*,
           c."nombre" AS "cuentaNombre",
           c."moneda" AS "cuentaMoneda",
           c."saldoActual" AS "cuentaSaldoActual",
           u."nombre" AS "usuario"
      FROM "MovimientoBancario" m
      JOIN "CuentaTesoreria" c ON c."id" = m."cuentaId"
      LEFT JOIN "Usuario" u ON u."id" = m."usuarioId"
"""


def movimiento_json(fila: dict) -> dict:
    saldo_res = redondear(Decimal(fila["saldoResultante"]))
    return {
        "id": int(fila["id"]),
        "empresaId": fila["empresaId"],
        "cuentaId": fila["cuentaId"],
        "cuentaNombre": fila["cuentaNombre"],
        "cuentaMoneda": fila["cuentaMoneda"],
        "fecha": _iso_fecha(fila["fecha"]),
        "tipo": fila["tipo"],
        "metodo": fila["metodo"],
        "categoria": fila["categoria"],
        "concepto": fila["concepto"],
        "tercero": fila.get("tercero"),
        "referencia": fila.get("referencia"),
        "monto": float(redondear(Decimal(fila["monto"]))),
        "tasa": float(Decimal(fila["tasa"])) if fila.get("tasa") is not None else None,
        "montoUsd": float(redondear(Decimal(fila["montoUsd"]))),
        "montoBs": float(redondear(Decimal(fila["montoBs"]))) if fila.get("montoBs") is not None else None,
        "saldoResultante": float(saldo_res),
        "enNegativo": bool(saldo_res < CERO),
        "transferenciaGrupoId": fila.get("transferenciaGrupoId"),
        "pagoId": fila.get("pagoId"),
        "gastoId": fila.get("gastoId"),
        "conciliado": bool(fila["conciliado"]),
        "conciliadoEn": _iso_instante(fila.get("conciliadoEn")),
        "anuladoEn": _iso_instante(fila.get("anuladoEn")),
        "motivoAnulacion": fila.get("motivoAnulacion"),
        "reversoDeId": int(fila["reversoDeId"]) if fila.get("reversoDeId") is not None else None,
        "usuario": fila.get("usuario"),
        "creadoEn": _iso_instante(fila["creadoEn"]),
    }


def obtener_movimiento(cur, mov_id: int) -> dict:
    cur.execute(f'{_SELECT_MOVIMIENTO} WHERE m."id" = %s', (mov_id,))
    fila = cur.fetchone()
    if not fila:
        raise HTTPException(404, "Movimiento bancario no encontrado")
    return movimiento_json(fila)


def _normalizar_signo_monto(tipo: str, monto_entrada: Decimal) -> Decimal:
    monto = redondear(monto_entrada)
    if monto == CERO or abs(monto) > MONTO_MAXIMO:
        raise HTTPException(400, "El monto debe ser distinto de cero y estar dentro del rango permitido")
    if tipo == "INGRESO":
        if monto <= CERO:
            raise HTTPException(400, "El monto de un ingreso debe ser mayor que cero")
        return monto
    if tipo == "EGRESO":
        return -abs(monto)
    if tipo == "TRANSFERENCIA_ENTRADA":
        return abs(monto)
    if tipo == "TRANSFERENCIA_SALIDA":
        return -abs(monto)
    if tipo == "AJUSTE":
        return monto
    raise HTTPException(400, "Tipo de movimiento no válido")


def _calcular_montos_multimoneda(
    cur,
    *,
    moneda_cuenta: str,
    monto_con_signo: Decimal,
    fecha: date,
    tasa_explicita: Decimal | None = None,
    monto_usd_explicito: Decimal | None = None,
    monto_bs_explicito: Decimal | None = None,
) -> tuple[Decimal | None, Decimal, Decimal | None]:
    """Devuelve `(tasa, montoUsd, montoBs)` con el mismo signo de `monto_con_signo`."""
    signo = Decimal("1") if monto_con_signo >= CERO else Decimal("-1")

    tasa_usada: Decimal | None = None
    if tasa_explicita is not None:
        tasa_usada = Decimal(str(tasa_explicita))
        if tasa_usada <= CERO:
            raise HTTPException(400, "La tasa de cambio debe ser mayor que cero")
    else:
        tasa_usada = obtener_tasa_fecha(cur, fecha)

    if moneda_cuenta == "VES":
        monto_bs = monto_con_signo
        if monto_usd_explicito is not None:
            monto_usd = signo * abs(redondear(monto_usd_explicito))
        elif tasa_usada is not None and tasa_usada > CERO:
            monto_usd = redondear(monto_bs / tasa_usada)
            if monto_usd == CERO and monto_bs != CERO:
                monto_usd = signo * CENTAVO
        else:
            raise HTTPException(
                409,
                "No hay tasa BCV disponible para convertir bolívares a USD. Carga una tasa o indícala en el movimiento.",
            )
        return tasa_usada, monto_usd, monto_bs

    # Cuenta en USD
    monto_usd = monto_con_signo
    if monto_bs_explicito is not None:
        monto_bs = signo * abs(redondear(monto_bs_explicito))
    elif tasa_usada is not None and tasa_usada > CERO:
        monto_bs = redondear(monto_usd * tasa_usada)
    else:
        monto_bs = None
        tasa_usada = None
    return tasa_usada, monto_usd, monto_bs


def registrar_movimiento(
    cur,
    *,
    cuenta_id: str,
    empresa_id: str | None = None,
    fecha: date | None = None,
    tipo: str,
    metodo: str = "TRANSFERENCIA",
    categoria: str = "OTRO",
    concepto: str,
    tercero: str | None = None,
    referencia: str | None = None,
    monto: Decimal | float | str,
    tasa: Decimal | float | str | None = None,
    monto_usd_explicito: Decimal | None = None,
    monto_bs_explicito: Decimal | None = None,
    transferencia_grupo_id: str | None = None,
    pago_id: str | None = None,
    gasto_id: str | None = None,
    liquidacion_delivery_id: str | None = None,
    conciliado: bool = False,
    reverso_de_id: int | None = None,
    usuario_id: str | None = None,
    verificar_modulo: bool = True,
    cuenta_bloqueada: dict | None = None,
) -> dict:
    """Registra un asiento en `MovimientoBancario` bloqueando `CuentaTesoreria`
    con `SELECT ... FOR UPDATE`. Permite saldo negativo (`enNegativo: bool`)."""
    if tipo not in TIPOS_MOVIMIENTO:
        raise HTTPException(400, f"Tipo de movimiento inválido: {tipo}")

    metodo_norm = (metodo or "OTRO").strip().upper()
    if metodo_norm not in METODOS_MOVIMIENTO:
        metodo_norm = "OTRO"

    categoria_norm = " ".join((categoria or "OTRO").split()).upper()[:80] or "OTRO"
    concepto_limpio = " ".join((concepto or "").split())[:300]
    if not concepto_limpio:
        raise HTTPException(400, "El concepto del movimiento es obligatorio")

    tercero_limpio = " ".join((tercero or "").split())[:200] or None
    referencia_limpia = " ".join((referencia or "").split())[:100] or None
    fecha_mov = fecha or hoy_caracas()

    cuenta = cuenta_bloqueada or obtener_cuenta(cur, cuenta_id, empresa_id=empresa_id, bloquear=True)
    if empresa_id and cuenta["empresaId"] != empresa_id:
        raise HTTPException(404, "Cuenta de tesorería no encontrada en esta empresa")
    if verificar_modulo:
        exigir_modulo(cur, cuenta["empresaId"], "bancos")
    if not cuenta["activa"] and reverso_de_id is None:
        raise HTTPException(409, "La cuenta de tesorería está inactiva")

    if pago_id is not None:
        cur.execute(
            'SELECT "id" FROM "MovimientoBancario" WHERE "pagoId" = %s AND "anuladoEn" IS NULL LIMIT 1',
            (pago_id,),
        )
        if cur.fetchone():
            raise HTTPException(409, "Ese pago ya tiene un movimiento bancario activo asociado")
    if gasto_id is not None:
        cur.execute(
            'SELECT "id" FROM "MovimientoBancario" WHERE "gastoId" = %s AND "anuladoEn" IS NULL LIMIT 1',
            (gasto_id,),
        )
        if cur.fetchone():
            raise HTTPException(409, "Ese gasto ya tiene un movimiento bancario activo asociado")

    monto_con_signo = _normalizar_signo_monto(tipo, Decimal(str(monto)))
    tasa_dec = Decimal(str(tasa)) if tasa is not None else None
    tasa_usada, monto_usd, monto_bs = _calcular_montos_multimoneda(
        cur,
        moneda_cuenta=cuenta["moneda"],
        monto_con_signo=monto_con_signo,
        fecha=fecha_mov,
        tasa_explicita=tasa_dec,
        monto_usd_explicito=monto_usd_explicito,
        monto_bs_explicito=monto_bs_explicito,
    )

    # Permite saldo negativo (sobregiro / cheques / diferidos) sin lanzar excepción.
    nuevo_saldo = redondear(Decimal(cuenta["saldoActual"]) + monto_con_signo)
    ahora = ahora_utc()

    cur.execute(
        'UPDATE "CuentaTesoreria" SET "saldoActual" = %s, "actualizadaEn" = %s WHERE "id" = %s',
        (nuevo_saldo, ahora, cuenta["id"]),
    )
    cuenta["saldoActual"] = nuevo_saldo

    cur.execute(
        'INSERT INTO "MovimientoBancario" '
        '("organizacionId", "empresaId", "cuentaId", "fecha", "tipo", "metodo", "categoria", "concepto", '
        '"tercero", "referencia", "monto", "tasa", "montoUsd", "montoBs", "saldoResultante", '
        '"transferenciaGrupoId", "pagoId", "gastoId", "liquidacionDeliveryId", '
        '"conciliado", "conciliadoEn", "conciliadoPorId", "reversoDeId", "usuarioId", "creadoEn") '
        "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) "
        'RETURNING "id"',
        (
            cuenta.get("organizacionId", "org-principal"),
            cuenta["empresaId"],
            cuenta["id"],
            fecha_mov,
            tipo,
            metodo_norm,
            categoria_norm,
            concepto_limpio,
            tercero_limpio,
            referencia_limpia,
            monto_con_signo,
            tasa_usada,
            monto_usd,
            monto_bs,
            nuevo_saldo,
            transferencia_grupo_id,
            pago_id,
            gasto_id,
            liquidacion_delivery_id,
            conciliado,
            ahora if conciliado else None,
            usuario_id if conciliado else None,
            reverso_de_id,
            usuario_id,
            ahora,
        ),
    )
    mov_id = int(cur.fetchone()["id"])
    creado = obtener_movimiento(cur, mov_id)

    bitacora.registrar(
        cur,
        usuario_id,
        "MovimientoBancario",
        str(mov_id),
        "reverso" if reverso_de_id is not None else "registrar",
        None,
        creado,
        organizacion_id=cuenta.get("organizacionId", "org-principal"),
    )
    return creado


def transferir_entre_cuentas(
    cur,
    *,
    cuenta_origen_id: str,
    cuenta_destino_id: str,
    monto_origen: Decimal | float | str,
    empresa_id: str | None = None,
    fecha: date | None = None,
    tasa: Decimal | float | str | None = None,
    monto_destino: Decimal | float | str | None = None,
    referencia: str | None = None,
    concepto: str | None = None,
    metodo: str = "TRANSFERENCIA",
    usuario_id: str | None = None,
) -> dict:
    """Traspaso entre cuentas de la misma empresa o compra/venta de divisas
    (`VES <-> USD` con tasa pactada), en una sola transacción atómica."""
    if cuenta_origen_id == cuenta_destino_id:
        raise HTTPException(400, "Las cuentas de origen y destino deben ser distintas")

    # Bloqueo en orden determinístico de ID para evitar deadlocks concurrentes.
    ids_ordenados = sorted([cuenta_origen_id, cuenta_destino_id])
    cur.execute(
        'SELECT * FROM "CuentaTesoreria" WHERE "id" = ANY(%s) ORDER BY "id" FOR UPDATE',
        (ids_ordenados,),
    )
    por_id = {f["id"]: f for f in cur.fetchall()}
    origen = por_id.get(cuenta_origen_id)
    destino = por_id.get(cuenta_destino_id)
    if not origen or not destino:
        raise HTTPException(404, "Una de las cuentas de la transferencia no existe")
    if origen["empresaId"] != destino["empresaId"]:
        raise HTTPException(400, "Ambas cuentas deben pertenecer a la misma empresa")
    if empresa_id and origen["empresaId"] != empresa_id:
        raise HTTPException(404, "Cuentas no encontradas en esta empresa")

    emp_id = origen["empresaId"]
    exigir_modulo(cur, emp_id, "bancos")
    if not origen["activa"] or not destino["activa"]:
        raise HTTPException(409, "Ambas cuentas deben estar activas para transferir")

    monto_orig = redondear(Decimal(str(monto_origen)))
    if monto_orig <= CERO or monto_orig > MONTO_MAXIMO:
        raise HTTPException(400, "El monto a transferir debe ser mayor que cero")

    fecha_mov = fecha or hoy_caracas()
    tasa_dec = Decimal(str(tasa)) if tasa is not None else None
    if tasa_dec is not None and tasa_dec <= CERO:
        raise HTTPException(400, "La tasa pactada debe ser mayor que cero")

    mon_orig = origen["moneda"]
    mon_dest = destino["moneda"]

    if mon_orig == mon_dest:
        monto_dest = redondear(Decimal(str(monto_destino))) if monto_destino is not None else monto_orig
        if monto_dest != monto_orig:
            raise HTTPException(400, "En traspasos de la misma moneda el monto destino debe coincidir con el origen")
        tasa_usada = tasa_dec or obtener_tasa_fecha(cur, fecha_mov)
        if mon_orig == "VES":
            if tasa_usada is None or tasa_usada <= CERO:
                raise HTTPException(409, "No hay tasa BCV disponible para valorar el traspaso en bolívares")
            usd_comun = redondear(monto_orig / tasa_usada)
            bs_comun = monto_orig
        else:
            usd_comun = monto_orig
            bs_comun = redondear(monto_orig * tasa_usada) if (tasa_usada and tasa_usada > CERO) else None
    else:
        # Cambio de divisas (VES <-> USD)
        if mon_orig == "VES" and mon_dest == "USD":
            bs_comun = monto_orig
            if monto_destino is not None:
                usd_comun = redondear(Decimal(str(monto_destino)))
                if usd_comun <= CERO:
                    raise HTTPException(400, "El monto destino en USD debe ser mayor que cero")
                tasa_usada = tasa_dec or (bs_comun / usd_comun).quantize(Decimal("0.00000001"), rounding=ROUND_HALF_UP)
            elif tasa_dec is not None:
                tasa_usada = tasa_dec
                usd_comun = redondear(bs_comun / tasa_usada)
            else:
                raise HTTPException(400, "Indica la tasa pactada para el cambio de divisas (VES a USD)")
            if usd_comun <= CERO:
                raise HTTPException(400, "El monto resultante en USD es demasiado pequeño")
            monto_dest = usd_comun
        else:
            # USD -> VES
            usd_comun = monto_orig
            if monto_destino is not None:
                bs_comun = redondear(Decimal(str(monto_destino)))
                if bs_comun <= CERO:
                    raise HTTPException(400, "El monto destino en Bs debe ser mayor que cero")
                tasa_usada = tasa_dec or (bs_comun / usd_comun).quantize(Decimal("0.00000001"), rounding=ROUND_HALF_UP)
            elif tasa_dec is not None:
                tasa_usada = tasa_dec
                bs_comun = redondear(usd_comun * tasa_usada)
            else:
                raise HTTPException(400, "Indica la tasa pactada para el cambio de divisas (USD a VES)")
            if bs_comun <= CERO:
                raise HTTPException(400, "El monto resultante en Bs es demasiado pequeño")
            monto_dest = bs_comun

    grupo_id = f"trf-{uuid.uuid4().hex[:16]}"
    etiqueta_base = "Cambio de divisas" if mon_orig != mon_dest else "Transferencia"
    concepto_salida = " ".join((concepto or f"{etiqueta_base} hacia {destino['nombre']}").split())[:300]
    concepto_entrada = " ".join((concepto or f"{etiqueta_base} desde {origen['nombre']}").split())[:300]

    salida = registrar_movimiento(
        cur,
        cuenta_id=origen["id"],
        empresa_id=emp_id,
        fecha=fecha_mov,
        tipo="TRANSFERENCIA_SALIDA",
        metodo=metodo,
        categoria="TRASPASO",
        concepto=concepto_salida,
        tercero=destino["nombre"],
        referencia=referencia,
        monto=monto_orig,
        tasa=tasa_usada,
        monto_usd_explicito=usd_comun,
        monto_bs_explicito=bs_comun,
        transferencia_grupo_id=grupo_id,
        usuario_id=usuario_id,
        verificar_modulo=False,
        cuenta_bloqueada=origen,
    )
    entrada = registrar_movimiento(
        cur,
        cuenta_id=destino["id"],
        empresa_id=emp_id,
        fecha=fecha_mov,
        tipo="TRANSFERENCIA_ENTRADA",
        metodo=metodo,
        categoria="TRASPASO",
        concepto=concepto_entrada,
        tercero=origen["nombre"],
        referencia=referencia,
        monto=monto_dest,
        tasa=tasa_usada,
        monto_usd_explicito=usd_comun,
        monto_bs_explicito=bs_comun,
        transferencia_grupo_id=grupo_id,
        usuario_id=usuario_id,
        verificar_modulo=False,
        cuenta_bloqueada=destino,
    )

    bitacora.registrar(
        cur,
        usuario_id,
        "TransferenciaBancaria",
        grupo_id,
        "transferir",
        None,
        {
            "transferenciaGrupoId": grupo_id,
            "salidaId": salida["id"],
            "entradaId": entrada["id"],
            "monedaOrigen": mon_orig,
            "monedaDestino": mon_dest,
            "montoOrigen": float(monto_orig),
            "montoDestino": float(monto_dest),
            "tasa": float(tasa_usada) if tasa_usada is not None else None,
        },
        organizacion_id=origen.get("organizacionId", "org-principal"),
    )
    return {
        "transferenciaGrupoId": grupo_id,
        "salida": salida,
        "entrada": entrada,
        "enNegativo": salida["enNegativo"],
    }


def anular_movimiento(
    cur,
    *,
    mov_id: int,
    motivo: str,
    empresa_id: str | None = None,
    usuario_id: str | None = None,
) -> dict:
    """Anula un movimiento bancario creando un contra-asiento (`reversoDeId`)
    y marcando `anuladoEn` / `motivoAnulacion` en el original (nunca DELETE).
    Si pertenece a una transferencia entre cuentas, anula ambos lados."""
    motivo_limpio = " ".join((motivo or "").split())[:300]
    if len(motivo_limpio) < 3:
        raise HTTPException(400, "Indica un motivo de anulación de al menos 3 caracteres")

    cur.execute('SELECT * FROM "MovimientoBancario" WHERE "id" = %s FOR UPDATE', (mov_id,))
    original = cur.fetchone()
    if not original or (empresa_id and original["empresaId"] != empresa_id):
        raise HTTPException(404, "Movimiento bancario no encontrado")
    exigir_modulo(cur, original["empresaId"], "bancos")

    if original["anuladoEn"] is not None:
        raise HTTPException(409, "Este movimiento ya fue anulado")
    if original["reversoDeId"] is not None:
        raise HTTPException(409, "No se puede anular un contra-asiento de reverso")

    if original["transferenciaGrupoId"]:
        cur.execute(
            'SELECT * FROM "MovimientoBancario" WHERE "transferenciaGrupoId" = %s ORDER BY "id" FOR UPDATE',
            (original["transferenciaGrupoId"],),
        )
        objetivos = [m for m in cur.fetchall() if m["anuladoEn"] is None and m["reversoDeId"] is None]
    else:
        objetivos = [original]

    cuentas_ids = sorted({m["cuentaId"] for m in objetivos})
    cur.execute(
        'SELECT * FROM "CuentaTesoreria" WHERE "id" = ANY(%s) ORDER BY "id" FOR UPDATE',
        (cuentas_ids,),
    )
    cuentas_por_id = {c["id"]: c for c in cur.fetchall()}

    ahora = ahora_utc()
    reverso_principal = None
    reversos = []

    for m in objetivos:
        cur.execute(
            'UPDATE "MovimientoBancario" SET "anuladoEn" = %s, "anuladoPorId" = %s, "motivoAnulacion" = %s '
            'WHERE "id" = %s',
            (ahora, usuario_id, motivo_limpio, m["id"]),
        )
        # Si estaba enlazado a un Pago de cobranzas, limpiamos el puntero en Pago.
        if m.get("pagoId"):
            cur.execute(
                'UPDATE "Pago" SET "cuentaTesoreriaId" = NULL WHERE "id" = %s AND "cuentaTesoreriaId" = %s',
                (m["pagoId"], m["cuentaId"]),
            )

        monto_orig = redondear(Decimal(m["monto"]))
        monto_rev = -monto_orig
        usd_rev = abs(redondear(Decimal(m["montoUsd"])))
        bs_rev = abs(redondear(Decimal(m["montoBs"]))) if m["montoBs"] is not None else None

        rev = registrar_movimiento(
            cur,
            cuenta_id=m["cuentaId"],
            empresa_id=m["empresaId"],
            fecha=m["fecha"],
            tipo="AJUSTE",
            metodo=m["metodo"],
            categoria=m["categoria"],
            concepto=f"Reverso mov. #{m['id']}: {motivo_limpio}"[:300],
            tercero=m["tercero"],
            referencia=m["referencia"],
            monto=monto_rev,
            tasa=m["tasa"],
            monto_usd_explicito=usd_rev,
            monto_bs_explicito=bs_rev,
            conciliado=False,
            reverso_de_id=int(m["id"]),
            usuario_id=usuario_id,
            verificar_modulo=False,
            cuenta_bloqueada=cuentas_por_id[m["cuentaId"]],
        )
        reversos.append(rev)
        if int(m["id"]) == int(mov_id):
            reverso_principal = rev

    anulado_json = obtener_movimiento(cur, mov_id)
    bitacora.registrar(
        cur,
        usuario_id,
        "MovimientoBancario",
        str(mov_id),
        "anular",
        None,
        {"motivo": motivo_limpio, "reversoId": reverso_principal["id"] if reverso_principal else None},
        organizacion_id=original.get("organizacionId", "org-principal"),
    )
    return {
        "anulado": anulado_json,
        "reverso": reverso_principal or reversos[0],
        "reversos": reversos,
    }


def conciliar_movimientos(
    cur,
    *,
    empresa_id: str | None,
    movimiento_ids: list[int],
    conciliado: bool = True,
    usuario_id: str | None = None,
) -> dict:
    ids_unicos = sorted({int(x) for x in movimiento_ids})
    if not ids_unicos:
        raise HTTPException(400, "Selecciona al menos un movimiento para conciliar")

    cur.execute(
        'SELECT "id", "empresaId", "organizacionId", "anuladoEn" FROM "MovimientoBancario" '
        'WHERE "id" = ANY(%s) FOR UPDATE',
        (ids_unicos,),
    )
    filas = cur.fetchall()
    if len(filas) != len(ids_unicos):
        raise HTTPException(404, "Uno o más movimientos no existen")

    empresas_encontradas = {f["empresaId"] for f in filas}
    if empresa_id and empresas_encontradas != {empresa_id}:
        raise HTTPException(404, "Alguno de los movimientos no pertenece a la empresa indicada")
    for emp in empresas_encontradas:
        exigir_modulo(cur, emp, "bancos")
    if any(f["anuladoEn"] is not None for f in filas):
        raise HTTPException(409, "No se puede conciliar un movimiento anulado")

    ahora = ahora_utc()
    cur.execute(
        'UPDATE "MovimientoBancario" SET "conciliado" = %s, "conciliadoEn" = %s, "conciliadoPorId" = %s '
        'WHERE "id" = ANY(%s)',
        (conciliado, ahora if conciliado else None, usuario_id if conciliado else None, ids_unicos),
    )
    org_id = filas[0].get("organizacionId", "org-principal")
    bitacora.registrar(
        cur,
        usuario_id,
        "MovimientoBancario",
        ",".join(str(i) for i in ids_unicos[:10]),
        "conciliar" if conciliado else "desconciliar",
        None,
        {"ids": ids_unicos, "conciliado": conciliado},
        organizacion_id=org_id,
    )
    return {"actualizados": len(ids_unicos), "conciliado": conciliado}


def listar_movimientos(
    cur,
    *,
    empresa_id: str,
    cuenta_id: str | None = None,
    desde: date | None = None,
    hasta: date | None = None,
    tipo: str | None = None,
    categoria: str | None = None,
    conciliado: bool | None = None,
    buscar: str | None = None,
    incluir_anulados: bool = True,
    limite: int = 500,
) -> list[dict]:
    exigir_modulo(cur, empresa_id, "bancos")
    if desde and hasta and hasta < desde:
        raise HTTPException(400, "La fecha final no puede ser anterior a la inicial")

    condiciones = ['m."empresaId" = %(empresaId)s']
    params: dict = {"empresaId": empresa_id, "limite": min(max(limite, 1), 2000)}

    if cuenta_id:
        condiciones.append('m."cuentaId" = %(cuentaId)s')
        params["cuentaId"] = cuenta_id
    if desde:
        condiciones.append('m."fecha" >= %(desde)s')
        params["desde"] = desde
    if hasta:
        condiciones.append('m."fecha" <= %(hasta)s')
        params["hasta"] = hasta
    if tipo:
        condiciones.append('m."tipo" = %(tipo)s')
        params["tipo"] = tipo.strip().upper()
    if categoria:
        condiciones.append('m."categoria" = %(categoria)s')
        params["categoria"] = categoria.strip().upper()
    if conciliado is not None:
        condiciones.append('m."conciliado" = %(conciliado)s')
        params["conciliado"] = conciliado
    if not incluir_anulados:
        condiciones.append('m."anuladoEn" IS NULL AND m."reversoDeId" IS NULL')
    if buscar and buscar.strip():
        patron = f"%{buscar.strip()}%"
        condiciones.append(
            '(m."concepto" ILIKE %(patron)s OR COALESCE(m."referencia", \'\') ILIKE %(patron)s '
            'OR COALESCE(m."tercero", \'\') ILIKE %(patron)s)'
        )
        params["patron"] = patron

    donde = " AND ".join(condiciones)
    cur.execute(
        f'{_SELECT_MOVIMIENTO} WHERE {donde} ORDER BY m."fecha" DESC, m."id" DESC LIMIT %(limite)s',
        params,
    )
    return [movimiento_json(f) for f in cur.fetchall()]


# ---------- Resumen de disponible y Flujo de Caja ----------


def resumen_disponible(cur, empresa_id: str) -> dict:
    """Cumple `ResumenBancos` de `src/lib/administrativo.ts`."""
    exigir_modulo(cur, empresa_id, "bancos")
    tasa_val, fecha_tasa = _tasa_actual_valor(cur)
    cuentas = listar_cuentas(cur, empresa_id, solo_activas=False)

    activas = [c for c in cuentas if c["activa"]]
    disp_usd = redondear(sum((Decimal(str(c["saldoActual"])) for c in activas if c["moneda"] == "USD"), CERO))
    disp_bs = redondear(sum((Decimal(str(c["saldoActual"])) for c in activas if c["moneda"] == "VES"), CERO))
    disp_bs_en_usd = redondear(disp_bs / tasa_val) if (tasa_val is not None and tasa_val > CERO) else CERO
    consolidado_usd = redondear(disp_usd + disp_bs_en_usd)

    hoy = hoy_caracas()
    inicio_mes = hoy.replace(day=1)
    fin_mes = date(hoy.year + (1 if hoy.month == 12 else 0), 1 if hoy.month == 12 else hoy.month + 1, 1) - timedelta(days=1)

    cur.execute(
        """
        SELECT COALESCE(SUM(CASE WHEN m."montoUsd" > 0 THEN m."montoUsd" ELSE 0 END), 0) AS "ingresosUsd",
               COALESCE(SUM(CASE WHEN m."montoUsd" < 0 THEN -m."montoUsd" ELSE 0 END), 0) AS "egresosUsd"
          FROM "MovimientoBancario" m
         WHERE m."empresaId" = %s
           AND m."fecha" BETWEEN %s AND %s
           AND m."anuladoEn" IS NULL
           AND m."reversoDeId" IS NULL
           AND m."tipo" NOT IN ('TRANSFERENCIA_SALIDA', 'TRANSFERENCIA_ENTRADA')
        """,
        (empresa_id, inicio_mes, fin_mes),
    )
    flujo_mes = cur.fetchone()
    ingresos_mes = redondear(Decimal(flujo_mes["ingresosUsd"]))
    egresos_mes = redondear(Decimal(flujo_mes["egresosUsd"]))
    neto_mes = redondear(ingresos_mes - egresos_mes)

    return {
        "tasaBcv": float(tasa_val) if tasa_val is not None else None,
        "fechaTasa": _iso_fecha(fecha_tasa),
        "disponibleUsd": float(disp_usd),
        "disponibleBs": float(disp_bs),
        "disponibleBsEnUsd": float(disp_bs_en_usd),
        "disponibleConsolidadoUsd": float(consolidado_usd),
        "ingresosMesUsd": float(ingresos_mes),
        "egresosMesUsd": float(egresos_mes),
        "flujoNetoMesUsd": float(neto_mes),
        "cuentasActivas": len(activas),
        "cuentasEnNegativo": sum(1 for c in activas if c["enNegativo"]),
        "cuentas": cuentas,
    }


def _clave_periodo(fecha: date, agrupacion: str) -> str:
    if agrupacion == "mes":
        return f"{fecha.year:04d}-{fecha.month:02d}"
    if agrupacion == "semana":
        lunes = fecha - timedelta(days=fecha.weekday())
        return lunes.isoformat()
    return fecha.isoformat()


def flujo_de_caja(
    cur,
    *,
    empresa_id: str,
    desde: date,
    hasta: date,
    agrupacion: str = "dia",
    cuenta_id: str | None = None,
) -> dict:
    """Cumple `FlujoCajaReporte` de `src/lib/administrativo.ts`."""
    exigir_modulo(cur, empresa_id, "bancos")
    if hasta < desde:
        raise HTTPException(400, "La fecha final no puede ser anterior a la inicial")
    if agrupacion not in ("dia", "semana", "mes"):
        raise HTTPException(400, "Agrupación inválida: usa dia, semana o mes")

    if cuenta_id:
        c = obtener_cuenta(cur, cuenta_id, empresa_id=empresa_id)
        cuentas_base = [c]
    else:
        cur.execute(
            'SELECT * FROM "CuentaTesoreria" WHERE "empresaId" = %s AND "activa" = true',
            (empresa_id,),
        )
        cuentas_base = cur.fetchall()

    apertura_usd = CERO
    ids_cuentas = [c["id"] for c in cuentas_base]
    for c in cuentas_base:
        ini = redondear(Decimal(c["saldoInicial"]))
        if c["moneda"] == "USD":
            apertura_usd += ini
        else:
            tasa_ini = obtener_tasa_fecha(cur, c["fechaSaldoInicial"])
            if tasa_ini and tasa_ini > CERO:
                apertura_usd += redondear(ini / tasa_ini)

    movs_previos_usd = CERO
    if ids_cuentas:
        cur.execute(
            """
            SELECT COALESCE(SUM(m."montoUsd"), 0) AS "netoPrevio"
              FROM "MovimientoBancario" m
             WHERE m."empresaId" = %s
               AND m."cuentaId" = ANY(%s)
               AND m."fecha" < %s
               AND m."anuladoEn" IS NULL
               AND m."reversoDeId" IS NULL
            """,
            (empresa_id, ids_cuentas, desde),
        )
        movs_previos_usd = redondear(Decimal(cur.fetchone()["netoPrevio"]))

    saldo_inicial_usd = redondear(apertura_usd + movs_previos_usd)

    filas_movs: list[dict] = []
    if ids_cuentas:
        filtro_traspasos = (
            ""
            if cuenta_id
            else "AND m.\"tipo\" NOT IN ('TRANSFERENCIA_SALIDA', 'TRANSFERENCIA_ENTRADA')"
        )
        cur.execute(
            f"""
            SELECT m."fecha", m."categoria", m."montoUsd"
              FROM "MovimientoBancario" m
             WHERE m."empresaId" = %s
               AND m."cuentaId" = ANY(%s)
               AND m."fecha" BETWEEN %s AND %s
               AND m."anuladoEn" IS NULL
               AND m."reversoDeId" IS NULL
               {filtro_traspasos}
             ORDER BY m."fecha" ASC, m."id" ASC
            """,
            (empresa_id, ids_cuentas, desde, hasta),
        )
        filas_movs = cur.fetchall()

    por_periodo: dict[str, dict[str, Decimal]] = defaultdict(lambda: {"ingresos": CERO, "egresos": CERO})
    por_cat: dict[str, dict] = defaultdict(lambda: {"ingresos": CERO, "egresos": CERO, "movimientos": 0})

    total_ingresos = CERO
    total_egresos = CERO

    for f in filas_movs:
        monto_u = redondear(Decimal(f["montoUsd"]))
        clave_p = _clave_periodo(f["fecha"], agrupacion)
        cat = f["categoria"] or "OTRO"
        por_cat[cat]["movimientos"] += 1
        if monto_u >= CERO:
            por_periodo[clave_p]["ingresos"] += monto_u
            por_cat[cat]["ingresos"] += monto_u
            total_ingresos += monto_u
        else:
            abs_u = abs(monto_u)
            por_periodo[clave_p]["egresos"] += abs_u
            por_cat[cat]["egresos"] += abs_u
            total_egresos += abs_u

    acumulado = saldo_inicial_usd
    series = []
    for periodo_k in sorted(por_periodo.keys()):
        ing = redondear(por_periodo[periodo_k]["ingresos"])
        egr = redondear(por_periodo[periodo_k]["egresos"])
        neto = redondear(ing - egr)
        acumulado = redondear(acumulado + neto)
        series.append(
            {
                "periodo": periodo_k,
                "ingresosUsd": float(ing),
                "egresosUsd": float(egr),
                "netoUsd": float(neto),
                "saldoAcumuladoUsd": float(acumulado),
            }
        )

    categorias = sorted(
        (
            {
                "categoria": cat,
                "ingresosUsd": float(redondear(vals["ingresos"])),
                "egresosUsd": float(redondear(vals["egresos"])),
                "netoUsd": float(redondear(vals["ingresos"] - vals["egresos"])),
                "movimientos": vals["movimientos"],
            }
            for cat, vals in por_cat.items()
        ),
        key=lambda x: (-(x["ingresosUsd"] + x["egresosUsd"]), x["categoria"]),
    )

    flujo_neto = redondear(total_ingresos - total_egresos)
    saldo_final = redondear(saldo_inicial_usd + flujo_neto)

    return {
        "desde": desde.isoformat(),
        "hasta": hasta.isoformat(),
        "agrupacion": agrupacion,
        "saldoInicialUsd": float(saldo_inicial_usd),
        "totalIngresosUsd": float(redondear(total_ingresos)),
        "totalEgresosUsd": float(redondear(total_egresos)),
        "flujoNetoUsd": float(flujo_neto),
        "saldoFinalUsd": float(saldo_final),
        "series": series,
        "porCategoria": categorias,
    }


def flujo_de_caja_excel(reporte: dict, empresa: dict) -> io.BytesIO:
    """Genera un archivo `.xlsx` con el resumen, la serie temporal y el
    desglose por categoría del flujo de caja."""
    libro = openpyxl.Workbook()
    hoja = libro.active
    hoja.title = "Flujo de Caja"

    negrita = Font(bold=True)
    titulo_font = Font(bold=True, size=13)
    relleno_enc = PatternFill(start_color="E2E8F0", end_color="E2E8F0", fill_type="solid")

    razon = empresa.get("razonSocial") or empresa.get("codigo") or ""
    rif = empresa.get("rif") or "sin RIF"
    hoja.append([f"Flujo de Caja — {razon} ({rif})"])
    hoja["A1"].font = titulo_font
    hoja.append([f"Período: {reporte['desde']} a {reporte['hasta']} (agrupación: {reporte['agrupacion']})"])
    hoja.append([])

    hoja.append(["Indicador", "Monto (USD)"])
    for col in ("A", "B"):
        hoja[f"{col}4"].font = negrita
        hoja[f"{col}4"].fill = relleno_enc

    kpis = [
        ("Saldo inicial (USD)", reporte["saldoInicialUsd"]),
        ("Total ingresos (USD)", reporte["totalIngresosUsd"]),
        ("Total egresos (USD)", reporte["totalEgresosUsd"]),
        ("Flujo neto (USD)", reporte["flujoNetoUsd"]),
        ("Saldo final (USD)", reporte["saldoFinalUsd"]),
    ]
    for etiqueta, valor in kpis:
        hoja.append([etiqueta, valor])
        hoja.cell(row=hoja.max_row, column=2).number_format = "#,##0.00"

    hoja.append([])
    hoja.append(["Período", "Ingresos (USD)", "Egresos (USD)", "Flujo Neto (USD)", "Saldo Acumulado (USD)"])
    fila_enc_serie = hoja.max_row
    for col_idx in range(1, 6):
        c = hoja.cell(row=fila_enc_serie, column=col_idx)
        c.font = negrita
        c.fill = relleno_enc
        if col_idx > 1:
            c.alignment = Alignment(horizontal="right")

    for s in reporte["series"]:
        hoja.append([s["periodo"], s["ingresosUsd"], s["egresosUsd"], s["netoUsd"], s["saldoAcumuladoUsd"]])
        for col_idx in range(2, 6):
            hoja.cell(row=hoja.max_row, column=col_idx).number_format = "#,##0.00"

    # Segunda hoja: Por categoría
    hoja_cat = libro.create_sheet("Por Categoría")
    hoja_cat.append(["Categoría", "Ingresos (USD)", "Egresos (USD)", "Neto (USD)", "Movimientos"])
    for col_idx in range(1, 6):
        c = hoja_cat.cell(row=1, column=col_idx)
        c.font = negrita
        c.fill = relleno_enc
    for cat in reporte["porCategoria"]:
        hoja_cat.append([cat["categoria"], cat["ingresosUsd"], cat["egresosUsd"], cat["netoUsd"], cat["movimientos"]])
        for col_idx in range(2, 5):
            hoja_cat.cell(row=hoja_cat.max_row, column=col_idx).number_format = "#,##0.00"

    for ws, anchos in (
        (hoja, (26, 18, 18, 18, 22)),
        (hoja_cat, (28, 18, 18, 18, 14)),
    ):
        for col_letra, ancho in zip("ABCDE", anchos):
            ws.column_dimensions[col_letra].width = ancho

    salida = io.BytesIO()
    libro.save(salida)
    salida.seek(0)
    return salida
