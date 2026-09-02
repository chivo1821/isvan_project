"""Helpers compartidos para parsear los Excel de importacion (despachos,
clientes): normalizacion de encabezados con alias flexibles y limpieza de
valores numericos que openpyxl entrega como int/float."""

from __future__ import annotations

import unicodedata

from fastapi import HTTPException


def normalizar_encabezado(texto: object) -> str:
    texto = str(texto or "").strip().lower()
    sin_acentos = "".join(c for c in unicodedata.normalize("NFD", texto) if unicodedata.category(c) != "Mn")
    return sin_acentos.replace(" ", "_")


def mapear_columnas(
    fila_encabezados: tuple, alias_columnas: dict[str, list[str]], campos_requeridos: list[str]
) -> dict[str, int]:
    normalizados = {normalizar_encabezado(v): i for i, v in enumerate(fila_encabezados) if v is not None}
    mapa: dict[str, int] = {}
    for campo, alias in alias_columnas.items():
        for a in alias:
            if a in normalizados:
                mapa[campo] = normalizados[a]
                break
    faltantes = [c for c in campos_requeridos if c not in mapa]
    if faltantes:
        # Se listan tambien los encabezados que si trae el archivo: casi
        # siempre el problema es un nombre de columna distinto al esperado, y
        # sin verlos el usuario no sabe que corregir.
        encontrados = ", ".join(sorted(normalizados)) or "(ninguno)"
        raise HTTPException(
            400,
            f"Faltan columnas obligatorias en el Excel: {', '.join(faltantes)}. "
            f"Los encabezados de la primera fila del archivo son: {encontrados}.",
        )
    return mapa


def valor_a_texto(valor: object) -> str:
    """Los codigos (cliente, documento) a veces vienen como numero puro en
    el Excel — openpyxl los entrega como int o float (2118.0); esto evita
    que un float se convierta a "2118.0" en vez de "2118"."""
    if valor is None:
        return ""
    if isinstance(valor, float) and valor.is_integer():
        return str(int(valor))
    return str(valor).strip()
