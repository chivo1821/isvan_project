"""Correos salientes (codigos del portal de clientes, aviso de pago
verificado o rechazado), por la API de Resend.

CORREO_MODO elige como se envian:
- "resend": por Resend (RESEND_API_KEY y CORREO_REMITENTE, con un dominio
  verificado en Resend; si no, los correos caen en spam o se rechazan).
- "consola": no se envia nada, el correo se escribe en el log del backend.
  Para desarrollo local y pruebas.
Sin CORREO_MODO: "resend" si hay RESEND_API_KEY; si no, "consola" fuera de
Vercel. En Vercel sin configurar es un error (503): un codigo que nadie
recibe deja a los clientes sin poder entrar.
"""

from __future__ import annotations

import html
import logging
import os

import httpx

URL_RESEND = "https://api.resend.com/emails"
TIEMPO_MAXIMO = 10.0

_log = logging.getLogger(__name__)


class CorreoNoDisponible(RuntimeError):
    pass


def modo() -> str:
    elegido = os.getenv("CORREO_MODO")
    if elegido:
        return elegido
    if os.getenv("RESEND_API_KEY"):
        return "resend"
    return "" if os.getenv("VERCEL") else "consola"


def enviar(destino: str, asunto: str, parrafos: list[str], destacado: str | None = None) -> None:
    """Un correo simple: parrafos de texto y, si viene, un valor destacado
    (el codigo). El texto se escapa: nada de lo que escribe un usuario se
    interpreta como HTML."""
    texto = "\n\n".join(parrafos + ([destacado] if destacado else []))
    elegido = modo()
    if elegido == "consola":
        _log.warning("CORREO (modo consola) para %s | %s | %s", destino, asunto, texto.replace("\n\n", " | "))
        return
    if elegido != "resend":
        raise CorreoNoDisponible("El envio de correos no esta configurado en este servidor (CORREO_MODO)")
    clave = os.getenv("RESEND_API_KEY")
    remitente = os.getenv("CORREO_REMITENTE")
    if not clave or not remitente:
        raise CorreoNoDisponible("Faltan RESEND_API_KEY o CORREO_REMITENTE")

    cuerpo = "".join(f'<p style="margin:0 0 14px">{html.escape(p)}</p>' for p in parrafos)
    if destacado:
        cuerpo += (
            '<p style="font-size:28px;font-weight:700;letter-spacing:6px;margin:8px 0 18px">'
            f"{html.escape(destacado)}</p>"
        )
    contenido = (
        '<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#1f2933;max-width:520px">'
        f"{cuerpo}"
        '<p style="color:#7b8794;font-size:12px;margin-top:24px">Este correo se envió automáticamente; '
        "no hace falta responderlo.</p></div>"
    )
    try:
        respuesta = httpx.post(
            URL_RESEND,
            headers={"Authorization": f"Bearer {clave}"},
            json={"from": remitente, "to": [destino], "subject": asunto, "html": contenido, "text": texto},
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
