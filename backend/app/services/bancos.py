"""Bancos de Venezuela por su codigo de 4 digitos (el que encabeza la cuenta
de 20 digitos y el que piden los pagos moviles). Misma lista que
src/lib/bancos.ts."""

from __future__ import annotations

import re

BANCOS: dict[str, str] = {
    "0102": "Banco de Venezuela",
    "0104": "Venezolano de Crédito",
    "0105": "Mercantil",
    "0108": "BBVA Provincial",
    "0114": "Bancaribe",
    "0115": "Banco Exterior",
    "0128": "Banco Caroní",
    "0134": "Banesco",
    "0137": "Sofitasa",
    "0138": "Banco Plaza",
    "0146": "Bangente",
    "0151": "BFC Banco Fondo Común",
    "0156": "100% Banco",
    "0157": "DelSur",
    "0163": "Banco del Tesoro",
    "0166": "Banco Agrícola de Venezuela",
    "0168": "Bancrecer",
    "0169": "R4 Banco Microfinanciero",
    "0171": "Banco Activo",
    "0172": "Bancamiga",
    "0173": "Banco Internacional de Desarrollo",
    "0174": "Banplus",
    "0175": "Banco Digital de los Trabajadores",
    "0177": "BANFANB",
    "0178": "N58 Banco Digital",
    "0191": "Banco Nacional de Crédito (BNC)",
}

_CUENTA = re.compile(r"\d{20}")
# V/E/J/G/P/C + 6 a 9 digitos: una cedula tiene hasta 8 y un RIF, 8 mas el
# digito verificador (ninguno pasa de 9). C: RIF de comunas y consejos
# comunales.
_CEDULA_RIF = re.compile(r"([VEJGPC])(\d{6,9})")


def nombre(codigo: str | None) -> str | None:
    return BANCOS.get(codigo or "")


def validar_banco(codigo: str) -> str:
    codigo = (codigo or "").strip()
    if codigo not in BANCOS:
        raise ValueError("Elige un banco de la lista")
    return codigo


def normalizar_cuenta(cuenta: str) -> str:
    """Solo los digitos ("0134-0001-23-..." -> "0134000123..."): tienen que
    ser 20 y el banco (los 4 primeros) tiene que existir."""
    digitos = re.sub(r"\D", "", cuenta or "")
    if not _CUENTA.fullmatch(digitos):
        raise ValueError("La cuenta debe tener 20 dígitos")
    if digitos[:4] not in BANCOS:
        raise ValueError("Los primeros 4 dígitos de la cuenta no corresponden a ningún banco")
    return digitos


def normalizar_cedula_rif(valor: str) -> str:
    """"v-12.345.678" -> "V12345678"; "J-40123456-7" -> "J401234567". Sin
    letra se asume V (cedula venezolana)."""
    limpio = re.sub(r"[\s.\-]", "", (valor or "").upper())
    if limpio.isdigit():
        limpio = "V" + limpio
    m = _CEDULA_RIF.fullmatch(limpio)
    if not m:
        raise ValueError("Cédula o RIF no válido (ej. V12345678 o J401234567; tipos V, E, J, G, P o C)")
    return limpio
