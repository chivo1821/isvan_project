"""Port de src/lib/fleet/suggest-vehiculo.ts — misma heuristica mock:
ranking de vehiculos disponibles por mejor ajuste de capacidad (el que sobra
menos sin quedar corto), filtrando por refrigeracion si el despacho la
requiere. Un solo almacen -> la cercania ya no es un criterio.
"""

from __future__ import annotations

from app.core.db import get_connection

PESO_PROMEDIO_KG = {"HELADO": 0.4, "PIZZA": 0.6}

# Mismo criterio que getVehiculosDisponibles() en src/lib/mock-data/index.ts.
ESTADOS_DESPACHO_ACTIVOS = ("PENDIENTE_APROBACION", "APROBADO", "EN_PREPARACION", "EN_TRANSITO")


def _estimar_peso_kg(items: list[dict]) -> float:
    return sum(item["cantidad"] * PESO_PROMEDIO_KG.get(item["categoria"], 0.5) for item in items)


def sugerir_vehiculos(despacho_id: str) -> list[dict]:
    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            'SELECT di."cantidad", p."categoria", p."requiereCadenaFrio" '
            'FROM "DespachoItem" di JOIN "Producto" p ON p."id" = di."productoId" '
            'WHERE di."despachoId" = %s',
            (despacho_id,),
        )
        items = cur.fetchall()
        if not items:
            return []

        peso_estimado_kg = round(_estimar_peso_kg(items))
        requiere_cadena_frio = any(item["requiereCadenaFrio"] for item in items)

        cur.execute(
            'SELECT v.* FROM "Vehiculo" v WHERE v."estado" = \'FUNCIONAL\' AND v."id" NOT IN ('
            '  SELECT d."vehiculoId" FROM "Despacho" d'
            '  WHERE d."estado" = ANY(%s) AND d."vehiculoId" IS NOT NULL'
            ')',
            (list(ESTADOS_DESPACHO_ACTIVOS),),
        )
        candidatos = [
            v for v in cur.fetchall()
            if v["capacidadKg"] >= peso_estimado_kg and (not requiere_cadena_frio or v["tieneRefrigeracion"])
        ]

    sugerencias = []
    for vehiculo in candidatos:
        holgura_kg = vehiculo["capacidadKg"] - peso_estimado_kg
        motivos = [f"Capacidad suficiente ({vehiculo['capacidadKg']:,.0f} kg / ~{peso_estimado_kg} kg estimados)"]
        if requiere_cadena_frio:
            motivos.append("Con refrigeración")
        sugerencias.append({"vehiculo": vehiculo, "holguraKg": holgura_kg, "motivos": motivos})

    sugerencias.sort(key=lambda s: s["holguraKg"])
    return sugerencias[:3]
