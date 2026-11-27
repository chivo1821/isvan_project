"""Tasa oficial BCV (Bs por USD), tomada de DolarApi con respaldo directo del BCV.

DolarApi es la fuente primaria; si falla o no responde, se consulta la fuente
de respaldo (endpoint JSON en TASA_BCV_URL_RESPALDO o la pagina oficial del BCV
como fuente BCV_DIRECTO). La tasa tambien se puede cargar a mano (fuente MANUAL),
y una carga manual nunca la pisa ninguna fuente automatica.

Regla del negocio: un pago SIEMPRE se convierte con la ultima tasa
publicada, sin importar la fecha del pago, aunque su fecha valor sea del dia
habil siguiente (el BCV la publica la vispera). La tasa usada queda guardada
en el pago, asi que publicar una nueva no cambia los pagos ya cargados.
"""

from __future__ import annotations

import logging
import os
import re
import ssl
from datetime import date, datetime, timedelta
from decimal import Decimal
from html.parser import HTMLParser

import httpx

from app.core.fechas import ahora_utc, hoy_caracas

URL_ACTUAL = "https://ve.dolarapi.com/v1/dolares/oficial"
URL_HISTORICO = "https://ve.dolarapi.com/v1/historicos/dolares/oficial"
URL_BCV = "https://www.bcv.org.ve"
TIEMPO_MAXIMO = 10.0
TIEMPO_MAXIMO_RESPALDO = 8.0
# Una tasa de BCV_DIRECTO se rechaza si su fecha o su valor son sospechosos
# (la pagina puede leerse sin verificar SSL).
DIAS_ATRAS_MAXIMO = 10
DIAS_ADELANTE_MAXIMO = 3
DESVIACION_MAXIMA = Decimal("0.30")

# Antes de usar la tasa se consulta la fuente automatica, como mucho cada tantos
# minutos (por proceso): una tasa nueva se toma en cuanto se publica, sin
# pedirla en cada reporte. Si la tasa guardada esta atrasada respecto al ultimo
# dia habil bancario, se reintenta cada 5 minutos.
MINUTOS_ENTRE_CONSULTAS = 15
MINUTOS_REINTENTO_ATRASADA = 5
_ultima_consulta: datetime | None = None


def ultimo_dia_habil(hoy: date | None = None) -> date:
    """Ultimo dia habil bancario (lunes a viernes) hasta hoy en Caracas."""
    d = hoy or hoy_caracas()
    if d.weekday() == 5:  # sabado -> viernes
        return d - timedelta(days=1)
    if d.weekday() == 6:  # domingo -> viernes
        return d - timedelta(days=2)
    return d


def esta_al_dia(fecha: date | None, hoy: date | None = None) -> bool:
    """True si la fecha valor de la tasa cubre al menos el ultimo dia habil."""
    if fecha is None:
        return False
    return fecha >= ultimo_dia_habil(hoy)

_log = logging.getLogger(__name__)

_VOID_TAGS = frozenset(
    {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}
)
_MESES_ES = {
    "enero": 1,
    "febrero": 2,
    "marzo": 3,
    "abril": 4,
    "mayo": 5,
    "junio": 6,
    "julio": 7,
    "agosto": 8,
    "septiembre": 9,
    "setiembre": 9,
    "octubre": 10,
    "noviembre": 11,
    "diciembre": 12,
}


class TasaNoDisponible(Exception):
    pass


def _pedir(url: str):
    respuesta = httpx.get(url, timeout=TIEMPO_MAXIMO, headers={"Accept": "application/json"})
    respuesta.raise_for_status()
    return respuesta.json()


def _es_error_ssl(exc: BaseException) -> bool:
    actual: BaseException | None = exc
    vistos: set[int] = set()
    while actual is not None and id(actual) not in vistos:
        vistos.add(id(actual))
        if isinstance(actual, ssl.SSLError):
            return True
        msg = str(actual).upper()
        if "CERTIFICATE_VERIFY_FAILED" in msg or ("SSL" in msg and "CERTIFICATE" in msg):
            return True
        actual = actual.__cause__ or actual.__context__
    return False


def _pedir_html(url: str) -> str:
    verificar = os.environ.get("TASA_BCV_VERIFICAR_SSL", "1").strip().lower() not in {"0", "false", "no"}
    headers = {
        "User-Agent": "Mozilla/5.0 (compatible; GestionLogistica/1.0)",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    }
    kwargs: dict = {"timeout": TIEMPO_MAXIMO_RESPALDO, "headers": headers, "follow_redirects": True}
    if not verificar:
        kwargs["verify"] = False
    try:
        respuesta = httpx.get(url, **kwargs)
    except httpx.HTTPError as e:
        if verificar and _es_error_ssl(e):
            _log.warning("Certificado SSL de BCV no verificable (%s); reintentando sin verificacion", e)
            respuesta = httpx.get(url, **{**kwargs, "verify": False})
        else:
            raise
    respuesta.raise_for_status()
    return respuesta.text


def _como_tasa(valor) -> Decimal | None:
    if isinstance(valor, bool):
        return None
    try:
        tasa = Decimal(str(valor))
    except (ArithmeticError, ValueError, TypeError):
        return None
    return tasa if tasa.is_finite() and tasa > 0 else None


def _parsear_tasa_texto(texto: str) -> Decimal | None:
    limpio = texto.replace("\xa0", " ").strip()
    m = re.search(r"-?\d[\d.,]*", limpio)
    if not m:
        return None
    num = m.group(0)
    if "," in num and "." in num:
        if num.rfind(",") > num.rfind("."):
            num = num.replace(".", "").replace(",", ".")
        else:
            num = num.replace(",", "")
    elif "," in num:
        if num.count(",") == 1:
            num = num.replace(",", ".")
        else:
            num = num.replace(",", "")
    return _como_tasa(num)


def _parsear_fecha_texto(texto: str) -> date | None:
    limpio = texto.replace("\xa0", " ").strip()
    if not limpio:
        return None
    m_iso = re.search(r"\b(\d{4})-(\d{2})-(\d{2})\b", limpio)
    if m_iso:
        try:
            return date(int(m_iso[1]), int(m_iso[2]), int(m_iso[3]))
        except ValueError:
            pass
    m_dmy = re.search(r"\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b", limpio)
    if m_dmy:
        try:
            return date(int(m_dmy[3]), int(m_dmy[2]), int(m_dmy[1]))
        except ValueError:
            pass
    m_es = re.search(r"\b(\d{1,2})\s+(?:de\s+)?([A-Za-zÁÉÍÓÚáéíóú]+)[,\s]+(?:de\s+)?(\d{4})\b", limpio)
    if m_es:
        mes = _MESES_ES.get(m_es[2].lower())
        if mes:
            try:
                return date(int(m_es[3]), mes, int(m_es[1]))
            except ValueError:
                pass
    return None


class _ParserBCV(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._pila: list[str] = []
        self._dolar_profundidad: int | None = None
        self._strong_profundidad: int | None = None
        self._strong_actual: list[str] = []
        self._fecha_valor_profundidad: int | None = None
        self._date_display_profundidad: int | None = None
        self._date_display_actual: list[str] = []
        self._ignorar_profundidad: int | None = None

        self.dolar_textos: list[str] = []
        self.fechas_valor_contents: list[str] = []
        self.fechas_valor_textos: list[str] = []
        self.date_display_contents: list[str] = []
        self.date_display_textos: list[str] = []
        self.todo_texto: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag_l = tag.lower()
        attrs_dict = {k.lower(): (v or "") for k, v in attrs}
        es_void = tag_l in _VOID_TAGS
        if not es_void:
            self._pila.append(tag_l)
            profundidad = len(self._pila)
        else:
            profundidad = len(self._pila) + 1

        if not es_void and tag_l in {"script", "style"} and self._ignorar_profundidad is None:
            self._ignorar_profundidad = profundidad

        elem_id = attrs_dict.get("id", "").strip().lower()
        clases = attrs_dict.get("class", "").lower().split()

        if not es_void and elem_id == "dolar" and self._dolar_profundidad is None:
            self._dolar_profundidad = profundidad

        if not es_void and self._dolar_profundidad is not None and tag_l == "strong" and self._strong_profundidad is None:
            self._strong_profundidad = profundidad
            self._strong_actual = []

        es_fechas_valor = "fechasvalor" in elem_id or "fecha-valor" in elem_id or any(
            c in {"fechasvalor", "fecha-valor"} for c in clases
        )
        if es_fechas_valor:
            if "content" in attrs_dict and attrs_dict["content"].strip():
                self.fechas_valor_contents.append(attrs_dict["content"])
            if not es_void and self._fecha_valor_profundidad is None:
                self._fecha_valor_profundidad = profundidad

        if self._fecha_valor_profundidad is not None and "content" in attrs_dict and attrs_dict["content"].strip():
            self.fechas_valor_contents.append(attrs_dict["content"])

        if "date-display-single" in clases:
            if "content" in attrs_dict and attrs_dict["content"].strip():
                self.date_display_contents.append(attrs_dict["content"])
            if not es_void and self._date_display_profundidad is None:
                self._date_display_profundidad = profundidad
                self._date_display_actual = []

    def handle_endtag(self, tag: str) -> None:
        tag_l = tag.lower()
        if tag_l in _VOID_TAGS or tag_l not in self._pila:
            return
        while self._pila:
            cerrado = self._pila.pop()
            if cerrado == tag_l:
                break
        profundidad = len(self._pila)
        if self._strong_profundidad is not None and profundidad < self._strong_profundidad:
            self.dolar_textos.append("".join(self._strong_actual))
            self._strong_actual = []
            self._strong_profundidad = None
        if self._dolar_profundidad is not None and profundidad < self._dolar_profundidad:
            self._dolar_profundidad = None
        if self._fecha_valor_profundidad is not None and profundidad < self._fecha_valor_profundidad:
            self._fecha_valor_profundidad = None
        if self._date_display_profundidad is not None and profundidad < self._date_display_profundidad:
            self.date_display_textos.append("".join(self._date_display_actual))
            self._date_display_actual = []
            self._date_display_profundidad = None
        if self._ignorar_profundidad is not None and profundidad < self._ignorar_profundidad:
            self._ignorar_profundidad = None

    def handle_data(self, data: str) -> None:
        if self._ignorar_profundidad is not None:
            return
        if self._strong_profundidad is not None:
            self._strong_actual.append(data)
        if self._fecha_valor_profundidad is not None:
            self.fechas_valor_textos.append(data)
        if self._date_display_profundidad is not None:
            self._date_display_actual.append(data)
        self.todo_texto.append(data)


def _extraer_bcv_html(html: str) -> list[tuple[date, Decimal]]:
    parser = _ParserBCV()
    parser.feed(html)
    parser.close()

    tasa: Decimal | None = None
    for texto in parser.dolar_textos:
        tasa = _parsear_tasa_texto(texto)
        if tasa is not None:
            break
    if tasa is None:
        raise TasaNoDisponible("No se encontro una tasa USD valida (#dolar strong) en la pagina del BCV")

    fecha: date | None = None
    candidatos_fecha = [
        *parser.fechas_valor_contents,
        "".join(parser.fechas_valor_textos),
        *parser.fechas_valor_textos,
        *parser.date_display_contents,
        *parser.date_display_textos,
    ]
    for candidato in candidatos_fecha:
        fecha = _parsear_fecha_texto(candidato)
        if fecha is not None:
            break

    if fecha is None:
        texto_completo = " ".join(parser.todo_texto)
        m_fv = re.search(r"fecha\s+valor\s*:?\s*([^\n\r]{1,80})", texto_completo, re.IGNORECASE)
        if m_fv:
            fecha = _parsear_fecha_texto(m_fv[1])

    if fecha is None:
        raise TasaNoDisponible("No se encontro la fecha valor en la pagina del BCV")

    return [(fecha, tasa)]


def _extraer_fila_json(item: dict, permitir_sin_fecha: bool = False) -> tuple[date, Decimal] | None:
    if not isinstance(item, dict):
        return None
    tasa: Decimal | None = None
    for clave in ("promedio", "tasa", "valor", "usd", "precio", "rate", "bcv"):
        if clave in item and item[clave] is not None:
            valor = item[clave]
            tasa = _parsear_tasa_texto(valor) if isinstance(valor, str) else _como_tasa(valor)
            if tasa is not None:
                break
    if tasa is None:
        return None

    tiene_clave_fecha = False
    fecha: date | None = None
    for clave in ("fechaValor", "fecha_valor", "fechaActualizacion", "fecha", "date"):
        if clave in item:
            tiene_clave_fecha = True
            if item[clave] is not None:
                fecha = _parsear_fecha_texto(str(item[clave]))
                if fecha is not None:
                    break
    if fecha is None:
        if permitir_sin_fecha and not tiene_clave_fecha:
            fecha = hoy_caracas()
        else:
            return None
    return (fecha, tasa)


def _leer_json_respaldo(url: str) -> list[tuple[date, Decimal]]:
    try:
        datos = _pedir(url)
    except (httpx.HTTPError, ValueError, TypeError) as e:
        raise TasaNoDisponible(f"Respaldo JSON no respondio: {e}") from e

    tasas: dict[date, Decimal] = {}
    if isinstance(datos, dict):
        lista = None
        for clave in ("tasas", "data", "resultados", "items"):
            if isinstance(datos.get(clave), list):
                lista = datos[clave]
                break
        if lista is not None:
            for item in lista:
                par = _extraer_fila_json(item, permitir_sin_fecha=False)
                if par:
                    tasas[par[0]] = par[1]
        else:
            par = _extraer_fila_json(datos, permitir_sin_fecha=True)
            if par:
                tasas[par[0]] = par[1]
    elif isinstance(datos, list):
        for item in datos:
            par = _extraer_fila_json(item, permitir_sin_fecha=False)
            if par:
                tasas[par[0]] = par[1]

    if not tasas:
        raise TasaNoDisponible("Respaldo JSON no devolvio tasas validas")
    return sorted(tasas.items())


def leer_dolarapi() -> list[tuple[date, Decimal]]:
    """Historico + la tasa de hoy, como (fecha, tasa). Lanza
    TasaNoDisponible si DolarApi no responde."""
    tasas: dict[date, Decimal] = {}
    try:
        for fila in _pedir(URL_HISTORICO):
            tasa = _como_tasa(fila.get("promedio"))
            if tasa and fila.get("fecha"):
                tasas[date.fromisoformat(fila["fecha"][:10])] = tasa
        actual = _pedir(URL_ACTUAL)
        tasa = _como_tasa(actual.get("promedio"))
        # "2026-10-08T00:00:00-04:00": la fecha valor, en hora de Caracas.
        if tasa and actual.get("fechaActualizacion"):
            tasas[date.fromisoformat(actual["fechaActualizacion"][:10])] = tasa
    except (httpx.HTTPError, ValueError, TypeError, AttributeError) as e:
        raise TasaNoDisponible(f"DolarApi no respondio: {e}") from e
    return sorted(tasas.items())


def leer_respaldo() -> list[tuple[date, Decimal]]:
    """Fuente de respaldo (BCV_DIRECTO): consulta TASA_BCV_URL_RESPALDO si esta
    configurada, o directamente la pagina oficial del BCV."""
    url_respaldo = os.environ.get("TASA_BCV_URL_RESPALDO", "").strip()
    if url_respaldo:
        return _leer_json_respaldo(url_respaldo)
    try:
        html = _pedir_html(URL_BCV)
    except (httpx.HTTPError, ValueError) as e:
        raise TasaNoDisponible(f"BCV directo no respondio: {e}") from e
    return _extraer_bcv_html(html)


def _validar_respaldo(cur, tasas: list[tuple[date, Decimal]]) -> None:
    """Defensa contra una tasa falsa venida del BCV directo."""
    hoy = hoy_caracas()
    ref = ultima(cur)
    for fecha, tasa in tasas:
        if fecha < hoy - timedelta(days=DIAS_ATRAS_MAXIMO) or fecha > hoy + timedelta(days=DIAS_ADELANTE_MAXIMO):
            raise TasaNoDisponible(f"Tasa BCV directa con fecha fuera de rango ({fecha})")
        if ref is not None:
            base = Decimal(str(ref["tasa"]))
            if base > 0 and abs(tasa - base) / base > DESVIACION_MAXIMA:
                raise TasaNoDisponible(f"Tasa BCV directa {tasa} se desvia mas de 30% de la ultima guardada ({base})")


def actualizar(cur, con_respaldo: bool = True, verificar_vigencia_bcv: bool = False) -> int:
    """Trae las tasas de DolarApi (o del respaldo BCV_DIRECTO si falla) y guarda
    las fechas que falten o que tenian otra tasa automatica. Nunca pisa tasas
    MANUAL. Si `verificar_vigencia_bcv=True` y la fecha mas reciente de DolarApi
    es anterior al ultimo dia habil bancario, consulta tambien el BCV directo y
    agrega la tasa si es mas reciente. Devuelve cuantas filas cambio."""
    registros: list[tuple[date, Decimal, str]] = []
    error_primario: str | None = None

    try:
        tasas_primarias = leer_dolarapi()
        if tasas_primarias:
            registros = [(fecha, tasa, "DOLARAPI") for fecha, tasa in tasas_primarias]
        else:
            error_primario = "DolarApi no devolvio tasas"
    except TasaNoDisponible as e:
        error_primario = str(e)

    if not registros and not con_respaldo:
        raise TasaNoDisponible(f"DolarApi no disponible ({error_primario})")

    if not registros:
        _log.warning("Fuente primaria DolarApi no disponible (%s); intentando respaldo BCV", error_primario)
        try:
            tasas_respaldo = leer_respaldo()
        except TasaNoDisponible as e:
            raise TasaNoDisponible(f"DolarApi ({error_primario}) y respaldo BCV ({e}) no respondieron") from e
        if not tasas_respaldo:
            raise TasaNoDisponible(f"DolarApi ({error_primario}) y respaldo BCV no devolvieron tasas")
        _validar_respaldo(cur, tasas_respaldo)
        registros = [(fecha, tasa, "BCV_DIRECTO") for fecha, tasa in tasas_respaldo]
    elif con_respaldo and verificar_vigencia_bcv:
        max_fecha_primaria = max(f for f, _, _ in registros)
        if not esta_al_dia(max_fecha_primaria):
            try:
                tasas_bcv = leer_respaldo()
                nuevas_bcv = [(f, t) for f, t in tasas_bcv if f > max_fecha_primaria]
                if nuevas_bcv:
                    _validar_respaldo(cur, nuevas_bcv)
                    registros.extend((f, t, "BCV_DIRECTO") for f, t in nuevas_bcv)
            except TasaNoDisponible as e:
                _log.warning("DolarApi trajo fecha %s y respaldo BCV no aporto tasa mas nueva: %s", max_fecha_primaria, e)

    ahora = ahora_utc()
    cur.executemany(
        'INSERT INTO "TasaCambio" ("fecha", "tasa", "fuente", "registradoEn") VALUES (%s, %s, %s, %s) '
        'ON CONFLICT ("fecha") DO UPDATE SET '
        '"tasa" = EXCLUDED."tasa", '
        '"fuente" = EXCLUDED."fuente", '
        '"registradoEn" = EXCLUDED."registradoEn" '
        'WHERE "TasaCambio"."fuente" <> \'MANUAL\' '
        'AND ("TasaCambio"."tasa" <> EXCLUDED."tasa" OR "TasaCambio"."fuente" <> EXCLUDED."fuente")',
        [(fecha, tasa, fuente, ahora) for fecha, tasa, fuente in registros],
    )
    return cur.rowcount


def guardar_manual(cur, fecha: date, tasa: Decimal, usuario_id: str) -> None:
    if tasa <= 0 or tasa > Decimal("100000000"):
        raise ValueError("La tasa no es valida")
    if fecha > hoy_caracas() + timedelta(days=3):
        raise ValueError("La fecha no puede estar tan adelante")
    cur.execute(
        'INSERT INTO "TasaCambio" ("fecha", "tasa", "fuente", "registradoEn", "registradoPorId") '
        "VALUES (%s, %s, 'MANUAL', %s, %s) "
        'ON CONFLICT ("fecha") DO UPDATE SET "tasa" = EXCLUDED."tasa", "fuente" = \'MANUAL\', '
        '"registradoEn" = EXCLUDED."registradoEn", "registradoPorId" = EXCLUDED."registradoPorId"',
        (fecha, tasa, ahora_utc(), usuario_id),
    )


def ultima(cur) -> dict | None:
    """La tasa publicada mas reciente que hay guardada."""
    cur.execute('SELECT "fecha", "tasa", "fuente" FROM "TasaCambio" ORDER BY "fecha" DESC LIMIT 1')
    return cur.fetchone()


def tasa_actual(
    cur,
    *,
    con_respaldo: bool = True,
    forzar: bool = False,
    hacer_commit: bool = True,
) -> dict:
    """{"fecha", "tasa", "fuente"}: la ultima tasa publicada. Antes, si paso
    un rato desde la ultima consulta (15 min normal, 5 min si la guardada no
    cubre el ultimo dia habil), la pide a DolarApi y cruza contra BCV directo.

    Si `hacer_commit=False` (cuando se llama en medio de otra transaccion),
    abre una conexion corta independiente para persistir las tasas sin tocar la
    transaccion del llamador."""
    global _ultima_consulta
    en_tests = bool(os.environ.get("PYTEST_CURRENT_TEST"))
    fila_previa = ultima(cur)
    al_dia = esta_al_dia(fila_previa["fecha"]) if fila_previa else False

    if not en_tests or forzar:
        ahora = ahora_utc()
        minutos = MINUTOS_ENTRE_CONSULTAS if al_dia else MINUTOS_REINTENTO_ATRASADA
        debe_consultar = forzar or _ultima_consulta is None or (ahora - _ultima_consulta > timedelta(minutes=minutos))
        if debe_consultar:
            _ultima_consulta = ahora
            try:
                if hacer_commit:
                    actualizar(cur, con_respaldo=con_respaldo, verificar_vigencia_bcv=True)
                    cur.connection.commit()
                else:
                    from app.core.db import get_connection

                    with get_connection() as conn_tasa, conn_tasa.cursor() as cur_tasa:
                        actualizar(cur_tasa, con_respaldo=con_respaldo, verificar_vigencia_bcv=True)
                        conn_tasa.commit()
            except TasaNoDisponible as e:
                _log.warning("%s", e)

    fila = ultima(cur)
    if fila is None:
        raise TasaNoDisponible("No hay tasa BCV registrada")
    return fila
