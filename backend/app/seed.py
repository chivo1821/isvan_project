"""Siembra Postgres con los mismos datos de ejemplo que hoy ve el frontend
en Fase 1 (src/lib/mock-data/*.ts), para la demo. Lee
backend/app/seed_data.json (generado por scripts/export-mock-data.ts — no
se edita a mano).

Uso:
  python -m app.seed           # trunca todo (menos TasaCambio) y siembra
  python -m app.seed --reset   # solo trunca, no siembra nada (para despues de la demo)

TasaCambio es la unica tabla que NO se trunca: ya tiene datos reales del
sync diario (ver app/jobs/sync_tasa_bcv.py) y no queremos perderlos. Las
filas mock de tasasCambio se agregan con ON CONFLICT (fecha) DO NOTHING, asi
que nunca pisan una tasa real ya sincronizada.
"""

from __future__ import annotations

import json
import sys
from datetime import datetime
from decimal import Decimal
from pathlib import Path
from typing import Any

from app.core.db import get_connection

SEED_FILE = Path(__file__).resolve().parent / "seed_data.json"

# Todas menos TasaCambio (ver docstring). Un solo TRUNCATE con CASCADE
# resuelve el orden de dependencias entre ellas.
TABLES_TO_TRUNCATE = [
    "Usuario",
    "Producto",
    "Almacen",
    "StockAlmacen",
    "Cliente",
    "Factura",
    "Vehiculo",
    "Venta",
    "VentaItem",
    "VentaRevision",
    "Despacho",
    "DespachoItem",
    "DespachoAprobacion",
    "RutaPunto",
]


def _dt(value: str | None) -> datetime | None:
    return datetime.fromisoformat(value) if value else None


def _dec(value: Any) -> Decimal | None:
    return Decimal(str(value)) if value is not None else None


def _insert(cur, table: str, row: dict[str, Any]) -> None:
    columns = list(row.keys())
    placeholders = ", ".join(["%s"] * len(columns))
    col_list = ", ".join(f'"{c}"' for c in columns)
    cur.execute(
        f'INSERT INTO "{table}" ({col_list}) VALUES ({placeholders})',
        [row[c] for c in columns],
    )


def seed(data: dict) -> None:
    with get_connection() as conn:
        with conn.cursor() as cur:
            tables_sql = ", ".join(f'"{t}"' for t in TABLES_TO_TRUNCATE)
            cur.execute(f"TRUNCATE TABLE {tables_sql} CASCADE")

            for u in data["usuarios"]:
                _insert(cur, "Usuario", {
                    "id": u["id"], "nombre": u["nombre"], "email": u["email"],
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

            for p in data["productos"]:
                _insert(cur, "Producto", {
                    "id": p["id"], "sku": p["sku"], "nombre": p["nombre"],
                    "categoria": p["categoria"], "subcategoria": p.get("subcategoria"),
                    "unidadMedida": p["unidadMedida"],
                    "requiereCadenaFrio": p["requiereCadenaFrio"],
                    "temperaturaMinC": p.get("temperaturaMinC"),
                    "temperaturaMaxC": p.get("temperaturaMaxC"),
                    "precioUnitario": _dec(p["precioUnitario"]),
                    "imagenUrl": p.get("imagenUrl"), "activo": p["activo"],
                })

            for s in data["stock"]:
                _insert(cur, "StockAlmacen", {
                    "id": s["id"], "productoId": s["productoId"],
                    "almacenId": s["almacenId"], "cantidad": s["cantidad"],
                    "stockMinimo": s["stockMinimo"],
                })

            for c in data["clientes"]:
                _insert(cur, "Cliente", {
                    "codigo": c["codigo"], "nombre": c["nombre"], "tipo": c["tipo"],
                    "direccion": c["direccion"], "ciudad": c["ciudad"],
                    "lat": c.get("lat"), "lng": c.get("lng"),
                    "telefono": c.get("telefono"), "email": c.get("email"),
                })

            for f in data["facturas"]:
                _insert(cur, "Factura", {
                    "id": f["id"], "numero": f["numero"], "clienteId": f["clienteId"],
                    "monto": _dec(f["monto"]), "fechaEmision": _dt(f["fechaEmision"]),
                    "fechaVencimiento": _dt(f["fechaVencimiento"]), "estado": f["estado"],
                    "tasaBcv": _dec(f["tasaBcv"]), "fechaPago": _dt(f.get("fechaPago")),
                    "montoPagado": _dec(f.get("montoPagado")),
                    "metodoPago": f.get("metodoPago"), "pagoAprobado": f["pagoAprobado"],
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

            for venta in data["ventas"]:
                _insert(cur, "Venta", {
                    "id": venta["id"], "numero": venta["numero"],
                    "clienteId": venta["clienteId"], "vendedorId": venta["vendedorId"],
                    "fecha": _dt(venta["fecha"]), "estado": venta["estado"],
                    "total": _dec(venta["total"]), "tasaBcv": _dec(venta["tasaBcv"]),
                })
                for item in venta["items"]:
                    _insert(cur, "VentaItem", {
                        "id": item["id"], "ventaId": venta["id"],
                        "productoId": item["productoId"], "cantidad": item["cantidad"],
                        "precioUnitario": _dec(item["precioUnitario"]),
                        "subtotal": _dec(item["subtotal"]),
                    })

            for r in data["ventaRevisiones"]:
                _insert(cur, "VentaRevision", {
                    "id": r["id"], "ventaId": r["ventaId"], "usuarioId": r["usuarioId"],
                    "accion": r["accion"], "comentario": r.get("comentario"),
                    "fecha": _dt(r["fecha"]),
                })

            for d in data["despachos"]:
                _insert(cur, "Despacho", {
                    "id": d["id"], "numero": d["numero"], "ventaId": d.get("ventaId"),
                    "origenId": d["origenId"], "destinoClienteId": d["destinoClienteId"],
                    "creadoPorId": d["creadoPorId"], "estado": d["estado"],
                    "fechaCreacion": _dt(d["fechaCreacion"]),
                    "fechaEstimadaEntrega": _dt(d.get("fechaEstimadaEntrega")),
                    "vehiculoId": d.get("vehiculoId"),
                    "distanciaEstimadaKm": d.get("distanciaEstimadaKm"),
                    "tiempoEstimadoMin": d.get("tiempoEstimadoMin"),
                    "rutaCalculada": d["rutaCalculada"],
                })
                for item in d["items"]:
                    _insert(cur, "DespachoItem", {
                        "id": item["id"], "despachoId": d["id"],
                        "productoId": item["productoId"], "cantidad": item["cantidad"],
                    })

            for ap in data["despachoAprobaciones"]:
                _insert(cur, "DespachoAprobacion", {
                    "id": ap["id"], "despachoId": ap["despachoId"],
                    "usuarioId": ap["usuarioId"], "accion": ap["accion"],
                    "comentario": ap.get("comentario"), "fecha": _dt(ap["fecha"]),
                })

            for rp in data["rutaPuntos"]:
                _insert(cur, "RutaPunto", {
                    "id": rp["id"], "despachoId": rp["despachoId"], "orden": rp["orden"],
                    "lat": rp["lat"], "lng": rp["lng"], "estado": rp["estado"],
                    "timestamp": _dt(rp["timestamp"]), "descripcion": rp.get("descripcion"),
                })

            # TasaCambio: nunca se trunca (ver docstring). Se agregan las
            # filas mock que falten, sin pisar una tasa real ya sincronizada.
            for t in data["tasasCambio"]:
                cur.execute(
                    'INSERT INTO "TasaCambio" ("id", "fecha", "tasa") VALUES (%s, %s, %s) '
                    'ON CONFLICT ("fecha") DO NOTHING',
                    (t["id"], _dt(t["fecha"]), _dec(t["tasa"])),
                )

        conn.commit()


def reset() -> None:
    with get_connection() as conn:
        with conn.cursor() as cur:
            tables_sql = ", ".join(f'"{t}"' for t in TABLES_TO_TRUNCATE)
            cur.execute(f"TRUNCATE TABLE {tables_sql} CASCADE")
        conn.commit()
    print("Tablas vaciadas (TasaCambio no se toca).")


def main() -> int:
    if "--reset" in sys.argv:
        reset()
        return 0

    if not SEED_FILE.exists():
        print(f"No existe {SEED_FILE} — corre primero: npx tsx scripts/export-mock-data.ts", file=sys.stderr)
        return 1

    data = json.loads(SEED_FILE.read_text(encoding="utf-8"))
    seed(data)
    print("Listo: datos de ejemplo sembrados en Postgres.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
