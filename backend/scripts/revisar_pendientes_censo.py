"""Reporte (solo lectura) de lo que de verdad falta del censo: cruza los
censos sin codigo y los devueltos con la maestra de su ruta, por nombre, y
la maestra con lo registrado en Clientes. No escribe nada en la base.

    backend/.venv/Scripts/python.exe backend/scripts/revisar_pendientes_censo.py [--excel ARCHIVO.xlsx]

Clases de cada censo sin codigo o devuelto:
- registrado: corresponde a un cliente de la maestra que ya esta en Clientes.
- por_registrar: corresponde a uno que falta registrar (ya sale en esa lista).
- sin_correspondencia: no corresponde a ninguno (o empatan varios en
  distinta situacion): son los pendientes reales.
Usa la base del DATABASE_URL del .env de la raiz. Las reglas del cruce
estan en app/services/censo_tablero.py (Cruce).
"""

from __future__ import annotations

import argparse
import os
import sys
from collections import Counter, defaultdict
from pathlib import Path
from urllib.parse import urlparse

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import openpyxl  # noqa: E402

from app.core.db import get_connection  # noqa: E402  (carga el .env de la raiz)
from app.services import censo_clientes as cc  # noqa: E402
from app.services import censo_tablero as tc  # noqa: E402
from app.services.maestra_import import EMPRESAS  # noqa: E402


def _clase(cruce: tc.Cruce, nombre: str | None, ruta: str | None) -> tuple[str, str]:
    m = cruce.de(nombre, ruta)
    if not m:
        return "sin_correspondencia", ""
    clientes = " | ".join(f'{f["empresa"]} {f["codigo"]} {f["razonSocial"]}' for f in m["clientes"])
    return ("registrado" if m["registrado"] else "por_registrar"), clientes


def main() -> None:
    parser = argparse.ArgumentParser(description="Reporte de lo que falta del censo (solo lectura)")
    parser.add_argument("--excel", type=Path, help="Guardar el detalle en este Excel")
    args = parser.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    base = urlparse(os.environ.get("DATABASE_URL", ""))
    print(f"Base: {base.hostname}:{base.port or 5432}{base.path} (solo lectura)")

    with get_connection() as conn:
        conn.read_only = True
        with conn.cursor() as cur:
            vigentes = tc.cargar(cur, 'WHERE c."formulario" = %(f)s AND c."descartadoEn" IS NULL', {"f": cc.FORMULARIO})
            cur.execute(
                'SELECT "id", "encuestador", "nombreComercio", "ruta", "terminadoEn", "motivoDevolucion" FROM "Censo" '
                'WHERE "formulario" = %s AND "devueltoEn" IS NOT NULL',
                (cc.FORMULARIO,),
            )
            devueltos = cur.fetchall()
            maestra = tc._maestra(cur, EMPRESAS)
            en_sistema = tc._en_sistema(cur, EMPRESAS)
            avance = tc.avance(cur, [c for c in vigentes if not c["duplicadoDeId"]], EMPRESAS, None)
        conn.rollback()

    cruce = tc.Cruce(maestra, en_sistema)
    filas = []
    for c in vigentes:
        if tc.sin_codigo(c):
            filas.append(("sin código", c["id"], c["nombreComercio"], c["ruta"], c["encuestador"],
                          tc.dia_caracas(c["terminadoEn"]), "", *_clase(cruce, c["nombreComercio"], c["ruta"])))
    for d in devueltos:
        filas.append(("devuelto", d["id"], d["nombreComercio"], d["ruta"], d["encuestador"],
                      tc.dia_caracas(d["terminadoEn"]), d["motivoDevolucion"] or "",
                      *_clase(cruce, d["nombreComercio"], d["ruta"])))

    print("\nMaestra (sin la ruta 77) contra Clientes:")
    for e in avance["porEmpresa"]:
        print(f'  {e["empresa"]}: {e["registrados"]} de {e["maestra"]} registrados, {e["porRegistrar"]} por registrar')
    print(f'  Por registrar con censo (por codigo o por nombre): {sum(1 for x in avance["porRegistrar"] if x["censado"])}')

    for origen in ("sin código", "devuelto"):
        clases = Counter(f[7] for f in filas if f[0] == origen)
        print(f"\nCensos {origen}: {sum(clases.values())} -> {dict(clases)}")
    por_vendedor: dict[str, Counter] = defaultdict(Counter)
    for f in filas:
        por_vendedor[f[4] or "(sin encuestador)"][f[7]] += 1
    print("\nPendientes reales (sin correspondencia) por encuestador:")
    for v, n in sorted(por_vendedor.items(), key=lambda kv: -kv[1]["sin_correspondencia"]):
        print(f'  {v}: {n["sin_correspondencia"]} reales · {n["registrado"]} ya registrados · '
              f'{n["por_registrar"]} en la lista por registrar')

    if args.excel:
        libro = openpyxl.Workbook()
        hoja = libro.active
        hoja.title = "Sin código y devueltos"
        hoja.append(["Origen", "Id del censo", "Comercio", "Ruta", "Encuestador", "Fecha", "Motivo de devolución",
                     "Clase", "Cliente de la maestra"])
        for f in sorted(filas, key=lambda f: (f[7], f[4] or "", f[3] or "")):
            hoja.append(list(f))
        hoja2 = libro.create_sheet("Por registrar")
        hoja2.append(["Empresa", "Código", "Razón social", "Ruta", "Vendedor", "Censado"])
        for x in avance["porRegistrar"]:
            hoja2.append([x["empresa"], x["codigo"], x["razonSocial"], x["ruta"], ", ".join(x["vendedores"]),
                          "Sí" if x["censado"] else "No"])
        libro.save(args.excel)
        print(f"\nDetalle guardado en {args.excel}")


if __name__ == "__main__":
    main()
