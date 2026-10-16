"""Correos salientes (codigos del portal de clientes, aviso de pago
verificado o rechazado).

CORREO_MODO elige como se envian:
- "smtp": por el servidor de correo de una cuenta normal (la de la empresa
  en su hosting, Google Workspace, Gmail...). No hace falta tocar el DNS: se
  envia como cualquier programa de correo. SMTP_SERVIDOR, SMTP_PUERTO (587
  por defecto, con STARTTLS; 465 usa SSL directo), SMTP_USUARIO y
  SMTP_CLAVE. CORREO_REMITENTE es opcional (por defecto, la cuenta misma) y
  tiene que ser esa cuenta o un alias que el servidor le permita.
- "resend": por la API de Resend (RESEND_API_KEY y CORREO_REMITENTE, con un
  dominio verificado en Resend; con onboarding@resend.dev solo llega al
  correo de la propia cuenta de Resend).
- "consola": no se envia nada, el correo se escribe en el log del backend y
  en backend/media/correos-dev.log. Para desarrollo local y pruebas.
Sin CORREO_MODO: "resend" si hay RESEND_API_KEY, "smtp" si hay
SMTP_SERVIDOR; si no, "consola" fuera de Vercel. En Vercel sin configurar es
un error (503): un codigo que nadie recibe deja a los clientes sin poder
entrar.
"""

from __future__ import annotations

import html
import logging
import os
import smtplib
import ssl
from datetime import datetime
from email.message import EmailMessage
from email.utils import formataddr, formatdate, make_msgid, parseaddr
from pathlib import Path

import httpx

URL_RESEND = "https://api.resend.com/emails"
# Solo modo consola (desarrollo): los correos "enviados", uno por linea.
BUZON_LOCAL = Path(__file__).resolve().parents[2] / "media" / "correos-dev.log"
TIEMPO_MAXIMO = 10.0
TIEMPO_MAXIMO_SMTP = 20.0
NOMBRE_POR_DEFECTO = "Portal de clientes"

_log = logging.getLogger(__name__)


class CorreoNoDisponible(RuntimeError):
    pass


def modo() -> str:
    elegido = os.getenv("CORREO_MODO")
    if elegido:
        return elegido
    if os.getenv("RESEND_API_KEY"):
        return "resend"
    if os.getenv("SMTP_SERVIDOR"):
        return "smtp"
    return "" if os.getenv("VERCEL") else "consola"


def _html(parrafos: list[str], destacado: str | None) -> str:
    """El cuerpo HTML. Todo se escapa: nada de lo que escribe un usuario se
    interpreta como HTML."""
    cuerpo = "".join(f'<p style="margin:0 0 14px">{html.escape(p)}</p>' for p in parrafos)
    if destacado:
        cuerpo += (
            '<p style="font-size:28px;font-weight:700;letter-spacing:6px;margin:8px 0 18px">'
            f"{html.escape(destacado)}</p>"
        )
    return (
        '<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#1f2933;max-width:520px">'
        f"{cuerpo}"
        '<p style="color:#7b8794;font-size:12px;margin-top:24px">Este correo se envió automáticamente; '
        "no hace falta responderlo.</p></div>"
    )


def enviar(destino: str, asunto: str, parrafos: list[str], destacado: str | None = None) -> None:
    """Un correo simple: parrafos de texto y, si viene, un valor destacado
    (el codigo)."""
    texto = "\n\n".join(parrafos + ([destacado] if destacado else []))
    elegido = modo()
    if elegido == "consola":
        _a_consola(destino, asunto, texto)
    elif elegido == "smtp":
        _por_smtp(destino, asunto, texto, _html(parrafos, destacado))
    elif elegido == "resend":
        _por_resend(destino, asunto, texto, _html(parrafos, destacado))
    else:
        raise CorreoNoDisponible("El envio de correos no esta configurado en este servidor (CORREO_MODO)")


def _a_consola(destino: str, asunto: str, texto: str) -> None:
    linea = f"{destino} | {asunto} | {texto.replace(chr(10) * 2, ' | ')}"
    _log.warning("CORREO (modo consola) para %s", linea)
    # Ademas a un archivo (backend/media, fuera de git), para leer el codigo
    # sin buscar la consola del backend.
    try:
        BUZON_LOCAL.parent.mkdir(parents=True, exist_ok=True)
        with BUZON_LOCAL.open("a", encoding="utf-8") as f:
            f.write(f"{datetime.now():%Y-%m-%d %H:%M:%S} | {linea}\n")
    except OSError:
        pass


def _por_smtp(destino: str, asunto: str, texto: str, contenido_html: str) -> None:
    servidor = os.getenv("SMTP_SERVIDOR")
    usuario = os.getenv("SMTP_USUARIO")
    clave = os.getenv("SMTP_CLAVE")
    if not servidor or not usuario or not clave:
        raise CorreoNoDisponible("Faltan SMTP_SERVIDOR, SMTP_USUARIO o SMTP_CLAVE")
    try:
        puerto = int(os.getenv("SMTP_PUERTO") or 587)
    except ValueError as e:
        raise CorreoNoDisponible("SMTP_PUERTO no es un numero") from e

    # "Cobranzas ISVAN <cobranzas@empresa.com>" o solo un nombre; sin
    # direccion, la de la cuenta.
    crudo = (os.getenv("CORREO_REMITENTE") or "").strip()
    nombre, direccion = parseaddr(crudo)
    if "@" not in direccion:
        # Sin direccion (parseaddr toma "Cobranzas ISVAN" como una
        # direccion rara): todo el texto es el nombre.
        nombre, direccion = crudo, usuario
    mensaje = EmailMessage()
    mensaje["From"] = formataddr((nombre or NOMBRE_POR_DEFECTO, direccion))
    mensaje["To"] = destino
    mensaje["Subject"] = asunto
    mensaje["Date"] = formatdate(localtime=False)
    mensaje["Message-ID"] = make_msgid(domain=direccion.rsplit("@", 1)[-1])
    mensaje.set_content(texto)
    mensaje.add_alternative(contenido_html, subtype="html")

    contexto = ssl.create_default_context()
    try:
        if puerto == 465:
            conexion = smtplib.SMTP_SSL(servidor, puerto, timeout=TIEMPO_MAXIMO_SMTP, context=contexto)
        else:
            conexion = smtplib.SMTP(servidor, puerto, timeout=TIEMPO_MAXIMO_SMTP)
        with conexion:
            if puerto != 465:
                # Nunca la clave sin cifrar: si el servidor no ofrece STARTTLS, falla.
                conexion.starttls(context=contexto)
            conexion.login(usuario, clave)
            conexion.send_message(mensaje)
    except smtplib.SMTPAuthenticationError as e:
        _log.error("SMTP rechazo el usuario o la clave (%s): %s", e.smtp_code, e.smtp_error[:200])
        raise CorreoNoDisponible("No se pudo enviar el correo (usuario o clave SMTP incorrectos)") from e
    except (smtplib.SMTPException, OSError) as e:
        _log.error("Fallo el envio por SMTP a %s:%s: %s", servidor, puerto, e)
        raise CorreoNoDisponible("No se pudo enviar el correo") from e


def _por_resend(destino: str, asunto: str, texto: str, contenido_html: str) -> None:
    clave = os.getenv("RESEND_API_KEY")
    remitente = os.getenv("CORREO_REMITENTE")
    if not clave or not remitente:
        raise CorreoNoDisponible("Faltan RESEND_API_KEY o CORREO_REMITENTE")
    try:
        respuesta = httpx.post(
            URL_RESEND,
            headers={"Authorization": f"Bearer {clave}"},
            json={"from": remitente, "to": [destino], "subject": asunto, "html": contenido_html, "text": texto},
            timeout=TIEMPO_MAXIMO,
        )
    except httpx.HTTPError as e:
        raise CorreoNoDisponible(f"No se pudo enviar el correo: {e}") from e
    if respuesta.status_code >= 400:
        # El cuerpo de Resend dice por que (dominio sin verificar, clave mala...).
        _log.error("Resend respondio %s: %s", respuesta.status_code, respuesta.text[:300])
        raise CorreoNoDisponible("No se pudo enviar el correo")


def enviar_sin_fallar(destino: str, asunto: str, parrafos: list[str]) -> None:
    """Para avisos que no deben tumbar la operacion que los dispara (p. ej.
    verificar un pago): si el correo falla, queda en el log y sigue."""
    try:
        enviar(destino, asunto, parrafos)
    except CorreoNoDisponible as e:
        _log.warning("Aviso por correo a %s no enviado: %s", destino, e)
