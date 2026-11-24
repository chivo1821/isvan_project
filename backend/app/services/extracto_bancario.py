"""Conciliación de estados de cuenta de bancos venezolanos (.xlsx y .csv).

Soporta los formatos habituales de banca en línea empresarial y personal en
Venezuela (Banesco, Mercantil, Banco de Venezuela / BDV, BBVA Provincial, BNC,
Bancamiga, Banplus, BFC, Banco Plaza, Banco Exterior, Venezolano de Crédito,
Bancaribe, etc.):
- Archivos `.xlsx` y `.csv` (separador `,`, `;`, tabulador o `|`; codificaciones
  UTF-8 con/sin BOM, CP1252 y Latin-1).
- Detección automática de la fila de encabezados en las primeras 20 filas
  (saltando metadatos del banco, RIF, número de cuenta y saldos de cabecera).
- Decimales venezolanos (`1.234.567,89`), anglosajones (`1,234,567.89`), signos
  al final (`1.250,00-`), paréntesis contables `(1.250,00)` y columnas únicas
  (`Monto` con o sin columna `Tipo` D/C/ND/NC) o separadas (`Débito`/`Crédito`,
  `Cargos`/`Abonos`, `Debe`/`Haber`).
- Cruce en ventana de ±3 días contra `MovimientoBancario` activos de la cuenta
  y contra `Gasto` (`GastoCarga.estado = 'CONFIRMADA'`) de la empresa.
- Clasificación en `COINCIDE_MOVIMIENTO`, `COINCIDE_GASTO`, `SOLO_EN_BANCO` y
  `SOLO_EN_SISTEMA`, persistencia en `ConciliacionBancaria` y confirmación en
  lote con idempotencia sobre `gastoId`.
"""

from __future__ import annotations

import csv
import io
import re
import unicodedata
import uuid
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation

import openpyxl
from fastapi import HTTPException
from psycopg.types.json import Jsonb

from app.core.excel_utils import valor_a_texto
from app.core.fechas import ahora_utc
from app.services import bitacora, tesoreria
from app.services.tesoreria import CENTAVO, CERO, _iso_fecha, _iso_instante, obtener_tasa_fecha, redondear
from app.services.ventas import exigir_modulo

VENTANA_DIAS_CRUCE = 3
MAX_FILAS_ENCABEZADO = 20

ALIAS_COLUMNAS: dict[str, tuple[str, ...]] = {
    "fecha": (
        "fecha",
        "fec",
        "fecha_operacion",
        "fecha_de_operacion",
        "f_operacion",
        "f_op",
        "fecha_valor",
        "f_valor",
        "fecha_movimiento",
        "fecha_de_movimiento",
        "fecha_proceso",
        "fecha_transaccion",
        "fecha_contable",
        "dia",
        "date",
    ),
    "referencia": (
        "referencia",
        "ref",
        "nro_referencia",
        "num_referencia",
        "numero_referencia",
        "numero_de_referencia",
        "nro_de_referencia",
        "nro_ref",
        "num_ref",
        "comprobante",
        "nro_comprobante",
        "documento",
        "nro_documento",
        "num_documento",
        "numero_documento",
        "nro_doc",
        "num_doc",
        "serial",
        "nro_operacion",
        "num_operacion",
        "numero_operacion",
        "numero_de_operacion",
        "operacion",
        "control",
        "secuencia",
    ),
    "descripcion": (
        "descripcion",
        "concepto",
        "detalle",
        "detalles",
        "glosa",
        "observacion",
        "observaciones",
        "motivo",
        "narrativa",
        "descripcion_operacion",
        "descripcion_de_operacion",
        "descripcion_del_movimiento",
        "descripcion_movimiento",
        "detalle_operacion",
        "transaccion",
        "movimiento",
        "description",
    ),
    "monto": (
        "monto",
        "importe",
        "valor",
        "monto_bs",
        "monto_ves",
        "monto_usd",
        "monto_operacion",
        "monto_transaccion",
        "monto_total",
        "total",
        "amount",
    ),
    "debito": (
        "debito",
        "debitos",
        "cargo",
        "cargos",
        "egreso",
        "egresos",
        "debe",
        "salida",
        "salidas",
        "retiro",
        "retiros",
        "monto_debito",
        "monto_cargo",
        "debit",
    ),
    "credito": (
        "credito",
        "creditos",
        "abono",
        "abonos",
        "ingreso",
        "ingresos",
        "haber",
        "entrada",
        "entradas",
        "deposito",
        "depositos",
        "monto_credito",
        "monto_abono",
        "credit",
    ),
    "tipo": (
        "tipo",
        "naturaleza",
        "signo",
        "dc",
        "d_c",
        "ind",
        "indicador",
        "tipo_movimiento",
        "tipo_de_movimiento",
        "tipo_transaccion",
        "tipo_operacion",
        "cod_operacion",
    ),
    "saldo": (
        "saldo",
        "saldo_disponible",
        "saldo_contable",
        "saldo_final",
        "saldo_actual",
        "saldo_en_cuenta",
        "disponible",
        "balance",
    ),
}

INDICADORES_DEBITO = frozenset(
    {
        "d",
        "db",
        "dr",
        "deb",
        "debito",
        "debitos",
        "cargo",
        "cargos",
        "nd",
        "n_d",
        "nota_de_debito",
        "nota_debito",
        "egreso",
        "egresos",
        "salida",
        "retiro",
        "-",
    }
)
INDICADORES_CREDITO = frozenset(
    {
        "c",
        "cr",
        "cred",
        "credito",
        "creditos",
        "abono",
        "abonos",
        "nc",
        "n_c",
        "nota_de_credito",
        "nota_credito",
        "ingreso",
        "ingresos",
        "entrada",
        "deposito",
        "+",
    }
)

PALABRAS_RESUMEN_FILA = (
    "saldo inicial",
    "saldo anterior",
    "saldo final",
    "totales",
    "total general",
    "total movimientos",
)


@dataclass
class LineaExtracto:
    fecha: date
    referencia: str | None
    descripcion: str
    monto: Decimal
    saldo: Decimal | None


@dataclass
class ExtractoLeido:
    lineas: list[LineaExtracto]
    periodo_desde: date
    periodo_hasta: date
    saldo_final: Decimal | None


def _normalizar_clave(valor: object) -> str:
    texto = str(valor or "").strip().lower()
    sin_acentos = "".join(
        c for c in unicodedata.normalize("NFD", texto) if unicodedata.category(c) != "Mn"
    )
    limpio = re.sub(r"[^a-z0-9]+", "_", sin_acentos).strip("_")
    return limpio


def parsear_monto_venezolano(valor: object) -> Decimal | None:
    """Convierte montos con formato venezolano (`1.234,56`, `1.234,56-`,
    `(1.234,56)`, `Bs. 1.234,56`) o anglosajón (`1,234.56`) a `Decimal`."""
    if valor is None or isinstance(valor, bool):
        return None
    if isinstance(valor, Decimal):
        return redondear(valor)
    if isinstance(valor, (int, float)):
        return redondear(Decimal(str(valor)))

    texto = str(valor).replace("\xa0", " ").strip()
    if not texto or texto in {"-", "--", "—", "N/A", "n/a"}:
        return None

    negativo = False
    if texto.startswith("(") and texto.endswith(")"):
        negativo = True
        texto = texto[1:-1].strip()

    # Detectar sufijos contables tipo "1.250,00-" o "1.250,00 DB" / "CR"
    m_sufijo = re.search(r"\b(DB|DR|DEBITO|DÉBITO|CR|CREDITO|CRÉDITO)\s*$", texto, re.IGNORECASE)
    if m_sufijo:
        etiqueta = _normalizar_clave(m_sufijo.group(1))
        if etiqueta in {"db", "dr", "debito"}:
            negativo = True
        texto = texto[: m_sufijo.start()].strip()

    if texto.endswith("-"):
        negativo = True
        texto = texto[:-1].strip()
    elif texto.endswith("+"):
        texto = texto[:-1].strip()

    if texto.startswith("-"):
        negativo = True
        texto = texto[1:].strip()
    elif texto.startswith("+"):
        texto = texto[1:].strip()

    # Quitar símbolos de moneda (Bs., Bs.S, VES, USD, US$, $)
    texto = re.sub(r"(?i)\b(bs\.?s?|ves|usd|bolivares|bolívares)\b", "", texto)
    texto = texto.replace("US$", "").replace("$", "").replace(" ", "").strip(".")
    if not texto:
        return None

    if "," in texto and "." in texto:
        if texto.rfind(",") > texto.rfind("."):
            texto = texto.replace(".", "").replace(",", ".")
        else:
            texto = texto.replace(",", "")
    elif "," in texto:
        if texto.count(",") == 1:
            texto = texto.replace(",", ".")
        else:
            texto = texto.replace(",", "")
    elif texto.count(".") > 1:
        # Ej. "1.250.000" sin decimales en formato venezolano
        texto = texto.replace(".", "")

    try:
        numero = Decimal(texto)
    except InvalidOperation:
        return None
    if not numero.is_finite():
        return None
    resultado = redondear(-abs(numero) if negativo else numero)
    return resultado


def _parsear_fecha_celda(valor: object) -> date | None:
    if valor is None or isinstance(valor, bool):
        return None
    if isinstance(valor, datetime):
        return valor.date()
    if isinstance(valor, date):
        return valor
    if isinstance(valor, (int, float)) and 35000 <= float(valor) <= 65000:
        return date(1899, 12, 30) + timedelta(days=int(valor))

    texto = valor_a_texto(valor).replace("\xa0", " ").strip()
    if not texto:
        return None

    # Tomar la parte de fecha si trae hora ("24/11/2026 14:22:10" o "2026-11-24T...")
    token = texto.split("T")[0].split(" ")[0].strip()
    for fmt in (
        "%d/%m/%Y",
        "%d-%m-%Y",
        "%Y-%m-%d",
        "%d/%m/%y",
        "%d-%m-%y",
        "%d.%m.%Y",
        "%Y/%m/%d",
    ):
        try:
            d = datetime.strptime(token, fmt).date()
            if 2000 <= d.year <= 2100:
                return d
        except ValueError:
            continue
    return None


def _detectar_encabezados(filas: list[list[object] | tuple[object, ...]]) -> tuple[int, dict[str, int]] | None:
    """Busca en las primeras 20 filas la mejor fila de encabezados."""
    mejor: tuple[int, int, dict[str, int]] | None = None

    for idx_fila, fila in enumerate(filas[:MAX_FILAS_ENCABEZADO]):
        por_nombre: dict[str, int] = {}
        for col_idx, celda in enumerate(fila):
            if celda is None:
                continue
            clave = _normalizar_clave(celda)
            if clave and clave not in por_nombre:
                por_nombre[clave] = col_idx

        if not por_nombre:
            continue

        mapa: dict[str, int] = {}
        usadas: set[int] = set()
        for campo, lista_alias in ALIAS_COLUMNAS.items():
            for alias in lista_alias:
                col_i = por_nombre.get(alias)
                if col_i is not None and col_i not in usadas:
                    mapa[campo] = col_i
                    usadas.add(col_i)
                    break

        tiene_fecha = "fecha" in mapa
        tiene_monto = "monto" in mapa or ("debito" in mapa or "credito" in mapa)
        if not (tiene_fecha and tiene_monto):
            continue

        puntaje = 10
        if "descripcion" in mapa:
            puntaje += 4
        if "referencia" in mapa:
            puntaje += 4
        if "debito" in mapa and "credito" in mapa:
            puntaje += 3
        if "saldo" in mapa:
            puntaje += 2

        if mejor is None or puntaje > mejor[0]:
            mejor = (puntaje, idx_fila, mapa)

    if mejor is None:
        return None
    return mejor[1], mejor[2]


def _decodificar_texto_csv(contenido: bytes) -> str:
    for enc in ("utf-8-sig", "utf-8", "cp1252", "latin-1"):
        try:
            return contenido.decode(enc)
        except UnicodeDecodeError:
            continue
    return contenido.decode("latin-1", errors="replace")


def _leer_filas_csv(contenido: bytes) -> list[list[object]]:
    texto = _decodificar_texto_csv(contenido)
    lineas_crudas = [ln for ln in texto.splitlines() if ln.strip()]
    if not lineas_crudas:
        raise HTTPException(400, "El archivo CSV está vacío")

    candidatos_sep = (";", "\t", ",", "|")
    mejor_filas: list[list[object]] | None = None
    mejor_puntaje = -1

    for sep in candidatos_sep:
        lector = csv.reader(io.StringIO(texto), delimiter=sep)
        filas = [fila for fila in lector if any(str(c or "").strip() for c in fila)]
        if not filas:
            continue
        enc = _detectar_encabezados(filas)
        if enc is not None:
            # Preferir el separador que detecta encabezados con más columnas reconocidas
            puntaje = 100 + len(enc[1]) * 10
        else:
            anchos = [len(f) for f in filas[:MAX_FILAS_ENCABEZADO]]
            max_ancho = max(anchos, default=0)
            puntaje = max_ancho if max_ancho >= 3 else 0
        if puntaje > mejor_puntaje:
            mejor_puntaje = puntaje
            mejor_filas = filas

    return mejor_filas or []


def _leer_filas_xlsx(contenido: bytes) -> list[list[object]]:
    try:
        libro = openpyxl.load_workbook(io.BytesIO(contenido), read_only=True, data_only=True)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, "No se pudo abrir el archivo Excel (.xlsx). Verifica que sea un archivo válido.") from e

    primera_no_vacia: list[list[object]] = []
    try:
        for hoja in libro.worksheets:
            filas = [
                list(f)
                for f in hoja.iter_rows(values_only=True)
                if any(c is not None and str(c).strip() != "" for c in f)
            ]
            if not filas:
                continue
            if not primera_no_vacia:
                primera_no_vacia = filas
            if _detectar_encabezados(filas) is not None:
                return filas
    finally:
        libro.close()
    return primera_no_vacia


def _celda(fila: list[object] | tuple[object, ...], idx: int | None) -> object:
    if idx is None or idx >= len(fila):
        return None
    return fila[idx]


def _extraer_monto_fila(fila: list[object] | tuple[object, ...], mapa: dict[str, int]) -> Decimal | None:
    tiene_deb_cred = "debito" in mapa or "credito" in mapa
    if tiene_deb_cred:
        deb = parsear_monto_venezolano(_celda(fila, mapa.get("debito")))
        cred = parsear_monto_venezolano(_celda(fila, mapa.get("credito")))
        deb_val = abs(deb) if deb is not None else CERO
        cred_val = abs(cred) if cred is not None else CERO
        if deb_val > CERO and cred_val == CERO:
            return -deb_val
        if cred_val > CERO and deb_val == CERO:
            return cred_val
        if cred_val > CERO or deb_val > CERO:
            neto = redondear(cred_val - deb_val)
            return neto if neto != CERO else None
        if "monto" not in mapa:
            return None

    monto = parsear_monto_venezolano(_celda(fila, mapa.get("monto")))
    if monto is None or monto == CERO:
        return None

    if "tipo" in mapa and monto > CERO:
        ind = _normalizar_clave(_celda(fila, mapa["tipo"]))
        if ind in INDICADORES_DEBITO or ind.startswith("nd_") or ind.startswith("debito") or ind.startswith("cargo"):
            return -abs(monto)
        if ind in INDICADORES_CREDITO or ind.startswith("nc_") or ind.startswith("credito") or ind.startswith("abono"):
            return abs(monto)

    return monto


def _determinar_saldo_final(lineas: list[LineaExtracto]) -> Decimal | None:
    con_saldo = [ln for ln in lineas if ln.saldo is not None]
    if not con_saldo:
        return None
    if len(con_saldo) == 1:
        return con_saldo[0].saldo

    # Si las fechas vienen en orden descendente (típico Banesco/Mercantil online),
    # el movimiento más reciente está arriba; si es ascendente, está al final.
    if lineas[0].fecha > lineas[-1].fecha:
        return con_saldo[0].saldo
    if lineas[0].fecha < lineas[-1].fecha:
        return con_saldo[-1].saldo

    # Misma fecha en extremos: verificar relación aritmética entre fila 0 y fila 1
    if (
        len(lineas) >= 2
        and lineas[0].saldo is not None
        and lineas[1].saldo is not None
    ):
        if redondear(lineas[1].saldo + lineas[0].monto) == lineas[0].saldo:
            return lineas[0].saldo
    return con_saldo[-1].saldo


def parsear_extracto(contenido: bytes, nombre_archivo: str) -> ExtractoLeido:
    """Lee un extracto bancario `.xlsx` o `.csv` y devuelve sus líneas normalizadas."""
    if not contenido:
        raise HTTPException(400, "El archivo subido está vacío")

    nombre_bajo = (nombre_archivo or "").lower().strip()
    if nombre_bajo.endswith(".xls") and not nombre_bajo.endswith(".xlsx"):
        # Si es un CSV renombrado a .xls por el banco (muy común en bancos venezolanos), intentar texto si no es binario BIFF
        if contenido[:4] == b"\xd0\xcf\x11\xe0":
            raise HTTPException(
                400,
                "El archivo está en formato Excel antiguo (.xls). Guárdalo como .xlsx o .csv antes de subirlo.",
            )
        filas = _leer_filas_csv(contenido)
    elif nombre_bajo.endswith(".xlsx") or contenido[:2] == b"PK":
        filas = _leer_filas_xlsx(contenido)
    else:
        filas = _leer_filas_csv(contenido)

    deteccion = _detectar_encabezados(filas)
    if deteccion is None:
        raise HTTPException(
            400,
            "No se encontraron columnas válidas de estado de cuenta (Fecha y Monto o Débito/Crédito) "
            "en las primeras 20 filas del archivo.",
        )

    fila_enc_idx, mapa = deteccion
    lineas: list[LineaExtracto] = []

    for fila in filas[fila_enc_idx + 1 :]:
        fecha = _parsear_fecha_celda(_celda(fila, mapa.get("fecha")))
        if fecha is None:
            continue

        desc_raw = valor_a_texto(_celda(fila, mapa.get("descripcion"))).strip()
        tipo_raw = valor_a_texto(_celda(fila, mapa.get("tipo"))).strip()
        descripcion = " ".join((desc_raw or tipo_raw or "Movimiento bancario").split())[:300]

        desc_lower = descripcion.lower()
        monto = _extraer_monto_fila(fila, mapa)
        if monto is None or monto == CERO:
            continue
        if any(p in desc_lower for p in PALABRAS_RESUMEN_FILA) and _celda(fila, mapa.get("referencia")) in (None, ""):
            continue

        ref_raw = valor_a_texto(_celda(fila, mapa.get("referencia"))).strip()
        referencia = ref_raw[:100] if ref_raw and ref_raw not in {"-", "--", "0"} else None
        saldo = parsear_monto_venezolano(_celda(fila, mapa.get("saldo")))

        lineas.append(
            LineaExtracto(
                fecha=fecha,
                referencia=referencia,
                descripcion=descripcion,
                monto=monto,
                saldo=saldo,
            )
        )

    if not lineas:
        raise HTTPException(400, "El archivo no contiene movimientos bancarios válidos para conciliar")

    fechas = [ln.fecha for ln in lineas]
    return ExtractoLeido(
        lineas=lineas,
        periodo_desde=min(fechas),
        periodo_hasta=max(fechas),
        saldo_final=_determinar_saldo_final(lineas),
    )


# ---------- Cruce y Conciliación ----------


def _ref_limpia(ref: str | None) -> str:
    if not ref:
        return ""
    solo_alnum = re.sub(r"[^A-Za-z0-9]", "", ref).upper()
    sin_ceros = solo_alnum.lstrip("0")
    return sin_ceros or solo_alnum


def _puntaje_referencia(ref_banco: str | None, ref_sistema: str | None) -> int:
    rb = _ref_limpia(ref_banco)
    rs = _ref_limpia(ref_sistema)
    if not rb or not rs or len(rb) < 4 or len(rs) < 4:
        return 0
    if rb == rs:
        return 100
    menor, mayor = (rb, rs) if len(rb) <= len(rs) else (rs, rb)
    if len(menor) >= 6 and mayor.endswith(menor):
        return 65
    if len(menor) >= 5 and menor in mayor:
        return 40
    return 0


def _inferir_metodo(descripcion: str) -> str:
    d = _normalizar_clave(descripcion)
    if any(k in d for k in ("igtf", "comision", "comis", "mantenimiento")):
        return "COMISION_IGTF"
    if any(k in d for k in ("pago_movil", "pagomovil", "pmovil", "p2p", "p2c", "c2p")):
        return "PAGO_MOVIL"
    if any(k in d for k in ("pos", "punto_de_venta", "tdd", "tdc", "maestro", "liquidacion_pos")):
        return "POS"
    if "zelle" in d:
        return "ZELLE"
    if "cheque" in d or d.startswith("chq"):
        return "CHEQUE"
    if "efectivo" in d or "taquilla" in d:
        return "EFECTIVO"
    return "TRANSFERENCIA"


def _mapear_categoria_gasto(categoria_gasto: str | None, descripcion: str = "") -> str:
    c = _normalizar_clave(categoria_gasto or "")
    d = _normalizar_clave(descripcion)
    texto = f"{c}_{d}"
    if any(k in texto for k in ("nomina", "sueldo", "salario", "quincena", "bono")):
        return "NOMINA"
    if any(k in texto for k in ("flete", "delivery", "transporte", "motorizado", "despacho")):
        return "DELIVERY"
    if any(k in texto for k in ("igtf", "impuesto", "seniat", "iva", "islr", "retencion", "alcaldia")):
        return "IMPUESTOS_IGTF"
    if any(k in texto for k in ("inventario", "mercancia", "compra_producto")):
        return "COMPRA_INVENTARIO"
    return "GASTO_OPERATIVO"


def _categoria_solo_en_banco(monto: Decimal, descripcion: str) -> str:
    if monto > CERO:
        return "COBRANZA_CLIENTES" if "cobranza" in _normalizar_clave(descripcion) else "OTRO"
    d = _normalizar_clave(descripcion)
    if any(k in d for k in ("igtf", "comision", "comis", "impuesto", "seniat")):
        return "IMPUESTOS_IGTF"
    return "GASTO_OPERATIVO"


def conciliacion_json(fila: dict) -> dict:
    return {
        "id": fila["id"],
        "empresaId": fila["empresaId"],
        "cuentaId": fila["cuentaId"],
        "cuentaNombre": fila.get("cuentaNombre"),
        "archivo": fila["archivo"],
        "periodoDesde": _iso_fecha(fila["periodoDesde"]),
        "periodoHasta": _iso_fecha(fila["periodoHasta"]),
        "saldoExtractoFinal": float(redondear(Decimal(fila["saldoExtractoFinal"])))
        if fila.get("saldoExtractoFinal") is not None
        else None,
        "estado": fila["estado"],
        "resumen": fila["resumen"],
        "lineas": fila["lineas"],
        "creadaEn": _iso_instante(fila["creadaEn"]),
        "confirmadaEn": _iso_instante(fila.get("confirmadaEn")),
    }


def obtener_conciliacion(cur, conc_id: str, *, empresa_id: str | None = None) -> dict:
    cur.execute(
        """
        SELECT cb.*, c."nombre" AS "cuentaNombre"
          FROM "ConciliacionBancaria" cb
          JOIN "CuentaTesoreria" c ON c."id" = cb."cuentaId"
         WHERE cb."id" = %s
        """,
        (conc_id,),
    )
    fila = cur.fetchone()
    if not fila or (empresa_id and fila["empresaId"] != empresa_id):
        raise HTTPException(404, "Conciliación bancaria no encontrada")
    return conciliacion_json(fila)


def listar_conciliaciones(
    cur,
    *,
    empresa_id: str,
    cuenta_id: str | None = None,
    limite: int = 100,
) -> list[dict]:
    exigir_modulo(cur, empresa_id, "bancos")
    condiciones = ['cb."empresaId" = %s']
    params: list[object] = [empresa_id]
    if cuenta_id:
        condiciones.append('cb."cuentaId" = %s')
        params.append(cuenta_id)
    params.append(min(max(limite, 1), 500))
    cur.execute(
        f"""
        SELECT cb.*, c."nombre" AS "cuentaNombre"
          FROM "ConciliacionBancaria" cb
          JOIN "CuentaTesoreria" c ON c."id" = cb."cuentaId"
         WHERE {" AND ".join(condiciones)}
         ORDER BY cb."creadaEn" DESC
         LIMIT %s
        """,
        tuple(params),
    )
    return [conciliacion_json(f) for f in cur.fetchall()]


def analizar_extracto(
    cur,
    *,
    empresa_id: str,
    cuenta_id: str,
    nombre_archivo: str,
    contenido: bytes,
    usuario_id: str,
) -> dict:
    """Parsea el extracto bancario, lo cruza contra `MovimientoBancario` y
    `Gasto` confirmados (±3 días) y guarda el borrador en `ConciliacionBancaria`."""
    exigir_modulo(cur, empresa_id, "bancos")
    cuenta = tesoreria.obtener_cuenta(cur, cuenta_id, empresa_id=empresa_id)
    cur.execute('SELECT "codigo", "organizacionId" FROM "EmpresaFiscal" WHERE "id" = %s', (empresa_id,))
    emp_fila = cur.fetchone()
    if not emp_fila:
        raise HTTPException(404, "Empresa fiscal no encontrada")

    empresa_codigo = emp_fila["codigo"]
    organizacion_id = emp_fila.get("organizacionId") or cuenta.get("organizacionId", "org-principal")
    moneda_cuenta = cuenta["moneda"]

    extracto = parsear_extracto(contenido, nombre_archivo)
    desde_busq = extracto.periodo_desde - timedelta(days=VENTANA_DIAS_CRUCE)
    hasta_busq = extracto.periodo_hasta + timedelta(days=VENTANA_DIAS_CRUCE)

    # 1. Movimientos bancarios activos de la cuenta en el período ±3 días
    cur.execute(
        """
        SELECT "id", "fecha", "tipo", "metodo", "categoria", "concepto", "tercero",
               "referencia", "monto", "montoUsd", "montoBs", "gastoId", "pagoId", "conciliado"
          FROM "MovimientoBancario"
         WHERE "cuentaId" = %s
           AND "anuladoEn" IS NULL
           AND "reversoDeId" IS NULL
           AND "fecha" BETWEEN %s AND %s
         ORDER BY "fecha" ASC, "id" ASC
        """,
        (cuenta_id, desde_busq, hasta_busq),
    )
    movs_sistema = cur.fetchall()

    # 2. Gastos confirmados de la empresa en el período ±3 días que aún no tengan MovimientoBancario activo
    cur.execute(
        """
        SELECT g."id", g."fecha", g."categoria", g."descripcion", g."proveedor",
               g."referencia", g."numeroDocumentoProveedor", g."montoUsd", g."montoBs",
               g."moneda", g."tasa", g."banco"
          FROM "Gasto" g
          JOIN "GastoCarga" gc ON gc."id" = g."cargaId" AND gc."estado" = 'CONFIRMADA'
         WHERE g."empresa"::text = %s
           AND g."fecha" BETWEEN %s AND %s
           AND NOT EXISTS (
               SELECT 1
                 FROM "MovimientoBancario" mb
                WHERE mb."gastoId" = g."id"
                  AND mb."anuladoEn" IS NULL
           )
         ORDER BY g."fecha" ASC, g."id" ASC
        """,
        (empresa_codigo, desde_busq, hasta_busq),
    )
    gastos_sistema = cur.fetchall()

    # Emparejamiento 1: líneas de banco vs MovimientoBancario
    candidatos_mov: list[tuple[int, int, int]] = []
    for idx_b, ln in enumerate(extracto.lineas):
        for idx_m, m in enumerate(movs_sistema):
            monto_m = redondear(Decimal(m["monto"]))
            # Mismo signo y monto idéntico (tolerancia 0.02 en moneda de la cuenta)
            if (ln.monto > CERO) != (monto_m > CERO):
                continue
            diff_monto = abs(ln.monto - monto_m)
            if diff_monto > Decimal("0.02"):
                continue
            diff_dias = abs((ln.fecha - m["fecha"]).days)
            if diff_dias > VENTANA_DIAS_CRUCE:
                continue

            pts_ref = _puntaje_referencia(ln.referencia, m["referencia"])
            pts = (
                100
                + pts_ref
                + (20 if not m["conciliado"] else 0)
                + (VENTANA_DIAS_CRUCE - diff_dias) * 6
                + (5 if diff_monto == CERO else 0)
            )
            candidatos_mov.append((pts, idx_b, idx_m))

    candidatos_mov.sort(key=lambda t: (-t[0], t[1], t[2]))
    banco_a_mov: dict[int, dict] = {}
    movs_usados: set[int] = set()
    for _, idx_b, idx_m in candidatos_mov:
        if idx_b in banco_a_mov or idx_m in movs_usados:
            continue
        banco_a_mov[idx_b] = movs_sistema[idx_m]
        movs_usados.add(idx_m)

    # Emparejamiento 2: egresos de banco sin MovimientoBancario vs Gasto confirmado
    candidatos_gasto: list[tuple[int, int, int]] = []
    cache_tasas: dict[date, Decimal | None] = {}

    def _tasa_dia(f: date) -> Decimal | None:
        if f not in cache_tasas:
            cache_tasas[f] = obtener_tasa_fecha(cur, f)
        return cache_tasas[f]

    for idx_b, ln in enumerate(extracto.lineas):
        if idx_b in banco_a_mov or ln.monto >= CERO:
            continue
        abs_banco = abs(ln.monto)
        desc_norm = _normalizar_clave(ln.descripcion)

        for idx_g, g in enumerate(gastos_sistema):
            diff_dias = abs((ln.fecha - g["fecha"]).days)
            if diff_dias > VENTANA_DIAS_CRUCE:
                continue

            pts_ref = max(
                _puntaje_referencia(ln.referencia, g["referencia"]),
                _puntaje_referencia(ln.referencia, g.get("numeroDocumentoProveedor")),
            )

            g_usd = redondear(Decimal(g["montoUsd"]))
            g_bs = redondear(Decimal(g["montoBs"])) if g.get("montoBs") is not None else None

            coincide_monto = False
            exactitud_pts = 0
            if moneda_cuenta == "USD":
                diff = abs(abs_banco - g_usd)
                tol = Decimal("0.05") if pts_ref == 0 else max(Decimal("0.50"), redondear(g_usd * Decimal("0.01")))
                if diff <= tol:
                    coincide_monto = True
                    exactitud_pts = 35 if diff <= Decimal("0.02") else 15
            else:
                # Cuenta en VES
                if g_bs is not None and g_bs > CERO:
                    diff = abs(abs_banco - g_bs)
                    tol = max(Decimal("0.50"), redondear(g_bs * Decimal("0.002")))
                    if pts_ref >= 65:
                        tol = max(tol, redondear(g_bs * Decimal("0.02")))
                    if diff <= tol:
                        coincide_monto = True
                        exactitud_pts = 35 if diff <= Decimal("0.10") else 18
                else:
                    tasa_ref = Decimal(str(g["tasa"])) if g.get("tasa") else _tasa_dia(ln.fecha)
                    if tasa_ref and tasa_ref > CERO:
                        estimado_bs = redondear(g_usd * tasa_ref)
                        diff = abs(abs_banco - estimado_bs)
                        tol_pct = Decimal("0.03") if pts_ref >= 65 else Decimal("0.01")
                        tol = max(Decimal("1.00"), redondear(estimado_bs * tol_pct))
                        if diff <= tol:
                            coincide_monto = True
                            exactitud_pts = 20

            if not coincide_monto:
                continue

            prov_norm = _normalizar_clave(g.get("proveedor") or "")
            pts_prov = 25 if (prov_norm and len(prov_norm) >= 4 and prov_norm in desc_norm) else 0
            pts = 80 + pts_ref + exactitud_pts + pts_prov + (VENTANA_DIAS_CRUCE - diff_dias) * 5
            candidatos_gasto.append((pts, idx_b, idx_g))

    candidatos_gasto.sort(key=lambda t: (-t[0], t[1], t[2]))
    banco_a_gasto: dict[int, dict] = {}
    gastos_usados: set[int] = set()
    for _, idx_b, idx_g in candidatos_gasto:
        if idx_b in banco_a_gasto or idx_g in gastos_usados:
            continue
        banco_a_gasto[idx_b] = gastos_sistema[idx_g]
        gastos_usados.add(idx_g)

    # Construir líneas de conciliación
    lineas_json: list[dict] = []
    n_mov = 0
    n_gasto = 0
    n_solo_banco = 0
    total_ingresos_banco = CERO
    total_egresos_banco = CERO

    for idx_b, ln in enumerate(extracto.lineas):
        if ln.monto > CERO:
            total_ingresos_banco += ln.monto
        else:
            total_egresos_banco += abs(ln.monto)

        mov_match = banco_a_mov.get(idx_b)
        gasto_match = banco_a_gasto.get(idx_b)

        if mov_match is not None:
            estado = "COINCIDE_MOVIMIENTO"
            mov_id = int(mov_match["id"])
            gasto_id = mov_match.get("gastoId")
            gasto_resumen = None
            n_mov += 1
        elif gasto_match is not None:
            estado = "COINCIDE_GASTO"
            mov_id = None
            gasto_id = gasto_match["id"]
            gasto_resumen = {
                "id": gasto_match["id"],
                "fecha": _iso_fecha(gasto_match["fecha"]),
                "categoria": gasto_match["categoria"],
                "proveedor": gasto_match.get("proveedor"),
                "referencia": gasto_match.get("referencia"),
                "montoUsd": float(redondear(Decimal(gasto_match["montoUsd"]))),
                "montoBs": float(redondear(Decimal(gasto_match["montoBs"])))
                if gasto_match.get("montoBs") is not None
                else None,
            }
            n_gasto += 1
        else:
            estado = "SOLO_EN_BANCO"
            mov_id = None
            gasto_id = None
            gasto_resumen = None
            n_solo_banco += 1

        lineas_json.append(
            {
                "indice": idx_b + 1,
                "fecha": _iso_fecha(ln.fecha),
                "referencia": ln.referencia,
                "descripcion": ln.descripcion,
                "monto": float(ln.monto),
                "saldo": float(ln.saldo) if ln.saldo is not None else None,
                "estado": estado,
                "movimientoId": mov_id,
                "gastoId": gasto_id,
                "gastoResumen": gasto_resumen,
            }
        )

    # 4. SOLO_EN_SISTEMA: movimientos activos no conciliados dentro del período exacto del extracto que no cruzaron
    n_solo_sistema = 0
    siguiente_indice = len(lineas_json) + 1
    for idx_m, m in enumerate(movs_sistema):
        if idx_m in movs_usados or m["conciliado"]:
            continue
        if not (extracto.periodo_desde <= m["fecha"] <= extracto.periodo_hasta):
            continue
        n_solo_sistema += 1
        lineas_json.append(
            {
                "indice": siguiente_indice,
                "fecha": _iso_fecha(m["fecha"]),
                "referencia": m.get("referencia"),
                "descripcion": m["concepto"],
                "monto": float(redondear(Decimal(m["monto"]))),
                "saldo": None,
                "estado": "SOLO_EN_SISTEMA",
                "movimientoId": int(m["id"]),
                "gastoId": m.get("gastoId"),
                "gastoResumen": None,
            }
        )
        siguiente_indice += 1

    resumen = {
        "totalLineasBanco": len(extracto.lineas),
        "coincideMovimiento": n_mov,
        "coincideGasto": n_gasto,
        "soloEnBanco": n_solo_banco,
        "soloEnSistema": n_solo_sistema,
        "totalEgresosBanco": float(redondear(total_egresos_banco)),
        "totalIngresosBanco": float(redondear(total_ingresos_banco)),
    }

    conc_id = f"conc-{uuid.uuid4().hex[:14]}"
    ahora = ahora_utc()
    archivo_limpio = (nombre_archivo or "extracto.xlsx").strip()[:200]

    cur.execute(
        """
        INSERT INTO "ConciliacionBancaria"
            ("id", "organizacionId", "empresaId", "cuentaId", "archivo",
             "periodoDesde", "periodoHasta", "saldoExtractoFinal", "estado",
             "resumen", "lineas", "creadaPorId", "creadaEn")
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 'BORRADOR', %s, %s, %s, %s)
        """,
        (
            conc_id,
            organizacion_id,
            empresa_id,
            cuenta_id,
            archivo_limpio,
            extracto.periodo_desde,
            extracto.periodo_hasta,
            extracto.saldo_final,
            Jsonb(resumen),
            Jsonb(lineas_json),
            usuario_id,
            ahora,
        ),
    )

    creada = obtener_conciliacion(cur, conc_id)
    bitacora.registrar(
        cur,
        usuario_id,
        "ConciliacionBancaria",
        conc_id,
        "analizar",
        None,
        {"archivo": archivo_limpio, "cuentaId": cuenta_id, "resumen": resumen},
        organizacion_id=organizacion_id,
    )
    return creada


def confirmar_conciliacion(
    cur,
    *,
    conc_id: str,
    empresa_id: str | None = None,
    lineas_seleccionadas: list[int] | None = None,
    registrar_faltantes: bool = True,
    usuario_id: str,
) -> dict:
    """Confirma una conciliación en borrador: marca como conciliados los
    movimientos cruzados y crea los asientos faltantes seleccionados (con
    idempotencia garantizada en `gastoId`)."""
    cur.execute('SELECT * FROM "ConciliacionBancaria" WHERE "id" = %s FOR UPDATE', (conc_id,))
    conc = cur.fetchone()
    if not conc or (empresa_id and conc["empresaId"] != empresa_id):
        raise HTTPException(404, "Conciliación bancaria no encontrada")

    emp_id = conc["empresaId"]
    exigir_modulo(cur, emp_id, "bancos")
    if conc["estado"] == "CONFIRMADA":
        raise HTTPException(409, "Esta conciliación bancaria ya fue confirmada")

    lineas: list[dict] = list(conc["lineas"] or [])
    if lineas_seleccionadas is None:
        estados_auto = {"COINCIDE_MOVIMIENTO", "COINCIDE_GASTO"}
        if registrar_faltantes:
            estados_auto.add("SOLO_EN_BANCO")
        seleccion = {int(ln["indice"]) for ln in lineas if ln.get("estado") in estados_auto}
    else:
        if len(lineas_seleccionadas) == 0:
            raise HTTPException(400, "Selecciona al menos una línea para confirmar la conciliación")
        seleccion = {int(i) for i in lineas_seleccionadas}

    cuenta = tesoreria.obtener_cuenta(cur, conc["cuentaId"], empresa_id=emp_id, bloquear=True)
    ahora = ahora_utc()
    ids_a_conciliar: set[int] = set()
    creados = 0

    for ln in lineas:
        if int(ln["indice"]) not in seleccion:
            continue
        estado = ln.get("estado")

        if estado == "COINCIDE_MOVIMIENTO" and ln.get("movimientoId") is not None:
            ids_a_conciliar.add(int(ln["movimientoId"]))

        elif estado == "COINCIDE_GASTO" and ln.get("gastoId"):
            gasto_id = str(ln["gastoId"])
            # Idempotencia sobre gastoId: si ya existe un MovimientoBancario activo para este gasto, reutilizarlo.
            cur.execute(
                'SELECT "id", "cuentaId" FROM "MovimientoBancario" '
                'WHERE "gastoId" = %s AND "anuladoEn" IS NULL FOR UPDATE',
                (gasto_id,),
            )
            existente = cur.fetchone()
            if existente:
                ln["movimientoId"] = int(existente["id"])
                if existente["cuentaId"] == cuenta["id"]:
                    ids_a_conciliar.add(int(existente["id"]))
            else:
                monto_dec = redondear(Decimal(str(ln["monto"])))
                tipo_mov = "INGRESO" if monto_dec > CERO else "EGRESO"
                gasto_res = ln.get("gastoResumen") or {}
                nuevo = tesoreria.registrar_movimiento(
                    cur,
                    cuenta_id=cuenta["id"],
                    empresa_id=emp_id,
                    fecha=date.fromisoformat(ln["fecha"]),
                    tipo=tipo_mov,
                    metodo=_inferir_metodo(ln.get("descripcion") or ""),
                    categoria=_mapear_categoria_gasto(gasto_res.get("categoria"), ln.get("descripcion") or ""),
                    concepto=(ln.get("descripcion") or "Pago de gasto conciliado")[:300],
                    tercero=gasto_res.get("proveedor"),
                    referencia=ln.get("referencia") or gasto_res.get("referencia"),
                    monto=abs(monto_dec),
                    gasto_id=gasto_id,
                    conciliado=True,
                    usuario_id=usuario_id,
                    verificar_modulo=False,
                    cuenta_bloqueada=cuenta,
                )
                ln["movimientoId"] = int(nuevo["id"])
                creados += 1

        elif estado == "SOLO_EN_BANCO" and registrar_faltantes:
            if ln.get("movimientoId") is not None:
                ids_a_conciliar.add(int(ln["movimientoId"]))
                continue
            monto_dec = redondear(Decimal(str(ln["monto"])))
            if monto_dec == CERO:
                continue
            tipo_mov = "INGRESO" if monto_dec > CERO else "EGRESO"
            desc = ln.get("descripcion") or "Movimiento de extracto bancario"
            nuevo = tesoreria.registrar_movimiento(
                cur,
                cuenta_id=cuenta["id"],
                empresa_id=emp_id,
                fecha=date.fromisoformat(ln["fecha"]),
                tipo=tipo_mov,
                metodo=_inferir_metodo(desc),
                categoria=_categoria_solo_en_banco(monto_dec, desc),
                concepto=desc[:300],
                referencia=ln.get("referencia"),
                monto=abs(monto_dec),
                conciliado=True,
                usuario_id=usuario_id,
                verificar_modulo=False,
                cuenta_bloqueada=cuenta,
            )
            ln["movimientoId"] = int(nuevo["id"])
            creados += 1

    conciliados_existentes = 0
    if ids_a_conciliar:
        cur.execute(
            """
            UPDATE "MovimientoBancario"
               SET "conciliado" = true,
                   "conciliadoEn" = %s,
                   "conciliadoPorId" = %s
             WHERE "id" = ANY(%s)
               AND "cuentaId" = %s
               AND "anuladoEn" IS NULL
            """,
            (ahora, usuario_id, sorted(ids_a_conciliar), cuenta["id"]),
        )
        conciliados_existentes = cur.rowcount

    cur.execute(
        """
        UPDATE "ConciliacionBancaria"
           SET "estado" = 'CONFIRMADA',
               "lineas" = %s,
               "confirmadaPorId" = %s,
               "confirmadaEn" = %s
         WHERE "id" = %s
        """,
        (Jsonb(lineas), usuario_id, ahora, conc_id),
    )

    confirmada = obtener_conciliacion(cur, conc_id)
    bitacora.registrar(
        cur,
        usuario_id,
        "ConciliacionBancaria",
        conc_id,
        "confirmar",
        None,
        {
            "lineasSeleccionadas": len(seleccion),
            "conciliadosExistentes": conciliados_existentes,
            "movimientosCreados": creados,
        },
        organizacion_id=conc.get("organizacionId", "org-principal"),
    )
    return confirmada
