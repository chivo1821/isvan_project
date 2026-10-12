"""Envia un correo de prueba con la configuracion actual (la del .env de la
raiz del proyecto, o las variables de entorno), sin pasar por el portal.

    backend/.venv/Scripts/python.exe backend/scripts/probar_correo.py destino@correo.com

Sirve para comprobar RESEND_API_KEY y CORREO_REMITENTE antes de desplegar.
Mientras el dominio no este verificado en Resend, el remitente tiene que ser
onboarding@resend.dev y el destino, el correo de la propia cuenta de Resend
(si no, Resend responde 403).
"""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import app.core.db  # noqa: E402,F401  (carga el .env de la raiz)
from app.services import correo  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description="Correo de prueba")
    parser.add_argument("destino", help="A quien enviarlo")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    modo = correo.modo() or "(sin configurar)"
    print(f"Modo de correo: {modo}")
    if modo == "consola":
        print(f"No se envia nada: queda en el log y en {correo.BUZON_LOCAL}")
    try:
        correo.enviar(
            args.destino,
            "Prueba de correo del portal de clientes",
            ["Si lees esto, el envío de correos del portal funciona.", "Así se ve un código:"],
            "123456",
        )
    except correo.CorreoNoDisponible as e:
        print(f"FALLO: {e}")
        print("Revisa RESEND_API_KEY, CORREO_REMITENTE y que el dominio del remitente este verificado en Resend.")
        raise SystemExit(1) from None
    print("Enviado." if modo == "resend" else "Listo.")


if __name__ == "__main__":
    main()
