"""Importa un XLSForm (Survey123 Connect) como formulario de la app.

    python scripts/importar_formulario.py RUTA_DEL_EXCEL --id censo

Escribe app/formularios/<id>.json, que es lo que lee la app. No toca la
base: el formulario va con el codigo (se revisa y se commitea como
cualquier otro cambio), y cada censo guarda la version con la que se lleno.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services import xlsform as xf  # noqa: E402
from app.services import xlsform_expresiones as ex  # noqa: E402

DESTINO = Path(__file__).resolve().parents[1] / "app" / "formularios"


def avisos(definicion: dict) -> list[str]:
    """Lo que se importa bien pero conviene revisar en el Excel."""
    salida = []
    preguntas = xf.preguntas_de(definicion)
    multiples = {p["name"]: p for p in preguntas if p["type"] == "select_multiple"}
    for p in preguntas:
        for columna in ("relevant", "constraint", "calculation"):
            texto = p.get(columna)
            if not texto:
                continue
            nodo = ex.analizar(texto)
            if "string_length" in ex.nombres(nodo):
                salida.append(f"{p['name']}.{columna}: 'string_length' no es XLSForm estandar; "
                              "se toma como string-length(.)")
            for especial in ("end_hour", "end_hh_mm_ss") :
                if especial in ex.nombres(nodo):
                    salida.append(f"{p['name']}.{columna}: '{especial}' no es una funcion de XLSForm; "
                                  "la app lo calcula al enviar (hora de fin / duracion)")
            for ref in ex.referencias(nodo) & set(multiples):
                if "selected(" not in texto.replace(" ", ""):
                    salida.append(f"{p['name']}.{columna}: compara la seleccion multiple '{ref}' con '='; "
                                  f"solo se cumple si es la UNICA opcion marcada (para 'esta marcada' "
                                  f"usar selected(${{{ref}}}, 'valor'))")
    # Un filtro en cascada (municipio -> parroquia) que filtra por un nombre
    # repetido en la lista de arriba mezcla opciones de dos padres distintos.
    por_nombre = {p["name"]: p for p in preguntas}
    for p in preguntas:
        filtro = p.get("choice_filter")
        if not filtro:
            continue
        for ref in ex.referencias(ex.analizar(filtro)):
            padre = por_nombre.get(ref)
            if not padre or "list" not in padre:
                continue
            nombres = [o["name"] for o in definicion["choices"][padre["list"]]]
            repetidos = sorted({n for n in nombres if nombres.count(n) > 1})
            if repetidos:
                salida.append(f"{p['name']}.choice_filter ({filtro}): '{ref}' tiene nombres repetidos {repetidos}; "
                              f"al elegir uno se mezclan las opciones de todos los que se llaman igual")
    for nombre, p in multiples.items():
        con_espacio = [o["name"] for o in definicion["choices"][p["list"]] if " " in o["name"]]
        if con_espacio:
            salida.append(f"lista '{p['list']}' (seleccion multiple en '{nombre}'): opciones con espacios "
                          f"en name {con_espacio}; XLSForm no lo admite, la app las guarda igual como lista")
    return salida


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("excel")
    parser.add_argument("--id", required=True, help="identificador del formulario, p. ej. censo")
    args = parser.parse_args()

    try:
        definicion = xf.leer_xlsform(args.excel, args.id)
    except xf.ErrorXlsform as e:
        sys.exit(f"No se pudo importar: {e}")

    DESTINO.mkdir(parents=True, exist_ok=True)
    salida = DESTINO / f"{args.id}.json"
    salida.write_text(json.dumps(definicion, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    preguntas = xf.preguntas_de(definicion)
    print(f"Formulario '{definicion['title']}' -> {salida}")
    print(f"  version {definicion['version']} | {len(preguntas)} preguntas | {len(definicion['choices'])} listas")
    print("  tipos:", dict(Counter(p["type"] for p in preguntas)))
    lista = avisos(definicion)
    if lista:
        print(f"\n{len(lista)} aviso(s) para revisar en el Excel:")
        for a in lista:
            print("  -", a)


if __name__ == "__main__":
    main()
