"""Donde se guardan las fotos de los censos.

Las fotos NO pasan por el backend: Vercel corta cualquier peticion o
respuesta de mas de 4,5 MB, y una foto puede pesar hasta 10 MB. El telefono
le pide al backend un enlace firmado, sube la foto directo al almacenamiento,
y al enviar el censo solo manda la clave de cada foto. Para verlas, el
backend redirige a un enlace firmado de lectura que vence en minutos.

Se elige con la variable de entorno ALMACEN_FOTOS:

- "r2": Cloudflare R2 (produccion). Gratis hasta 10 GB y un millon de
  subidas al mes, y descargar no cuesta. Necesita R2_ACCOUNT_ID,
  R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY y R2_BUCKET. El bucket es privado.
- "local": en backend/media/, para desarrollo. Imita a R2: la subida va a un
  endpoint del propio backend con un enlace firmado igual de efimero. Es el
  modo por defecto fuera de Vercel.

En Vercel sin ALMACEN_FOTOS configurado, pedir un enlace levanta
AlmacenNoConfigurado (la API responde 503): el vendedor ve que no se pudo
subir la foto, en vez de perderla.

Las firmas de R2 son SigV4 de S3, hechas a mano para no cargar boto3 (pesa y
alarga cada arranque en frio). Contrastadas contra boto3 con las mismas
entradas: ver la prueba en el scratchpad de la sesion del 2026-10-04.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote

import httpx

CARPETA_LOCAL = Path(__file__).resolve().parents[2] / "media"
_CLAVE_VALIDA = re.compile(r"^[A-Za-z0-9_-]+(/[A-Za-z0-9_.-]+)+$")
# Cuanto dura un enlace de subida o de lectura.
VIGENCIA_SUBIDA_S = 15 * 60
VIGENCIA_LECTURA_S = 10 * 60


class AlmacenNoConfigurado(RuntimeError):
    pass


@dataclass
class Subida:
    """Como subir una foto: a donde, con que metodo y cabeceras, y si va con
    la cookie de sesion (solo el modo local; a R2 se sube sin sesion)."""

    url: str
    metodo: str
    cabeceras: dict[str, str]
    con_sesion: bool


@dataclass
class Guardada:
    bytes: int
    tipo: str


def validar_clave(clave: str) -> str:
    if not _CLAVE_VALIDA.match(clave) or ".." in clave:
        raise ValueError(f"Clave de archivo invalida: {clave!r}")
    return clave


# ---------- SigV4 (S3) ----------


def _hmac(clave: bytes, texto: str) -> bytes:
    return hmac.new(clave, texto.encode("utf-8"), hashlib.sha256).digest()


def firmar_url(
    *,
    metodo: str,
    host: str,
    ruta: str,
    region: str,
    acceso: str,
    secreto: str,
    vigencia_s: int,
    cabeceras: dict[str, str] | None = None,
    momento: datetime | None = None,
) -> str:
    """Un enlace prefirmado de S3 (SigV4 por query string). Las `cabeceras`
    quedan firmadas: quien use el enlace tiene que mandarlas iguales (asi se
    fija el tipo y el tamano exacto de la foto)."""
    momento = momento or datetime.now(timezone.utc)
    fecha_hora = momento.strftime("%Y%m%dT%H%M%SZ")
    fecha = momento.strftime("%Y%m%d")
    alcance = f"{fecha}/{region}/s3/aws4_request"
    firmadas = {"host": host, **{k.lower(): str(v).strip() for k, v in (cabeceras or {}).items()}}
    nombres = ";".join(sorted(firmadas))
    query = {
        "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
        "X-Amz-Credential": f"{acceso}/{alcance}",
        "X-Amz-Date": fecha_hora,
        "X-Amz-Expires": str(vigencia_s),
        "X-Amz-SignedHeaders": nombres,
    }
    query_canonica = "&".join(
        f"{quote(k, safe='-_.~')}={quote(v, safe='-_.~')}" for k, v in sorted(query.items())
    )
    ruta_canonica = quote(ruta, safe="/-_.~")
    canonica = "\n".join(
        [
            metodo,
            ruta_canonica,
            query_canonica,
            "".join(f"{k}:{firmadas[k]}\n" for k in sorted(firmadas)),
            nombres,
            "UNSIGNED-PAYLOAD",
        ]
    )
    a_firmar = "\n".join(
        ["AWS4-HMAC-SHA256", fecha_hora, alcance, hashlib.sha256(canonica.encode("utf-8")).hexdigest()]
    )
    llave = _hmac(_hmac(_hmac(_hmac(f"AWS4{secreto}".encode("utf-8"), fecha), region), "s3"), "aws4_request")
    firma = hmac.new(llave, a_firmar.encode("utf-8"), hashlib.sha256).hexdigest()
    return f"https://{host}{ruta_canonica}?{query_canonica}&X-Amz-Signature={firma}"


# ---------- R2 ----------


class AlmacenR2:
    REGION = "auto"

    def __init__(self, cuenta: str, acceso: str, secreto: str, bucket: str):
        self.host = f"{cuenta}.r2.cloudflarestorage.com"
        self.acceso, self.secreto, self.bucket = acceso, secreto, bucket

    def _url(self, metodo: str, clave: str, vigencia_s: int, cabeceras: dict[str, str] | None = None) -> str:
        return firmar_url(
            metodo=metodo,
            host=self.host,
            ruta=f"/{self.bucket}/{validar_clave(clave)}",
            region=self.REGION,
            acceso=self.acceso,
            secreto=self.secreto,
            vigencia_s=vigencia_s,
            cabeceras=cabeceras,
        )

    def subida(self, clave: str, tipo: str, bytes_: int) -> Subida:
        cabeceras = {"Content-Type": tipo, "Content-Length": str(bytes_)}
        url = self._url("PUT", clave, VIGENCIA_SUBIDA_S, cabeceras)
        # Content-Length lo pone el navegador solo (no se puede fijar a
        # mano), y tiene que coincidir con el firmado: eso fija el tamano.
        return Subida(url=url, metodo="PUT", cabeceras={"Content-Type": tipo}, con_sesion=False)

    def guardada(self, clave: str) -> Guardada | None:
        respuesta = httpx.head(self._url("HEAD", clave, 60), timeout=15)
        if respuesta.status_code == 404:
            return None
        respuesta.raise_for_status()
        return Guardada(int(respuesta.headers.get("content-length", 0)), respuesta.headers.get("content-type", ""))

    def url_lectura(self, clave: str) -> str | None:
        return self._url("GET", clave, VIGENCIA_LECTURA_S)

    def leer(self, clave: str) -> bytes:
        respuesta = httpx.get(self._url("GET", clave, 60), timeout=30)
        respuesta.raise_for_status()
        return respuesta.content

    def borrar(self, clave: str) -> None:
        httpx.delete(self._url("DELETE", clave, 60), timeout=15)


# ---------- Local (desarrollo) ----------


# Solo firma enlaces de desarrollo que viven 15 minutos: si el servidor se
# reinicia y cambia, una subida a medias se vuelve a pedir y listo.
_SECRETO_LOCAL = (os.getenv("ALMACEN_SECRETO_LOCAL") or secrets.token_hex(32)).encode()


def _secreto_local() -> bytes:
    return _SECRETO_LOCAL


def _b64(datos: bytes) -> str:
    return base64.urlsafe_b64encode(datos).decode().rstrip("=")


def _de_b64(texto: str) -> bytes:
    return base64.urlsafe_b64decode(texto + "=" * (-len(texto) % 4))


class AlmacenLocal:
    """Imita a R2 en desarrollo: enlaces firmados y efimeros, pero hacia el
    propio backend (PUT /censo/fotos/carga/{ficha})."""

    def __init__(self, carpeta: Path = CARPETA_LOCAL, base_api: str | None = None):
        self.carpeta = carpeta
        self.base_api = (base_api or os.getenv("API_URL_PUBLICA") or "http://localhost:8000").rstrip("/")

    def _ruta(self, clave: str) -> Path:
        return self.carpeta / validar_clave(clave)

    def ficha(self, clave: str, tipo: str, bytes_: int) -> str:
        datos = json.dumps({"c": clave, "t": tipo, "b": bytes_, "v": int(time.time()) + VIGENCIA_SUBIDA_S}).encode()
        return f"{_b64(datos)}.{_b64(hmac.new(_secreto_local(), datos, hashlib.sha256).digest())}"

    def leer_ficha(self, ficha: str) -> dict:
        try:
            datos_b64, firma_b64 = ficha.split(".", 1)
            datos = _de_b64(datos_b64)
            esperada = hmac.new(_secreto_local(), datos, hashlib.sha256).digest()
            if not hmac.compare_digest(esperada, _de_b64(firma_b64)):
                raise ValueError("firma")
            carga = json.loads(datos)
        except (ValueError, json.JSONDecodeError) as e:
            raise ValueError("Enlace de subida invalido") from e
        if carga["v"] < time.time():
            raise ValueError("El enlace de subida vencio; vuelve a intentar")
        return carga

    def subida(self, clave: str, tipo: str, bytes_: int) -> Subida:
        return Subida(
            url=f"{self.base_api}/censo/fotos/carga/{self.ficha(clave, tipo, bytes_)}",
            metodo="PUT",
            cabeceras={"Content-Type": tipo},
            con_sesion=True,
        )

    def guardar(self, clave: str, contenido: bytes) -> None:
        ruta = self._ruta(clave)
        ruta.parent.mkdir(parents=True, exist_ok=True)
        ruta.write_bytes(contenido)

    def guardada(self, clave: str) -> Guardada | None:
        ruta = self._ruta(clave)
        if not ruta.exists():
            return None
        return Guardada(ruta.stat().st_size, "")

    def url_lectura(self, clave: str) -> str | None:
        return None  # la sirve el backend directo

    def leer(self, clave: str) -> bytes:
        return self._ruta(clave).read_bytes()

    def borrar(self, clave: str) -> None:
        self._ruta(clave).unlink(missing_ok=True)


def modo() -> str:
    return os.getenv("ALMACEN_FOTOS") or ("" if os.getenv("VERCEL") else "local")


def almacen() -> AlmacenR2 | AlmacenLocal:
    elegido = modo()
    if elegido == "local":
        return AlmacenLocal()
    if elegido == "r2":
        faltan = [v for v in ("R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET") if not os.getenv(v)]
        if faltan:
            raise AlmacenNoConfigurado(f"Faltan variables de R2: {', '.join(faltan)}")
        return AlmacenR2(
            os.environ["R2_ACCOUNT_ID"], os.environ["R2_ACCESS_KEY_ID"], os.environ["R2_SECRET_ACCESS_KEY"],
            os.environ["R2_BUCKET"],
        )
    raise AlmacenNoConfigurado(
        "El almacenamiento de fotos no esta configurado en este servidor (variable ALMACEN_FOTOS)"
    )
