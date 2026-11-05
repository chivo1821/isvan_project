"""Avisa si una migración nueva tiene pasos que pueden cortar la operación.

La regla del proyecto (ver el plan del sistema administrativo): cada
migración solo agrega. Borrar o renombrar va en un despliegue posterior,
cuando ningún código desplegado lo use, y se marca a propósito.

Uso:  python scripts/revisar_migraciones.py [rama_base]   (por defecto origin/develop)

Revisa las carpetas de prisma/migrations que no están en la rama base. Si un
paso destructivo es intencional, la migración lleva un comentario
"-- destructivo-aprobado: <motivo>" y entonces solo se informa.
"""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
PELIGROSOS = [
    (r"\bDROP\s+(TABLE|COLUMN|TYPE|INDEX|SCHEMA)\b", "borra algo"),
    (r"\bRENAME\b", "renombra (el código desplegado lo sigue buscando con el nombre viejo)"),
    (r"\bALTER\s+COLUMN\s+\"?\w+\"?\s+(SET\s+DATA\s+)?TYPE\b", "cambia un tipo (reescribe y bloquea la tabla)"),
    (r"\bSET\s+NOT\s+NULL\b", "hace obligatoria una columna (falla si hay vacíos; bloquea la tabla)"),
    (r"\bTRUNCATE\b|\bDELETE\s+FROM\b", "borra datos"),
]
APROBADO = re.compile(r"--\s*destructivo-aprobado:", re.I)
# Un índice sobre una tabla que ya existe bloquea sus escrituras mientras se
# construye. Sobre una tabla creada en la misma migración no importa.
INDICE = re.compile(r'\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+(?!CONCURRENTLY)\S+\s+ON\s+"?(\w+)"?', re.I)
TABLA_NUEVA = re.compile(r'\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"?(\w+)"?', re.I)


def nuevas(base: str) -> list[Path]:
    salida = subprocess.run(
        ["git", "diff", "--name-only", "--diff-filter=A", f"{base}...HEAD", "--", "prisma/migrations"],
        capture_output=True, text=True, cwd=RAIZ, check=True,
    ).stdout
    return sorted({RAIZ / Path(l).parent for l in salida.splitlines() if l.endswith("migration.sql")})


def main() -> int:
    base = sys.argv[1] if len(sys.argv) > 1 else "origin/develop"
    fallas = 0
    for carpeta in nuevas(base):
        sql = (carpeta / "migration.sql").read_text(encoding="utf-8")
        aprobado = bool(APROBADO.search(sql))
        sin_comentarios = re.sub(r"--[^\n]*", "", sql)
        for patron, motivo in PELIGROSOS:
            for m in re.finditer(patron, sin_comentarios, re.I):
                linea = sin_comentarios[: m.start()].count("\n") + 1
                marca = "AVISO (aprobado)" if aprobado else "FALLA"
                print(f"{marca}  {carpeta.name}:{linea}  {m.group(0).strip()} -> {motivo}")
                fallas += 0 if aprobado else 1
        nuevas_tablas = {t.lower() for t in TABLA_NUEVA.findall(sin_comentarios)}
        for m in INDICE.finditer(sin_comentarios):
            if m.group(1).lower() in nuevas_tablas:
                continue
            linea = sin_comentarios[: m.start()].count("\n") + 1
            marca = "AVISO (aprobado)" if aprobado else "FALLA"
            print(f'{marca}  {carpeta.name}:{linea}  índice sobre "{m.group(1)}" sin CONCURRENTLY -> '
                  "bloquea sus escrituras mientras se construye (importa en tablas grandes)")
            fallas += 0 if aprobado else 1
    if fallas:
        print(f"\n{fallas} paso(s) que pueden cortar la operación. Si son a propósito, agrega "
              "'-- destructivo-aprobado: <motivo>' a la migración.")
        return 1
    print("Migraciones nuevas: solo agregan.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
