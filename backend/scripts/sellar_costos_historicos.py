"""Sella el costo historico en las ventas viejas (backfill).

Las filas de Venta anteriores al sellado automatico (ver confirmar_carga en
backend/app/api/indicadores.py) quedaron con costoCajaUsd = NULL. Este
script reproduce la linea de tiempo de cada empresa —cargas confirmadas y
listas de precios en el orden en que entraron— y sella cada fila con la
misma regla que confirmar_carga (ver app/services/costo_historico.py):
costo propio del archivo > sello heredado de la fila que reemplazo > costo
vigente en ese momento de la linea de tiempo.

Se corre una sola vez por base, despues de la migracion
20261118120000_costo_historico_venta:

    backend/.venv/Scripts/python.exe backend/scripts/sellar_costos_historicos.py --dry-run
    backend/.venv/Scripts/python.exe backend/scripts/sellar_costos_historicos.py

Para Neon (produccion) se pasa la URL explicita:

    backend/.venv/Scripts/python.exe backend/scripts/sellar_costos_historicos.py --database-url "postgresql://..." --dry-run

Garantias:

- Solo llena filas en NULL: nunca pisa un sello que ya puso confirmar_carga
  (las cargas confirmadas entre el deploy y el backfill) ni uno de una
  corrida anterior. Por eso es idempotente.
- El --dry-run hace exactamente lo mismo dentro de una transaccion y al final
  la deshace: los numeros que muestra son los reales.
- Las filas cuyo producto nunca tuvo costo quedan en NULL y los indicadores
  las siguen contando como venta sin costo (y estimandolas con el vigente).
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.db import get_connection  # noqa: E402
from app.services import costo_historico  # noqa: E402


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Sella el costo historico en las ventas viejas.")
    p.add_argument("--empresa", help="Solo esta empresa (por defecto: todas).")
    p.add_argument("--database-url", help="Sobrescribe DATABASE_URL (para Neon).")
    p.add_argument("--dry-run", action="store_true", help="Lo hace todo y al final lo deshace.")
    return p.parse_args()


def _contar(cur, empresa: str) -> dict:
    """Filas de cargas confirmadas, con y sin sello."""
    cur.execute(
        'SELECT COUNT(*) FILTER (WHERE v."costoCajaUsd" IS NOT NULL) AS "selladas", '
        'COUNT(*) FILTER (WHERE v."costoCajaUsd" IS NULL) AS "sinSello" '
        'FROM "Venta" v JOIN "VentaCarga" c ON c."id" = v."cargaId" '
        'WHERE v."empresa" = %(empresa)s AND c."estado" = \'CONFIRMADA\'',
        {"empresa": empresa},
    )
    return cur.fetchone()


def sellar_empresa(cur, empresa: str) -> dict:
    antes = _contar(cur, empresa)
    eventos = costo_historico.eventos_de_costo(cur, empresa)
    vigentes: dict[int, float] = {}
    cargas = 0

    for evento in eventos:
        # Las listas traen la lista de productos directo; las cargas la
        # traen dentro de las dimensiones, junto a los clientes.
        productos = evento["datos"] if evento["esLista"] else evento["datos"].get("productos", [])
        propios = costo_historico.costos_propios(productos)
        # Primero se aprende el costo que trae el evento y DESPUES se sellan
        # las filas de la carga: el archivo de un mes manda sobre ese mes.
        vigentes.update(propios)
        if evento["esLista"]:
            continue
        cargas += 1
        # 1. Lo que el archivo no trae hereda el sello de la fila que
        #    reemplazo (las cargas anteriores ya se sellaron en este bucle).
        costo_historico.heredar_sellos_reemplazados(cur, evento["cargaId"], list(propios), solo_vacios=True)
        # 2. El resto, con el costo vigente en ese punto de la linea de tiempo.
        if vigentes:
            codigos, costos = zip(*vigentes.items())
            cur.execute(
                'UPDATE "Venta" v SET "costoCajaUsd" = c."costo" '
                'FROM unnest(%(codigos)s::bigint[], %(costos)s::numeric[]) AS c("codigo", "costo") '
                'WHERE v."cargaId" = %(carga)s AND v."codigoProducto" = c."codigo" '
                '  AND v."costoCajaUsd" IS NULL',
                {"carga": evento["cargaId"], "codigos": list(codigos), "costos": list(costos)},
            )

    despues = _contar(cur, empresa)
    return {
        "empresa": empresa,
        "eventos": len(eventos),
        "cargas": cargas,
        "yaSelladas": antes["selladas"],
        "filasSelladas": despues["selladas"] - antes["selladas"],
        "filasSinCosto": despues["sinSello"],
    }


def _destino(url: str | None) -> str:
    """Host y base, sin credenciales, para que se vea contra que se corre."""
    if not url:
        return "(sin DATABASE_URL)"
    partes = urlsplit(url)
    return f"{partes.hostname}{partes.path}"


def main() -> None:
    args = _parse_args()
    if args.database_url:
        os.environ["DATABASE_URL"] = args.database_url

    modo = "DRY-RUN (se deshace al final)" if args.dry_run else "ESCRIBIENDO"
    print(f"Sellado de costos historicos — {modo}")
    print(f"  Base: {_destino(os.environ.get('DATABASE_URL'))}")

    with get_connection() as conn, conn.cursor() as cur:
        if args.empresa:
            empresas = [args.empresa]
        else:
            cur.execute('SELECT DISTINCT "empresa" FROM "VentaCarga" ORDER BY 1')
            empresas = [r["empresa"] for r in cur.fetchall()]
        if not empresas:
            print("No hay cargas de ventas en esta base.")
            return

        for empresa in empresas:
            r = sellar_empresa(cur, empresa)
            print(
                f"  {r['empresa']}: {r['cargas']} cargas ({r['eventos']} eventos con listas), "
                f"{r['yaSelladas']} filas ya tenian sello, {r['filasSelladas']} selladas ahora, "
                f"{r['filasSinCosto']} quedan sin costo"
            )
        if args.dry_run:
            conn.rollback()
            print("Dry-run: no se escribio nada.")
        else:
            conn.commit()
            print("Listo: sellos aplicados y confirmados.")


if __name__ == "__main__":
    main()
