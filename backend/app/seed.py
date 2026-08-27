"""Siembra Postgres con datos de ejemplo para la demo (rutas/despachos/
clientes/vehiculos/usuarios — Ventas e Inventario ya no existen). Lee
backend/app/seed_data.json.

Uso:
  python -m app.seed           # trunca todo y siembra
  python -m app.seed --reset   # solo trunca, no siembra nada

Todos los usuarios sembrados comparten la misma contraseña temporal
("CambiarClave123!", ver seed_data.json) — deben cambiarla en su primer
login via PATCH /usuarios/{id}/password.
"""

from __future__ import annotations

import json
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

from app.core.db import get_connection

SEED_FILE = Path(__file__).resolve().parent / "seed_data.json"

# Un solo TRUNCATE con CASCADE resuelve el orden de dependencias entre ellas.
TABLES_TO_TRUNCATE = [
    "Sesion",
    "Usuario",
    "Almacen",
    "Cliente",
    "Vehiculo",
    "Despacho",
    "DespachoItem",
    "DespachoAprobacion",
    "Ruta",
    "RutaPunto",
]


def _dt(value: str | None) -> datetime | None:
    return datetime.fromisoformat(value) if value else None


def _insert(cur, table: str, row: dict[str, Any]) -> None:
    columns = list(row.keys())
    placeholders = ", ".join(["%s"] * len(columns))
    col_list = ", ".join(f'"{c}"' for c in columns)
    cur.execute(
        f'INSERT INTO "{table}" ({col_list}) VALUES ({placeholders})',
        [row[c] for c in columns],
    )


# Contraseña temporal compartida por todos los usuarios sembrados
# ("CambiarClave123!"), documentada fuera del repo para el equipo — deben
# cambiarla en su primer login.
SEED_PASSWORD_HASH = "$2b$12$UE9P6G65fsnB5Gt9PZRH7.SjbNitv6tqiaSIW8wMeKwatMIdLlbhu"


def seed(data: dict) -> None:
    with get_connection() as conn:
        with conn.cursor() as cur:
            tables_sql = ", ".join(f'"{t}"' for t in TABLES_TO_TRUNCATE)
            cur.execute(f"TRUNCATE TABLE {tables_sql} CASCADE")

            for u in data["usuarios"]:
                _insert(cur, "Usuario", {
                    "id": u["id"], "nombre": u["nombre"], "email": u["email"],
                    "passwordHash": SEED_PASSWORD_HASH,
                    "rol": u["rol"], "avatarUrl": u.get("avatarUrl"),
                    "activo": u["activo"],
                })

            for a in data["almacenes"]:
                _insert(cur, "Almacen", {
                    "id": a["id"], "nombre": a["nombre"], "tipo": a["tipo"],
                    "direccion": a["direccion"], "ciudad": a["ciudad"],
                    "lat": a["lat"], "lng": a["lng"],
                    "esFrigorifico": a["esFrigorifico"],
                })

            for c in data["clientes"]:
                _insert(cur, "Cliente", {
                    "id": c["id"], "empresa": c["empresa"], "codigo": c["codigo"],
                    "nombre": c["nombre"], "tipo": c["tipo"],
                    "direccion": c["direccion"], "ciudad": c["ciudad"],
                    "lat": c.get("lat"), "lng": c.get("lng"),
                    "telefono": c.get("telefono"), "email": c.get("email"),
                })

            for v in data["vehiculos"]:
                _insert(cur, "Vehiculo", {
                    "id": v["id"], "placa": v["placa"], "tipo": v["tipo"],
                    "capacidadKg": v["capacidadKg"],
                    "tieneRefrigeracion": v["tieneRefrigeracion"], "estado": v["estado"],
                    "almacenBaseId": v["almacenBaseId"],
                    "conductorNombre": v.get("conductorNombre"),
                    "ultimaRevision": _dt(v.get("ultimaRevision")),
                })

            for r in data["rutas"]:
                _insert(cur, "Ruta", {
                    "id": r["id"], "numero": r["numero"], "vehiculoId": r["vehiculoId"],
                    "origenId": r["origenId"], "creadoPorId": r["creadoPorId"],
                    "estado": r["estado"], "fechaCreacion": _dt(r["fechaCreacion"]),
                    "distanciaTotalKm": r.get("distanciaTotalKm"),
                    "tiempoTotalMin": r.get("tiempoTotalMin"),
                })

            for d in data["despachos"]:
                _insert(cur, "Despacho", {
                    "id": d["id"], "numero": d["numero"],
                    "numeroDocumento": d["numeroDocumento"],
                    "origenId": d["origenId"], "destinoClienteId": d["destinoClienteId"],
                    "creadoPorId": d["creadoPorId"], "estado": d["estado"],
                    "fechaCreacion": _dt(d["fechaCreacion"]),
                    "fechaEstimadaEntrega": _dt(d.get("fechaEstimadaEntrega")),
                    "rutaId": d.get("rutaId"), "ordenEnRuta": d.get("ordenEnRuta"),
                })
                for item in d["items"]:
                    _insert(cur, "DespachoItem", {
                        "id": item["id"], "despachoId": d["id"],
                        "descripcion": item["descripcion"], "cantidad": item["cantidad"],
                        # Sin dato historico de demanda para los despachos de ejemplo:
                        # se asume que lo solicitado coincidia con lo despachado.
                        "cantidadSolicitada": item["cantidad"],
                        "pesoUnitarioKg": item["pesoUnitarioKg"],
                        "requiereFrio": item["requiereFrio"],
                    })

            for ap in data["despachoAprobaciones"]:
                _insert(cur, "DespachoAprobacion", {
                    "id": ap["id"], "despachoId": ap["despachoId"],
                    "usuarioId": ap["usuarioId"], "accion": ap["accion"],
                    "comentario": ap.get("comentario"), "fecha": _dt(ap["fecha"]),
                })

            for rp in data["rutaPuntos"]:
                _insert(cur, "RutaPunto", {
                    "id": rp["id"], "rutaId": rp["rutaId"], "orden": rp["orden"],
                    "lat": rp["lat"], "lng": rp["lng"], "estado": rp["estado"],
                    "timestamp": _dt(rp["timestamp"]), "descripcion": rp.get("descripcion"),
                    "paradaDespachoId": rp.get("paradaDespachoId"),
                })

        conn.commit()


def reset() -> None:
    with get_connection() as conn:
        with conn.cursor() as cur:
            tables_sql = ", ".join(f'"{t}"' for t in TABLES_TO_TRUNCATE)
            cur.execute(f"TRUNCATE TABLE {tables_sql} CASCADE")
        conn.commit()
    print("Tablas vaciadas.")


def main() -> int:
    if "--reset" in sys.argv:
        reset()
        return 0

    if not SEED_FILE.exists():
        print(f"No existe {SEED_FILE}", file=sys.stderr)
        return 1

    data = json.loads(SEED_FILE.read_text(encoding="utf-8"))
    seed(data)
    print("Listo: datos de ejemplo sembrados en Postgres.")
    print('Contraseña temporal de todos los usuarios sembrados: "CambiarClave123!" (cambiar en el primer login).')
    return 0


if __name__ == "__main__":
    sys.exit(main())
