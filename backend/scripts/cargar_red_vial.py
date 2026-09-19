"""Carga la red vial en la base para calcular rutas con pgRouting.

Se corre a mano cuando hay que montar o actualizar la red:

    backend/.venv/Scripts/python.exe backend/scripts/cargar_red_vial.py "C:/ruta/redes_venezuela.shp"

Acepta el shapefile directo (lo convierte con ogr2ogr) o un CSV ya
convertido con la geometria en WKT. Reemplaza la red anterior, recalcula los
nodos y deja un resumen en RedVialCarga.

La velocidad NO se toma del dato original: el archivo de OpenStreetMap trae
maxspeed en pocos tramos (16.667 de 272.955 residenciales), asi que se
asigna por tipo de via con la tabla de abajo, que es pareja y facil de
ajustar.
"""

from __future__ import annotations

import argparse
import csv
import io
import os
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.db import get_connection  # noqa: E402

# Velocidad de recorrido por clase de via (km/h). Es lo que decide el orden
# de las paradas y el tiempo estimado del viaje.
VELOCIDAD_POR_TIPO: dict[str, float] = {
    "motorway": 90,
    "motorway_link": 50,
    "trunk": 80,
    "trunk_link": 45,
    "primary": 65,
    "primary_link": 40,
    "secondary": 55,
    "secondary_link": 35,
    "tertiary": 45,
    "tertiary_link": 30,
    "unclassified": 35,
    "residential": 30,
    "living_street": 15,
    "service": 15,
    "busway": 25,
    "track": 20,
    "track_grade1": 25,
    "track_grade2": 20,
    "track_grade3": 18,
    "track_grade4": 15,
    "track_grade5": 12,
    "unknown": 25,
}
VELOCIDAD_POR_DEFECTO = 25

# No se cargan: no son transitables en vehiculo y solo engordan la red.
TIPOS_EXCLUIDOS = {"footway", "path", "steps", "pedestrian", "bridleway", "cycleway"}

OGR2OGR = r"C:\Program Files\PostgreSQL\17\bin\ogr2ogr.exe"
COLUMNAS = ["WKT", "osm_id", "fclass", "name", "ref", "oneway", "maxspeed", "bridge", "tunnel"]


def convertir_a_csv(origen: Path, destino: Path) -> Path:
    """Shapefile (o cualquier formato que lea GDAL) -> CSV con la geometria
    en WKT, que es lo que se puede meter con COPY."""
    if destino.exists():
        print(f"  ya existe {destino.name}, se reutiliza")
        return destino
    print(f"  convirtiendo {origen.name} a CSV...")
    subprocess.run(
        [OGR2OGR, "-f", "CSV", str(destino), str(origen),
         "-lco", "GEOMETRY=AS_WKT", "-lco", "CREATE_CSVT=NO",
         "-select", "osm_id,fclass,name,ref,oneway,maxspeed,bridge,tunnel",
         "-t_srs", "EPSG:4326"],
        check=True,
    )
    return destino


# Hay geometrias con miles de vertices: el limite por defecto del lector CSV
# (128 KB por campo) se queda corto.
csv.field_size_limit(2**31 - 1)


def copiar_a_staging(cur, csv_path: Path) -> int:
    cur.execute('DROP TABLE IF EXISTS "red_vial_staging"')
    cur.execute(
        'CREATE UNLOGGED TABLE "red_vial_staging" ('
        "wkt text, osm_id text, fclass text, nombre text, ref text, "
        "oneway text, maxspeed text, bridge text, tunnel text)"
    )
    filas = 0
    with csv_path.open("r", encoding="utf-8", newline="") as fh:
        lector = csv.reader(fh)
        encabezado = next(lector)
        if [c.lower() for c in encabezado[:3]] != ["wkt", "osm_id", "fclass"]:
            raise SystemExit(f"El CSV no tiene las columnas esperadas: {encabezado}")
        with cur.copy('COPY "red_vial_staging" FROM STDIN') as copy:
            for fila in lector:
                copy.write_row(fila[: len(COLUMNAS)])
                filas += 1
    return filas


def normalizar(cur) -> dict:
    """De la tabla cruda a RedVialTramo: geometria, longitud, velocidad por
    tipo y costo en minutos. Los tramos de un solo sentido llevan -1 en la
    direccion bloqueada, que es como pgRouting los descarta."""
    velocidades = ", ".join(f"('{tipo}', {kmh})" for tipo, kmh in VELOCIDAD_POR_TIPO.items())
    excluidos = ", ".join(f"'{t}'" for t in TIPOS_EXCLUIDOS)
    cur.execute(
        f"""
        WITH velocidad(tipo, kmh) AS (VALUES {velocidades}),
        limpio AS (
            SELECT s.osm_id,
                   s.fclass AS tipo,
                   NULLIF(s.nombre, '') AS nombre,
                   CASE WHEN s.oneway IN ('F', 'T') THEN s.oneway ELSE 'B' END AS sentido,
                   COALESCE(v.kmh, {VELOCIDAD_POR_DEFECTO}) AS kmh,
                   ST_GeomFromText(s.wkt, 4326) AS geom
            FROM "red_vial_staging" s
            LEFT JOIN velocidad v ON v.tipo = s.fclass
            WHERE s.fclass NOT IN ({excluidos})
        )
        INSERT INTO "RedVialTramo" ("osmId", "tipo", "nombre", "sentido", "velocidadKmh",
                                    "longitudM", "costoMin", "costoMinInverso", "geom")
        SELECT osm_id, tipo, nombre, sentido, kmh,
               ST_Length(geom::geography) AS longitud,
               -- minutos = km / (km/h) * 60; -1 bloquea esa direccion.
               CASE WHEN sentido = 'T' THEN -1
                    ELSE GREATEST(ST_Length(geom::geography) / 1000 / kmh * 60, 0.001) END,
               CASE WHEN sentido = 'F' THEN -1
                    ELSE GREATEST(ST_Length(geom::geography) / 1000 / kmh * 60, 0.001) END,
               geom
        FROM limpio
        WHERE geom IS NOT NULL AND ST_NumPoints(geom) >= 2
        """
    )
    insertados = cur.rowcount
    cur.execute('SELECT COUNT(*) AS n FROM "red_vial_staging"')
    leidos = cur.fetchone()["n"]
    cur.execute(
        "SELECT COUNT(*) AS n FROM \"red_vial_staging\" WHERE maxspeed IS NULL OR maxspeed IN ('', '0')"
    )
    sin_velocidad = cur.fetchone()["n"]
    return {"leidos": leidos, "insertados": insertados, "sinVelocidad": sin_velocidad}


def partir_en_cruces(cur) -> dict:
    """Parte cada via en sus cruces con otras.

    En OpenStreetMap, dos vias que se cruzan comparten un nodo, y el
    shapefile lo conserva como un VERTICE con las mismas coordenadas en las
    dos lineas... pero no corta las lineas ahi. Sin este paso la red queda en
    fragmentos: el nodo mas cercano a un cliente toca una sola calle y no hay
    camino a ningun lado.

    Partir por los vertices compartidos es lo mismo que calcular las
    intersecciones geometricas, pero muchisimo mas barato: sobre Caracas
    tarda un segundo, contra mas de diez minutos de pgr_separateCrossing.
    """
    cur.execute('DROP TABLE IF EXISTS "red_vial_cruces"')
    cur.execute(
        'CREATE UNLOGGED TABLE "red_vial_cruces" AS '
        "SELECT ST_SetSRID(ST_MakePoint(x, y), 4326) AS geom FROM ("
        '  SELECT ST_X(p.geom) AS x, ST_Y(p.geom) AS y '
        '  FROM "RedVialTramo" t, LATERAL ST_DumpPoints(t."geom") p '
        '  GROUP BY 1, 2 HAVING COUNT(DISTINCT t."id") > 1'
        ") v"
    )
    cruces = cur.rowcount
    cur.execute('CREATE INDEX ON "red_vial_cruces" USING GIST (geom)')
    cur.execute('ANALYZE "red_vial_cruces"')

    cur.execute('DROP TABLE IF EXISTS "red_vial_partido"')
    cur.execute(
        'CREATE UNLOGGED TABLE "red_vial_partido" AS '
        'SELECT t."osmId", t."tipo", t."nombre", t."sentido", t."velocidadKmh", '
        '       COALESCE(piezas.geom, t."geom") AS geom '
        'FROM "RedVialTramo" t '
        "LEFT JOIN LATERAL ("
        '  SELECT (ST_Dump(ST_Split(t."geom", ST_Collect(c.geom)))).geom AS geom '
        '  FROM "red_vial_cruces" c '
        '  WHERE c.geom && t."geom" AND ST_Intersects(c.geom, t."geom") '
        # Los extremos ya son nodos: partir ahi no aporta y solo duplica filas.
        '    AND NOT ST_Equals(c.geom, ST_StartPoint(t."geom")) '
        '    AND NOT ST_Equals(c.geom, ST_EndPoint(t."geom"))'
        ") piezas ON true"
    )
    piezas = cur.rowcount

    cur.execute('TRUNCATE "RedVialTramo" RESTART IDENTITY CASCADE')
    cur.execute(
        'INSERT INTO "RedVialTramo" ("osmId", "tipo", "nombre", "sentido", "velocidadKmh", '
        '                            "longitudM", "costoMin", "costoMinInverso", "geom") '
        'SELECT "osmId", "tipo", "nombre", "sentido", "velocidadKmh", '
        '       ST_Length(geom::geography), '
        "       CASE WHEN \"sentido\" = 'T' THEN -1 "
        '            ELSE GREATEST(ST_Length(geom::geography) / 1000 / "velocidadKmh" * 60, 0.001) END, '
        "       CASE WHEN \"sentido\" = 'F' THEN -1 "
        '            ELSE GREATEST(ST_Length(geom::geography) / 1000 / "velocidadKmh" * 60, 0.001) END, '
        '       geom '
        'FROM "red_vial_partido" '
        "WHERE ST_NumPoints(geom) >= 2 AND ST_Length(geom::geography) > 0"
    )
    tramos = cur.rowcount
    cur.execute('DROP TABLE "red_vial_partido"')
    cur.execute('DROP TABLE "red_vial_cruces"')
    return {"cruces": cruces, "piezas": piezas, "tramos": tramos}


def construir_nodos(cur) -> int:
    """Los cruces salen de los extremos de los tramos. pgr_extractVertices
    los numera y dice que tramo empieza y termina en cada uno."""
    cur.execute('DROP TABLE IF EXISTS "red_vial_vertices"')
    cur.execute(
        'CREATE UNLOGGED TABLE "red_vial_vertices" AS '
        "SELECT * FROM pgr_extractVertices("
        # pgRouting 3.3+ espera las columnas "id" y "geom" tal cual: con el
        # nombre viejo (the_geom) falla diciendo que no existe "geom".
        '\'SELECT "id", "geom" FROM "RedVialTramo" ORDER BY "id"\')'
    )
    cur.execute('INSERT INTO "RedVialNodo" ("id", "geom") SELECT id, geom FROM "red_vial_vertices"')
    nodos = cur.rowcount
    # out_edges: tramos que arrancan en ese nodo; in_edges: los que terminan.
    cur.execute(
        'UPDATE "RedVialTramo" t SET "source" = v.id '
        'FROM (SELECT id, unnest(out_edges) AS eid FROM "red_vial_vertices") v WHERE t."id" = v.eid'
    )
    cur.execute(
        'UPDATE "RedVialTramo" t SET "target" = v.id '
        'FROM (SELECT id, unnest(in_edges) AS eid FROM "red_vial_vertices") v WHERE t."id" = v.eid'
    )
    cur.execute('DROP TABLE "red_vial_vertices"')
    return nodos


def revisar(cur) -> dict:
    """Chequeo de la red cargada: que tan conectada quedo y si cubre donde
    estan los clientes."""
    cur.execute(
        'SELECT COUNT(*) AS tramos, COUNT(*) FILTER (WHERE "source" IS NULL OR "target" IS NULL) AS sin_topologia, '
        'ROUND(SUM("longitudM")::numeric / 1000) AS km_totales, '
        'ROUND(ST_XMin(ST_Extent("geom"))::numeric, 3) AS oeste, ROUND(ST_YMin(ST_Extent("geom"))::numeric, 3) AS sur, '
        'ROUND(ST_XMax(ST_Extent("geom"))::numeric, 3) AS este, ROUND(ST_YMax(ST_Extent("geom"))::numeric, 3) AS norte '
        'FROM "RedVialTramo"'
    )
    resumen = dict(cur.fetchone())

    # Que tan lejos queda cada cliente del nodo mas cercano: si un cliente
    # esta a kilometros de la red, sus rutas no van a salir bien.
    cur.execute(
        'SELECT COUNT(*) AS clientes, '
        "  ROUND(AVG(d)::numeric, 1) AS distancia_media_m, ROUND(MAX(d)::numeric) AS peor_m, "
        "  COUNT(*) FILTER (WHERE d > 500) AS lejos_de_500m "
        "FROM ("
        '  SELECT (SELECT ST_Distance(c.punto, n."geom"::geography) FROM "RedVialNodo" n '
        "          ORDER BY n.\"geom\" <-> c.punto::geometry LIMIT 1) AS d "
        '  FROM (SELECT ST_SetSRID(ST_MakePoint("lng", "lat"), 4326)::geography AS punto '
        '        FROM "Cliente" WHERE "lat" IS NOT NULL AND "lng" IS NOT NULL '
        '          AND NOT (abs("lat") < 1e-6 AND abs("lng") < 1e-6)) c'
        ") t"
    )
    resumen["clientes"] = dict(cur.fetchone())

    cur.execute(
        "SELECT pg_size_pretty(pg_total_relation_size('\"RedVialTramo\"')) AS tramos, "
        "       pg_size_pretty(pg_total_relation_size('\"RedVialNodo\"')) AS nodos"
    )
    resumen["tamano"] = dict(cur.fetchone())
    return resumen


def main() -> None:
    parser = argparse.ArgumentParser(description="Carga la red vial para pgRouting")
    parser.add_argument("archivo", help="Shapefile (.shp), GeoPackage, GeoJSON o CSV con WKT")
    parser.add_argument("--csv", help="Ruta del CSV intermedio (por defecto, junto al archivo)")
    parser.add_argument("--forzar", action="store_true",
                        help="Permite correrlo contra una base que no es local (no recomendado)")
    args = parser.parse_args()

    origen = Path(args.archivo)
    if not origen.exists():
        raise SystemExit(f"No existe el archivo {origen}")

    url = os.environ.get("DATABASE_URL", "")
    servidor = url.split("@")[-1].split("/")[0] if "@" in url else "la del .env"
    print(f"Base: {servidor}")

    # Armar la red son varios minutos de CPU y casi millon y medio de
    # escrituras en UNA transaccion, con tablas UNLOGGED de por medio. Contra
    # una base remota eso se corta a la mitad y no queda nada. La red se arma
    # en local y despues se copia con copiar_red_vial.py.
    if not args.forzar and not any(local in servidor for local in ("localhost", "127.0.0.1", "::1")):
        raise SystemExit(
            f"Esta base no es local ({servidor}).\n"
            "Arma la red en local con este script y despues copiala con:\n"
            "    backend/.venv/Scripts/python.exe backend/scripts/copiar_red_vial.py --origen <local> --destino <remota>\n"
            "Si de verdad quieres cargarla directo aqui, agrega --forzar."
        )

    csv_path = Path(args.csv) if args.csv else origen.with_suffix(".csv")
    if origen.suffix.lower() == ".csv":
        csv_path = origen
    else:
        csv_path = convertir_a_csv(origen, csv_path)

    inicio = time.time()
    with get_connection() as conn, conn.cursor() as cur:
        print("1/6 copiando el archivo a una tabla temporal...")
        filas = copiar_a_staging(cur, csv_path)
        print(f"    {filas:,} filas")

        print("2/6 vaciando la red anterior...")
        cur.execute('TRUNCATE "RedVialNodo"')
        cur.execute('TRUNCATE "RedVialTramo" RESTART IDENTITY CASCADE')
        cur.execute('TRUNCATE "RutaCalculada"')  # la cache vieja ya no vale

        print("3/6 normalizando tramos (velocidad por tipo de via)...")
        datos = normalizar(cur)
        print(f"    {datos['insertados']:,} tramos cargados, {datos['leidos'] - datos['insertados']:,} descartados")

        print("4/6 partiendo las vías en sus cruces...")
        corte = partir_en_cruces(cur)
        print(f"    {corte['cruces']:,} cruces · {datos['insertados']:,} vías -> {corte['tramos']:,} tramos")

        print("5/6 armando los nodos de la red...")
        nodos = construir_nodos(cur)
        print(f"    {nodos:,} nodos")

        print("6/6 revisando y guardando el resumen...")
        cur.execute('ANALYZE "RedVialTramo"')
        cur.execute('ANALYZE "RedVialNodo"')
        resumen = revisar(cur)
        resumen["cruces"] = corte["cruces"]
        resumen["viasDelArchivo"] = datos["insertados"]
        cur.execute('DROP TABLE IF EXISTS "red_vial_staging"')
        cur.execute(
            'INSERT INTO "RedVialCarga" ("id", "archivo", "tramos", "nodos", "tramosDescartados", '
            '"tramosSinVelocidad", "resumen") VALUES (%s, %s, %s, %s, %s, %s, %s)',
            (
                f"redvial-{int(time.time())}",
                origen.name,
                corte["tramos"],
                nodos,
                datos["leidos"] - datos["insertados"],
                datos["sinVelocidad"],
                __import__("json").dumps(resumen, default=str),
            ),
        )
        conn.commit()

    # Armar la red deja la tabla inflada al triple: cada UPDATE de "source" y
    # "target" reescribe la fila entera y las versiones viejas quedan ocupando
    # lugar. Compactarla aqui ahorra ~700 MB y acelera las consultas.
    print("compactando las tablas...")
    with get_connection() as conn:
        conn.autocommit = True  # VACUUM no corre dentro de una transaccion
        with conn.cursor() as cur:
            for tabla in ("RedVialTramo", "RedVialNodo"):
                cur.execute(f'VACUUM (FULL, ANALYZE) "{tabla}"')
            cur.execute(
                "SELECT pg_size_pretty(pg_total_relation_size('\"RedVialTramo\"')) AS tramos, "
                "       pg_size_pretty(pg_total_relation_size('\"RedVialNodo\"')) AS nodos"
            )
            resumen["tamano"] = dict(cur.fetchone())

    print(f"\nListo en {time.time() - inicio:.0f} s")
    for clave, valor in resumen.items():
        print(f"  {clave}: {valor}")


if __name__ == "__main__":
    main()
