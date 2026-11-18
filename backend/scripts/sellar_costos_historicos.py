"""Sella el costo historico en las ventas viejas (backfill).

Las filas de Venta anteriores al sellado automatico (ver confirmar_carga en
backend/app/api/indicadores.py) quedaron con costoCajaUsd = NULL. Este
script reproduce la linea de tiempo de cada empresa —cargas confirmadas y
listas de precios en el orden en que se subieron— y sella cada fila con el
costo que regia cuando su carga entro.

Se corre una sola vez por base, despues de la migracion
20261118120000_costo_historico_venta:

    backend/.venv/Scripts/python.exe backend/scripts/sellar_costos_historicos.py --dry-run
    backend/.venv/Scripts/python.exe backend/scripts/sellar_costos_historicos.py

Para Neon (produccion) se pasa la URL explicita:

    backend/.venv/Scripts/python.exe backend/scripts/sellar_costos_historicos.py --database-url "postgresql://..."

Es idempotente: la linea de tiempo es determinista, asi que correrlo dos
veces deja los mismos sellos. Las filas cuyo producto nunca tuvo costo
quedan en NULL y los indicadores las siguen contando como venta sin costo.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.db import get_connection  # noqa: E402


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Sella el costo historico en las ventas viejas.")
    p.add_argument("--empresa", help="Solo esta empresa (por defecto: todas).")
    p.add_argument("--database-url", help="Sobrescribe DATABASE_URL (para Neon).")
    p.add_argument("--dry-run", action="store_true", help="Cuenta lo que sellaria sin escribir.")
    return p.parse_args()


def _eventos(cur, empresa: str) -> list[dict]:
    """Cargas confirmadas y listas de precios, en el orden en que se subieron.

    El mismo orden que usa revertir_carga para reconstruir los costos
    vigentes. En empate de fecha manda primero la lista: una lista subida el
    mismo dia que una carga vieja no debe quedar por debajo de ella.
    """
    cur.execute(
        'SELECT "id" AS "cargaId", "dimensiones" AS "datos", FALSE AS "esLista", "confirmadaEn" AS "en" '
        'FROM "VentaCarga" WHERE "empresa" = %(empresa)s AND "estado" = \'CONFIRMADA\' '
        'UNION ALL '
        'SELECT NULL, "productos", TRUE, "subidaEn" FROM "ListaPrecioCarga" WHERE "empresa" = %(empresa)s '
        'ORDER BY "en", "esLista"',
        {"empresa": empresa},
    )
    return cur.fetchall()


def _costos_de(productos: list[dict]) -> dict[int, float]:
    """Solo los productos que traen costo: un extracto sin hoja de costos no
    borra lo que ya se sabia (misma regla que _aplicar_dimensiones)."""
    return {
        int(p["codigo"]): p["costoCajaUsd"]
        for p in productos
        if p.get("costoCajaUsd") is not None
    }


def sellar_empresa(cur, empresa: str, dry_run: bool = False) -> dict:
    eventos = _eventos(cur, empresa)
    costos: dict[int, float] = {}
    cargas_selladas = 0
    filas_selladas = 0
    filas_sin_costo = 0

    for evento in eventos:
        # Las listas traen la lista de productos directo; las cargas la
        # traen dentro de las dimensiones, junto a los clientes.
        productos = evento["datos"] if evento["esLista"] else evento["datos"].get("productos", [])
        costos.update(_costos_de(productos))
        if evento["esLista"] or not evento["cargaId"]:
            continue
        # Primero se aprende el costo que trae la carga y DESPUES se sellan
        # sus filas: el archivo de un mes manda sobre ese mes.
        if dry_run:
            cur.execute(
                'SELECT COUNT(*) FILTER (WHERE v."codigoProducto" = ANY(%(codigos)s)) AS con_costo, '
                'COUNT(*) FILTER (WHERE NOT (v."codigoProducto" = ANY(%(codigos)s))) AS sin_costo '
                'FROM "Venta" v WHERE v."cargaId" = %(carga)s',
                {"carga": evento["cargaId"], "codigos": list(costos) or [-1]},
            )
            fila = cur.fetchone()
            filas = fila["con_costo"]
            filas_sin_costo += fila["sin_costo"]
        else:
            cur.executemany(
                'UPDATE "Venta" SET "costoCajaUsd" = %s '
                'WHERE "cargaId" = %s AND "codigoProducto" = %s',
                [(costo, evento["cargaId"], codigo) for codigo, costo in costos.items()],
            )
            # rowcount de executemany no es confiable; se cuenta aparte.
            cur.execute(
                'SELECT COUNT(*) AS n FROM "Venta" WHERE "cargaId" = %s AND "costoCajaUsd" IS NOT NULL',
                (evento["cargaId"],),
            )
            filas = cur.fetchone()["n"]
        cargas_selladas += 1
        filas_selladas += filas

    if dry_run:
        sin_costo = filas_sin_costo
    else:
        cur.execute(
            'SELECT COUNT(*) AS n FROM "Venta" v JOIN "VentaCarga" c ON c."id" = v."cargaId" '
            'WHERE v."empresa" = %(empresa)s AND c."estado" = \'CONFIRMADA\' AND v."costoCajaUsd" IS NULL',
            {"empresa": empresa},
        )
        sin_costo = cur.fetchone()["n"]
    return {
        "empresa": empresa,
        "eventos": len(eventos),
        "cargas": cargas_selladas,
        "filasSelladas": filas_selladas,
        "filasSinCosto": sin_costo,
    }


def main() -> None:
    args = _parse_args()
    if args.database_url:
        os.environ["DATABASE_URL"] = args.database_url

    with get_connection() as conn, conn.cursor() as cur:
        if args.empresa:
            empresas = [args.empresa]
        else:
            cur.execute('SELECT DISTINCT "empresa" FROM "VentaCarga" ORDER BY 1')
            empresas = [r["empresa"] for r in cur.fetchall()]
        if not empresas:
            print("No hay cargas de ventas en esta base.")
            return

        modo = "DRY-RUN (sin escribir)" if args.dry_run else "ESCRIBIENDO"
        print(f"Sellado de costos historicos — {modo}")
        for empresa in empresas:
            resumen = sellar_empresa(cur, empresa, args.dry_run)
            print(
                f"  {resumen['empresa']}: {resumen['cargas']} cargas "
                f"({resumen['eventos']} eventos con listas), "
                f"{resumen['filasSelladas']} filas selladas, "
                f"{resumen['filasSinCosto']} filas quedan sin costo"
            )
        if args.dry_run:
            conn.rollback()
            print("Dry-run: no se escribio nada.")
        else:
            conn.commit()
            print("Listo: sellos aplicados y confirmados.")


if __name__ == "__main__":
    main()
