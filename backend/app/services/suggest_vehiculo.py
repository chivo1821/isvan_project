"""Ranking de vehiculos disponibles por mejor ajuste de capacidad (el que
sobra menos sin quedar corto) para el conjunto de despachos que se quieren
agrupar en una misma Ruta — filtra por refrigeracion si algun item la
requiere. El peso ya viene en cada DespachoItem (pesoUnitarioKg, cargado
desde el Excel o la carga manual — ya no hay catalogo de Producto del que
derivarlo). Un solo almacen -> la cercania ya no es un criterio.
"""

from __future__ import annotations

from app.core.db import get_connection

# Un vehiculo esta ocupado si ya esta asignado a una Ruta todavia activa.
RUTAS_ACTIVAS = ("PLANIFICADA", "EN_TRANSITO")


def sugerir_vehiculos(despacho_ids: list[str]) -> list[dict]:
    if not despacho_ids:
        return []

    with get_connection() as conn, conn.cursor() as cur:
        cur.execute(
            'SELECT "cantidad", "pesoUnitarioKg", "requiereFrio" FROM "DespachoItem" '
            'WHERE "despachoId" = ANY(%s)',
            (despacho_ids,),
        )
        items = cur.fetchall()
        if not items:
            return []

        peso_estimado_kg = round(sum(item["cantidad"] * item["pesoUnitarioKg"] for item in items))
        requiere_cadena_frio = any(item["requiereFrio"] for item in items)

        cur.execute(
            'SELECT v.* FROM "Vehiculo" v WHERE v."estado" = \'FUNCIONAL\' AND v."id" NOT IN ('
            '  SELECT r."vehiculoId" FROM "Ruta" r WHERE r."estado" = ANY(%s)'
            ")",
            (list(RUTAS_ACTIVAS),),
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
