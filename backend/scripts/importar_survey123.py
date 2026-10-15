"""Importa el historico del censo hecho en Survey123. Se corre una sola vez
por base (local para probar, Neon para produccion); no es una funcion de la
pagina.

    backend/.venv/Scripts/python.exe backend/scripts/importar_survey123.py RUTA_DE_LA_EXPORTACION
    backend/.venv/Scripts/python.exe backend/scripts/importar_survey123.py RUTA_DE_LA_EXPORTACION --confirmar

Sin --confirmar es una vista previa: importa dentro de una transaccion y la
deshace, asi los numeros (duplicados, clientes que se crearian, codigos a
revisar) son exactos. Usa la base del DATABASE_URL del .env de la raiz.

Antes, cargar la maestra de cada empresa desde /censo: con ella se revisa
que cada codigo corresponda al comercio. Reimportar es seguro: cada censo se
reconoce por su smid y los que ya estan no se tocan. Las reglas estan en
app/services/censo_survey123.py y censo_clientes.py.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from urllib.parse import urlparse

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.db import get_connection  # noqa: E402  (carga el .env de la raiz)
from app.services import censo_survey123 as s123  # noqa: E402


def ejecutar(ruta: Path, confirmar: bool) -> dict:
    lectura = s123.leer(ruta.read_bytes(), ruta.name)
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute('SELECT DISTINCT "empresa"::text AS "e" FROM "MaestraCarga" ORDER BY 1')
        con_maestra = [r["e"] for r in cur.fetchall()]
        resumen = s123.importar(cur, lectura)
        if confirmar:
            conn.commit()
        else:
            conn.rollback()
    return {"maestrasCargadas": con_maestra, **resumen}


def main() -> None:
    parser = argparse.ArgumentParser(description="Importa el historico del censo de Survey123")
    parser.add_argument("archivo", type=Path, help="Exportacion de Survey123 (CSV, GeoJSON o Excel)")
    parser.add_argument("--confirmar", action="store_true", help="Guardar (sin esto, solo vista previa)")
    args = parser.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")

    # Donde se va a escribir, sin la clave.
    base = urlparse(os.environ.get("DATABASE_URL", ""))
    print(f"Base: {base.hostname}:{base.port or 5432}{base.path}")
    print("Modo:", "IMPORTAR" if args.confirmar else "vista previa (no guarda nada)")
    resumen = ejecutar(args.archivo, args.confirmar)
    if not resumen["maestrasCargadas"]:
        print("AVISO: no hay ninguna maestra cargada; los codigos no se contrastan con ella.")
    print(json.dumps(resumen, ensure_ascii=False, indent=2, default=str))
    if not args.confirmar:
        print("\nPara guardar, repetir con --confirmar.")


if __name__ == "__main__":
    main()
