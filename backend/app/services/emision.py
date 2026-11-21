"""Emision fiscal: la interfaz con la imprenta digital autorizada.

Cada proveedor es una clase con emitir(documento) -> {"numeroControl", ...}.
El proveedor se elige con la variable de entorno EMISOR_FISCAL:

- "simulado": asigna un numero de control ficticio ("SIM-..."). Para
  desarrollo, la vista previa y la marcha en paralelo. Sus documentos NO
  tienen validez fiscal y lo dicen en el numero de control.
- (pendiente) el proveedor de imprenta digital que se contrate: se agrega
  aca una clase con su API.

Sin EMISOR_FISCAL en Vercel no se emite nada (EmisorNoConfigurado): asi
produccion nunca sale con el simulado por descuido. Fuera de Vercel (local,
pruebas) el valor por defecto es "simulado".

Errores:
- EmisionRechazada: el proveedor dijo que no (datos invalidos). El documento
  queda RECHAZADA; no se reintenta.
- EmisorNoDisponible: no respondio o fallo de su lado. Se reintenta (la cola
  de tareas lo vuelve a intentar mas tarde).
"""

from __future__ import annotations

import os


class EmisionRechazada(Exception):
    pass


class EmisorNoDisponible(Exception):
    pass


class EmisorNoConfigurado(EmisionRechazada):
    pass


class EmisorSimulado:
    nombre = "SIMULADO"

    def emitir(self, documento: dict) -> dict:
        if not documento.get("numero"):
            raise EmisionRechazada("El documento no tiene numero")
        return {
            "numeroControl": f"SIM-{documento['numero']}",
            "aviso": "Documento simulado, sin validez fiscal",
        }


def obtener_emisor():
    elegido = os.getenv("EMISOR_FISCAL") or ("" if os.getenv("VERCEL") else "simulado")
    if elegido == "simulado":
        return EmisorSimulado()
    if not elegido:
        raise EmisorNoConfigurado(
            "No hay imprenta digital configurada en este servidor: no se pueden emitir documentos fiscales"
        )
    raise EmisorNoConfigurado(f"Emisor fiscal desconocido: {elegido}")
