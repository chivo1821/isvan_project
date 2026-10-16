"""Procesa los censos que llegaron desde la pagina ANTES de que existieran las
reglas del censo (alta de clientes, duplicados): sin esto, en el tablero y
en "Censos por corregir" aparecen sin codigo aunque lo tengan. Se corre una
vez por base, despues de aplicar la migracion 20261016120000_censo_maestra
y de cargar las maestras.

    backend/.venv/Scripts/python.exe backend/scripts/procesar_censos.py
    backend/.venv/Scripts/python.exe backend/scripts/procesar_censos.py --confirmar

Sin --confirmar es una vista previa (procesa y deshace). Usa la base del
DATABASE_URL del .env de la raiz. Toca solo los censos sin procesar (sin
filas en CensoCliente, no duplicados ni descartados) que traen codigo o son
posibles clientes. Volver a correrlo es seguro: lo ya procesado no se toca
(los posibles clientes solo se vuelven a revisar como duplicados).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections import Counter
from pathlib import Path
from urllib.parse import urlparse

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.db import get_connection  # noqa: E402  (carga el .env de la raiz)
from app.services import censo_clientes as cc  # noqa: E402


def ejecutar(confirmar: bool) -> dict:
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            'SELECT c."id", c."respuestas" FROM "Censo" c WHERE c."formulario" = %s AND c."descartadoEn" IS NULL '
            'AND c."duplicadoDeId" IS NULL '
            'AND NOT EXISTS (SELECT 1 FROM "CensoCliente" cc WHERE cc."censoId" = c."id") '
            'ORDER BY c."terminadoEn", c."id"',
            (cc.FORMULARIO,),
        )
        candidatos = cur.fetchall()
        ctx = cc.Contexto(cur)
        acciones: Counter[str] = Counter()
        resumen = Counter()
        revisar = []
        for c in candidatos:
            if not cc.claves_de(c["respuestas"]) and not cc.es_posible_cliente(c["respuestas"]):
                resumen["sinCodigo"] += 1
                continue
            resultado = cc.procesar(cur, c["id"], ctx)
            resumen["procesados"] += 1
            resumen["duplicados"] += bool(resultado["duplicadoDe"])
            resumen["posiblesClientes"] += resultado["posibleCliente"]
            for k in resultado["clientes"]:
                acciones[k["accion"]] += 1
                if k["accion"] == "REVISAR":
                    revisar.append(
                        {"censo": c["id"], "empresa": k["empresa"], "codigo": k["codigo"], "motivo": k["motivo"]}
                    )
        if confirmar:
            conn.commit()
        else:
            conn.rollback()
    return {
        "sinProcesar": len(candidatos),
        "procesados": resumen["procesados"],
        "sinCodigo": resumen["sinCodigo"],
        "duplicados": resumen["duplicados"],
        "posiblesClientes": resumen["posiblesClientes"],
        "clientes": {a: acciones[a] for a in ("CREADO", "COMPLETADO", "EXISTENTE", "REVISAR")},
        "revisar": revisar,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Procesa los censos anteriores a las reglas del censo")
    parser.add_argument("--confirmar", action="store_true", help="Guardar (sin esto, solo vista previa)")
    args = parser.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    base = urlparse(os.environ.get("DATABASE_URL", ""))
    print(f"Base: {base.hostname}:{base.port or 5432}{base.path}")
    print("Modo:", "PROCESAR" if args.confirmar else "vista previa (no guarda nada)")
    print(json.dumps(ejecutar(args.confirmar), ensure_ascii=False, indent=2, default=str))
    if not args.confirmar:
        print("\nPara guardar, repetir con --confirmar.")


if __name__ == "__main__":
    main()
