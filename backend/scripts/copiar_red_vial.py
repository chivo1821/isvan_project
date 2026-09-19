"""Copia la red vial ya construida de una base a otra (de la local a Neon).

cargar_red_vial.py arma la red desde el shapefile: parte las vias en sus
cruces, numera los nodos y calcula los costos. Eso son varios minutos de CPU
y casi un millon y medio de escrituras en una sola transaccion, que contra
una base remota es fragil: si la conexion se corta a la mitad, se pierde
todo el trabajo.

Este script hace lo otro: la red se arma una sola vez en local y despues se
copia tal cual. Va por lotes, confirma cada lote y se puede volver a correr
tantas veces como haga falta, que retoma donde quedo.

    $env:RED_VIAL_ORIGEN  = "postgresql://...@localhost:5433/gestion_logistica"
    $env:RED_VIAL_DESTINO = "postgresql://...@ep-xxx.neon.tech/neondb?sslmode=require"
    backend/.venv/Scripts/python.exe backend/scripts/copiar_red_vial.py

Si no se define RED_VIAL_DESTINO se usa DATABASE_URL del .env.

Opciones utiles cuando el destino tiene el espacio contado:

    --zona ESTADO_4326.shp --estados "Miranda,Aragua,..."
                        copia solo la red de esos estados (del archivo de
                        poligonos que se le pase), con --margen km de
                        holgura para no cortar vias en el limite.
    --troncales         ademas, las autopistas y vias principales de todo el
                        pais: con eso un cliente lejano sigue teniendo ruta
                        por carretera en vez de caer al respaldo.
    --medir             dice cuanto ocuparia todo eso sin tocar el destino.
    --sin-indices       borra los indices del destino durante la carga y los
                        recrea al final: bastante mas rapido con el GIST.
    --simplificar 3     quita vertices del dibujo (3 m de tolerancia) sin
                        mover los extremos, asi que la topologia y los
                        costos ya calculados siguen valiendo. Rinde poco.

Deja dos tablas auxiliares en la base de ORIGEN (red_vial_zona y
red_vial_copia_nodos), que se rehacen en cada corrida.
"""

from __future__ import annotations

import argparse
import csv
import os
import shutil
import subprocess
import sys
import tempfile
import time
import unicodedata
from pathlib import Path

import psycopg
from psycopg.rows import dict_row
from dotenv import dotenv_values

PROJECT_ROOT = Path(__file__).resolve().parents[2]

OGR2OGR = r"C:\Program Files\PostgreSQL\17\bin\ogr2ogr.exe"

# El contorno de un estado son miles de vertices: el limite por defecto del
# lector CSV (128 KB por campo) se queda corto.
csv.field_size_limit(2**31 - 1)

# Un grado de latitud son ~111.320 m: la tolerancia se pide en metros, que es
# como se piensa, pero ST_SimplifyPreserveTopology trabaja en grados.
METROS_POR_GRADO = 111_320.0

# Tamano del lote (en ids, no en filas: puede haber huecos). Lo bastante
# grande para no pagar ida y vuelta por cada poco, lo bastante chico para que
# un corte cueste segundos y no horas.
LOTE = 50_000
REINTENTOS = 5

COLUMNAS_TRAMO = (
    '"id", "osmId", "source", "target", "costoMin", "costoMinInverso", '
    '"longitudM", "velocidadKmh", "tipo", "nombre", "sentido", "geom"'
)


def con_keepalives(url: str) -> str:
    """Postgres cierra la conexion si el enlace queda mudo un rato; en una
    copia larga contra un servidor remoto eso pasa. Los keepalives del socket
    la mantienen viva."""
    extra = "keepalives=1&keepalives_idle=30&keepalives_interval=10&keepalives_count=5&connect_timeout=30"
    return url + ("&" if "?" in url else "?") + extra


def conectar(url: str) -> psycopg.Connection:
    return psycopg.connect(con_keepalives(url), row_factory=dict_row, autocommit=False)


def donde(url: str) -> str:
    """servidor/base, sin credenciales: sirve para mostrar y para no copiarse
    una base sobre si misma."""
    sin_credenciales = url.split("@")[-1] if "@" in url else url
    return sin_credenciales.split("?")[0].rstrip("/")


def revisar_destino(dest: psycopg.Connection) -> None:
    with dest.cursor() as cur:
        cur.execute("SELECT extname FROM pg_extension WHERE extname IN ('postgis', 'pgrouting')")
        extensiones = {f["extname"] for f in cur.fetchall()}
        faltan = {"postgis", "pgrouting"} - extensiones
        if faltan:
            raise SystemExit(f"Al destino le faltan extensiones: {', '.join(sorted(faltan))}")
        cur.execute(
            "SELECT to_regclass('public.\"RedVialTramo\"') AS tramo, "
            "       to_regclass('public.\"RedVialNodo\"') AS nodo"
        )
        fila = cur.fetchone()
        if not fila["tramo"] or not fila["nodo"]:
            raise SystemExit("Faltan las tablas de la red en el destino: corre antes 'npx prisma migrate deploy'")
    dest.rollback()


def rango(conn: psycopg.Connection, tabla: str, filtro: str = "") -> tuple[int, int, int]:
    donde = f" WHERE {filtro}" if filtro else ""
    with conn.cursor() as cur:
        cur.execute(
            f'SELECT COALESCE(MIN("id"), 0) AS min, COALESCE(MAX("id"), 0) AS max, COUNT(*) AS n '
            f'FROM "{tabla}" t{donde}'
        )
        fila = cur.fetchone()
    conn.rollback()
    return fila["min"], fila["max"], fila["n"]


def ya_copiado(dest: psycopg.Connection, tabla: str) -> tuple[int, int]:
    """Hasta que id llego la copia anterior, y cuantas filas hay."""
    with dest.cursor() as cur:
        cur.execute(f'SELECT COALESCE(MAX("id"), 0) AS hasta, COUNT(*) AS n FROM "{tabla}"')
        fila = cur.fetchone()
    dest.rollback()
    return fila["hasta"], fila["n"]


def indices(dest: psycopg.Connection, tablas: list[str]) -> list[dict]:
    """Los indices del destino que no respaldan una constraint: esos si se
    pueden borrar y recrear."""
    with dest.cursor() as cur:
        cur.execute(
            "SELECT i.indexname AS nombre, i.indexdef AS definicion FROM pg_indexes i "
            "WHERE i.schemaname = 'public' AND i.tablename = ANY(%s) "
            "  AND NOT EXISTS (SELECT 1 FROM pg_constraint c "
            "                  WHERE c.conindid = (i.schemaname || '.\"' || i.indexname || '\"')::regclass)",
            (tablas,),
        )
        filas = [dict(f) for f in cur.fetchall()]
    dest.rollback()
    return filas


# Los indices que la red necesita si o si, como los crea la migracion. Estan
# aqui y no solo en el destino porque una corrida anterior que se haya quedado
# a medias pudo dejarlos borrados: entonces no hay nada que "restaurar" y hay
# que saber cuales son. Sin ellos la red esta cargada pero cada consulta barre
# la tabla entera.
INDICES_RED = (
    ('RedVialTramo_source_idx', 'CREATE INDEX "RedVialTramo_source_idx" ON "RedVialTramo"("source")'),
    ('RedVialTramo_target_idx', 'CREATE INDEX "RedVialTramo_target_idx" ON "RedVialTramo"("target")'),
    ('RedVialTramo_geom_idx', 'CREATE INDEX "RedVialTramo_geom_idx" ON "RedVialTramo" USING GIST ("geom")'),
    ('RedVialNodo_geom_idx', 'CREATE INDEX "RedVialNodo_geom_idx" ON "RedVialNodo" USING GIST ("geom")'),
)


def asegurar_indices(dest: psycopg.Connection, guardados: list[dict]) -> list[dict]:
    """Deja el destino con todos sus indices: los que se quitaron para la
    carga y los que ya faltaban de antes. Devuelve los que no se pudieron
    crear (tipicamente, por falta de espacio)."""
    existentes = {i["nombre"] for i in indices(dest, ["RedVialTramo", "RedVialNodo"])}
    pendientes = [i for i in guardados if i["nombre"] not in existentes]
    conocidos = existentes | {i["nombre"] for i in pendientes}
    pendientes += [{"nombre": n, "definicion": d} for n, d in INDICES_RED if n not in conocidos]
    if not pendientes:
        return []

    print(f"Creando {len(pendientes)} indices (esto tarda)...")
    faltan = []
    for i in pendientes:
        print(f"    {i['nombre']}")
        try:
            with dest.cursor() as cur:
                cur.execute(i["definicion"])
            # Uno por transaccion: si el ultimo falla (tipico cuando el destino
            # se queda sin espacio), los anteriores se quedan hechos.
            dest.commit()
        except psycopg.Error as e:
            dest.rollback()
            faltan.append(i)
            print(f"      no se pudo: {str(e).strip()}")
    return faltan


def _sin_tildes(texto: str) -> str:
    sin = unicodedata.normalize("NFKD", texto or "")
    return " ".join("".join(c for c in sin if not unicodedata.combining(c)).lower().split())


# Como suele venir escrito cada estado en los archivos que andan dando vueltas.
ALIAS_ESTADOS = {
    "la guaira": {"la guaira", "vargas"},
    "distrito capital": {"distrito capital", "dtto capital", "distrito federal", "caracas"},
    "carabobo": {"carabobo", "valencia"},
}


def cargar_zona(orig: psycopg.Connection, archivo: Path, estados: list[str], campo: str | None,
                margen_km: float) -> dict:
    """Deja en la base de origen la tabla red_vial_zona con el area a copiar,
    sacada de un archivo de poligonos (shapefile, GeoPackage, GeoJSON...).

    El margen agranda la zona: una via que bordea el limite del estado sigue
    haciendo falta para llegar a los clientes de adentro."""
    if archivo.suffix.lower() == ".csv":
        csv_path = archivo
        temporal = None
    else:
        temporal = Path(tempfile.mkdtemp(prefix="zona_"))
        csv_path = temporal / "zona.csv"
        subprocess.run(
            [OGR2OGR, "-f", "CSV", str(csv_path), str(archivo),
             "-lco", "GEOMETRY=AS_WKT", "-lco", "CREATE_CSVT=NO", "-t_srs", "EPSG:4326"],
            check=True, capture_output=True,
        )

    buscados = {_sin_tildes(e) for e in estados}
    buscados |= {a for clave, alias in ALIAS_ESTADOS.items() if clave in buscados for a in alias}

    with csv_path.open("r", encoding="utf-8", newline="") as fh:
        filas = list(csv.DictReader(fh))
    if not filas:
        raise SystemExit(f"{archivo.name} no trae ningun poligono")

    geometria = next((c for c in filas[0] if c.upper().startswith("WKT")), None)
    if not geometria:
        raise SystemExit(f"{archivo.name} no trae la geometria en WKT")

    # Que columna tiene los nombres: la que mas coincidencias da con lo pedido.
    if campo:
        columna = campo
    else:
        candidatas = [c for c in filas[0] if c != geometria]
        columna = max(candidatas, key=lambda c: sum(1 for f in filas if _sin_tildes(f[c]) in buscados), default=None)
    if not columna:
        raise SystemExit(f"No encuentro una columna con nombres de estado en {archivo.name}")

    elegidas = [f for f in filas if _sin_tildes(f[columna]) in buscados]
    encontrados = {_sin_tildes(f[columna]) for f in elegidas}
    # Un estado pedido cuenta como encontrado si aparece con cualquiera de sus
    # nombres: "La Guaira" esta en muchos archivos como "Vargas".
    faltan = [e for e in estados
              if not (ALIAS_ESTADOS.get(_sin_tildes(e), {_sin_tildes(e)}) | {_sin_tildes(e)}) & encontrados]
    if not elegidas:
        muestra = sorted({f[columna] for f in filas})[:15]
        raise SystemExit(f"Ningun poligono de la columna '{columna}' coincide. Hay: {', '.join(muestra)}")

    with orig.cursor() as cur:
        cur.execute("DROP TABLE IF EXISTS red_vial_zona")
        cur.execute("CREATE TABLE red_vial_zona (nombre text, geom geometry(MultiPolygon, 4326))")
        for f in elegidas:
            cur.execute(
                "INSERT INTO red_vial_zona (nombre, geom) SELECT %s, ST_Multi(ST_CollectionExtract("
                "  ST_MakeValid(ST_GeomFromText(%s, 4326)), 3))",
                (f[columna], f[geometria]),
            )
        if margen_km:
            cur.execute(
                "UPDATE red_vial_zona SET geom = ST_Multi(ST_Buffer(geom::geography, %s)::geometry)",
                (margen_km * 1000,),
            )
        cur.execute("CREATE INDEX ON red_vial_zona USING GIST (geom)")
        cur.execute("ANALYZE red_vial_zona")
        cur.execute("SELECT ROUND((ST_Area(ST_Union(geom)::geography) / 1e6)::numeric) AS km2 FROM red_vial_zona")
        km2 = cur.fetchone()["km2"]
    orig.commit()

    if temporal:
        shutil.rmtree(temporal, ignore_errors=True)
    return {
        "columna": columna,
        "poligonos": len(elegidas),
        "nombres": sorted({f[columna] for f in elegidas}),
        "sin_encontrar": faltan,
        "km2": km2,
    }


# Un tramo entra si toca la zona.
FILTRO_ZONA = ('EXISTS (SELECT 1 FROM red_vial_zona z WHERE t."geom" && z.geom '
               'AND ST_Intersects(t."geom", z.geom))')

# Vias que valen la pena en todo el pais aunque queden fuera de la zona: son
# las que permiten llegar a un cliente lejano por carretera en vez de caer al
# respaldo. Medido sobre Venezuela: +18 MB y todas las rutas interurbanas
# probadas siguen saliendo. Las secundarias no aportan nada mas.
TIPOS_TRONCALES = ("motorway", "motorway_link", "trunk", "trunk_link", "primary", "primary_link")


def filtro_nodos(orig: psycopg.Connection, filtro_tramos: str) -> str:
    """Los nodos que se copian son los extremos de los tramos copiados.

    Filtrarlos por geometria seria mas simple pero deja fuera los cruces de
    las troncales lejanas, y entonces un cliente de Maracaibo no tiene a que
    engancharse y su ruta se pierde. Se resuelve una sola vez en una tabla,
    que ademas sobrevive a una reconexion a mitad de copia."""
    with orig.cursor() as cur:
        cur.execute("DROP TABLE IF EXISTS red_vial_copia_nodos")
        cur.execute(
            "CREATE TABLE red_vial_copia_nodos (id bigint PRIMARY KEY)"
        )
        cur.execute(
            "INSERT INTO red_vial_copia_nodos (id) "
            'SELECT DISTINCT v FROM (SELECT t."source" AS v FROM "RedVialTramo" t WHERE '
            f"  ({filtro_tramos}) AND t.\"source\" IS NOT NULL "
            '  UNION SELECT t."target" FROM "RedVialTramo" t WHERE '
            f"  ({filtro_tramos}) AND t.\"target\" IS NOT NULL) q"
        )
        cur.execute("ANALYZE red_vial_copia_nodos")
    orig.commit()
    return 'EXISTS (SELECT 1 FROM red_vial_copia_nodos n WHERE n.id = t."id")'


def select_de(tabla: str, simplificar: float) -> str:
    """El SELECT sin WHERE; la tabla se llama "t" para que el filtro de zona y
    el rango de ids puedan nombrar sus columnas."""
    if tabla == "RedVialNodo":
        return 'SELECT t."id", t."geom" FROM "RedVialNodo" t'
    columnas = ", ".join(f"t.{c.strip()}" for c in COLUMNAS_TRAMO.split(","))
    if simplificar:
        tolerancia = simplificar / METROS_POR_GRADO
        # PreserveTopology respeta los puntos inicial y final, que son los que
        # enganchan con source/target: el grafo no cambia, solo pesa menos.
        columnas = columnas.replace(
            't."geom"',
            f'ST_SimplifyPreserveTopology(t."geom", {tolerancia})::geometry(LineString, 4326) AS "geom"',
        )
    return f'SELECT {columnas} FROM "RedVialTramo" t'


def copiar_lote(orig: psycopg.Connection, dest: psycopg.Connection, tabla: str, sel: str,
                desde: int, hasta: int, filtro: str = "") -> None:
    columnas = '"id", "geom"' if tabla == "RedVialNodo" else COLUMNAS_TRAMO
    y_zona = f" AND ({filtro})" if filtro else ""
    salida = (f'COPY ({sel} WHERE t."id" > {desde} AND t."id" <= {hasta}{y_zona} ORDER BY t."id") '
              "TO STDOUT (FORMAT BINARY)")
    entrada = f'COPY "{tabla}" ({columnas}) FROM STDIN (FORMAT BINARY)'
    with orig.cursor() as c1, dest.cursor() as c2:
        with c1.copy(salida) as lectura, c2.copy(entrada) as escritura:
            for bloque in lectura:
                escritura.write(bloque)
    dest.commit()
    orig.rollback()


def copiar_tabla(
    url_origen: str,
    url_destino: str,
    orig: psycopg.Connection,
    dest: psycopg.Connection,
    tabla: str,
    simplificar: float,
    filtro: str = "",
) -> tuple[psycopg.Connection, psycopg.Connection, int]:
    """Copia una tabla entera por lotes. Devuelve las conexiones porque un
    corte obliga a reemplazarlas."""
    _, ultimo_origen, filas_origen = rango(orig, tabla, filtro)
    desde, filas_destino = ya_copiado(dest, tabla)
    if desde:
        print(f"    ya habia {filas_destino:,} filas (hasta el id {desde:,}), se retoma desde ahi")
    sel = select_de(tabla, simplificar)

    copiadas = 0
    inicio = time.time()
    while desde < ultimo_origen:
        hasta = min(desde + LOTE, ultimo_origen)
        for intento in range(1, REINTENTOS + 1):
            try:
                copiar_lote(orig, dest, tabla, sel, desde, hasta, filtro)
                break
            except (psycopg.OperationalError, psycopg.InterfaceError) as e:
                espera = 5 * intento
                print(f"    corte en el id {desde:,} ({type(e).__name__}); reintento {intento}/{REINTENTOS} en {espera} s")
                if intento == REINTENTOS:
                    raise
                time.sleep(espera)
                # Cualquiera de las dos pudo quedar inservible: se rehacen.
                for vieja in (orig, dest):
                    try:
                        vieja.close()
                    except Exception:
                        pass
                orig, dest = conectar(url_origen), conectar(url_destino)
                preparar_destino(dest)
                # El lote anterior pudo confirmarse antes del corte.
                desde, _ = ya_copiado(dest, tabla)
                hasta = min(desde + LOTE, ultimo_origen)
        desde = hasta
        _, copiadas = ya_copiado(dest, tabla)
        avance = copiadas / filas_origen * 100 if filas_origen else 100
        transcurrido = time.time() - inicio
        print(f"    {copiadas:,}/{filas_origen:,} ({avance:.0f}%) · {transcurrido:.0f} s", end="\r", flush=True)

    _, copiadas = ya_copiado(dest, tabla)
    print(f"    {copiadas:,}/{filas_origen:,} filas en {time.time() - inicio:.0f} s        ")
    return orig, dest, copiadas


def medir_seleccion(orig: psycopg.Connection, filtros: dict[str, str], simplificar: float) -> None:
    """Cuanto se copiaria y cuanto ocuparia alla. No estima: arma las tablas
    con sus indices y las mide, en temporales que mueren con la sesion."""
    total = 0
    with orig.cursor() as cur:
        for tabla, indices_sql in (
            ("RedVialTramo", ['USING GIST ("geom")', '("source")', '("target")']),
            ("RedVialNodo", ['USING GIST ("geom")']),
        ):
            sel = select_de(tabla, simplificar if tabla == "RedVialTramo" else 0)
            donde = f" WHERE {filtros[tabla]}" if filtros.get(tabla) else ""
            cur.execute(f"DROP TABLE IF EXISTS medicion")
            cur.execute(f"CREATE TEMP TABLE medicion AS {sel}{donde}")
            filas = cur.rowcount
            cur.execute(f'SELECT COUNT(*) AS n FROM "{tabla}"')
            todas = cur.fetchone()["n"]
            for definicion in indices_sql:
                cur.execute(f"CREATE INDEX ON medicion {definicion}")
            cur.execute("SELECT pg_table_size('medicion') AS d, pg_indexes_size('medicion') AS i")
            m = cur.fetchone()
            total += m["d"] + m["i"]
            print(f"  {tabla:<13} {filas:>9,} de {todas:,} filas ({filas / todas * 100:.0f}%) · "
                  f"datos {m['d'] / 1e6:>6.0f} MB + indices {m['i'] / 1e6:>5.0f} MB")
            cur.execute("DROP TABLE medicion")

        # Sumando tablas, no pg_database_size: ese cuenta tambien las
        # temporales de esta misma medicion.
        cur.execute(
            "SELECT pg_size_pretty(SUM(pg_total_relation_size(c.oid))) AS resto "
            "FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
            "WHERE n.nspname = 'public' AND c.relkind = 'r' "
            "  AND c.relname NOT IN ('RedVialTramo', 'RedVialNodo', 'red_vial_zona')"
        )
        resto = cur.fetchone()["resto"]

        if filtros.get("RedVialTramo"):
            # Los clientes que quedan fuera no pierden la app: sus rutas caen
            # al respaldo (iServer o linea recta), pero conviene saber cuantos.
            cur.execute(
                "SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE dentro) AS dentro FROM ("
                '  SELECT EXISTS (SELECT 1 FROM red_vial_zona z '
                '                 WHERE ST_Intersects(ST_SetSRID(ST_MakePoint(c."lng", c."lat"), 4326), z.geom)) AS dentro '
                '  FROM "Cliente" c WHERE c."lat" IS NOT NULL AND c."lng" IS NOT NULL '
                '    AND NOT (abs(c."lat") < 1e-6 AND abs(c."lng") < 1e-6)) q'
            )
            c = cur.fetchone()
            print(f"  clientes dentro de la zona: {c['dentro']} de {c['total']}")
    orig.rollback()
    print(f"\n  la red ocuparia {total / 1e6:.0f} MB, mas {resto} del resto de la base")


def preparar_destino(dest: psycopg.Connection) -> None:
    with dest.cursor() as cur:
        # Es una carga que se puede repetir: no hace falta esperar al disco
        # en cada commit.
        cur.execute("SET synchronous_commit = off")
    dest.commit()


def copiar_cargas(orig: psycopg.Connection, dest: psycopg.Connection) -> None:
    """RedVialCarga son cuatro filas: se reemplazan enteras."""
    with orig.cursor() as cur:
        cur.execute(
            'SELECT "id", "archivo", "tramos", "nodos", "tramosDescartados", "tramosSinVelocidad", '
            '"resumen", "cargadoEn" FROM "RedVialCarga" ORDER BY "cargadoEn"'
        )
        filas = cur.fetchall()
    orig.rollback()
    with dest.cursor() as cur:
        cur.execute('TRUNCATE "RedVialCarga"')
        for f in filas:
            cur.execute(
                'INSERT INTO "RedVialCarga" ("id", "archivo", "tramos", "nodos", "tramosDescartados", '
                '"tramosSinVelocidad", "resumen", "cargadoEn") VALUES (%s, %s, %s, %s, %s, %s, %s, %s)',
                (f["id"], f["archivo"], f["tramos"], f["nodos"], f["tramosDescartados"],
                 f["tramosSinVelocidad"], psycopg.types.json.Json(f["resumen"]), f["cargadoEn"]),
            )
    dest.commit()
    print(f"  RedVialCarga: {len(filas)} registro(s) de carga")


def main() -> None:
    parser = argparse.ArgumentParser(description="Copia la red vial de una base a otra")
    parser.add_argument("--origen", help="URL de la base que ya tiene la red (o RED_VIAL_ORIGEN)")
    parser.add_argument("--destino", help="URL de la base a llenar (o RED_VIAL_DESTINO, o DATABASE_URL del .env)")
    parser.add_argument("--simplificar", type=float, default=0,
                        help="Tolerancia en metros para aligerar el dibujo de los tramos (0 = tal cual)")
    parser.add_argument("--sin-indices", action="store_true",
                        help="Borra los indices del destino durante la carga y los recrea al final")
    parser.add_argument("--vaciar", action="store_true", help="Empieza de cero en el destino")
    parser.add_argument("--zona", help="Archivo de poligonos (shapefile, GeoPackage...) para recortar la red")
    parser.add_argument("--estados", help="Nombres separados por coma que se toman de ese archivo")
    parser.add_argument("--campo-estado", help="Columna con el nombre del estado (por defecto se busca sola)")
    parser.add_argument("--margen", type=float, default=5,
                        help="Kilometros que se agranda la zona, para no cortar vias al borde (5 por defecto)")
    parser.add_argument("--troncales", action="store_true",
                        help="Ademas de la zona, trae las vias principales de todo el pais")
    parser.add_argument("--medir", action="store_true",
                        help="Solo dice cuanto se copiaria y cuanto ocuparia, sin tocar el destino")
    args = parser.parse_args()

    env = dotenv_values(PROJECT_ROOT / ".env")
    url_origen = args.origen or os.environ.get("RED_VIAL_ORIGEN")
    url_destino = args.destino or os.environ.get("RED_VIAL_DESTINO") or env.get("DATABASE_URL")
    if not url_origen:
        url_origen = env.get("DATABASE_URL") if args.medir else None
    if not url_origen:
        raise SystemExit("Falta la base de origen: usa --origen o la variable RED_VIAL_ORIGEN")
    if not args.medir:
        if not url_destino:
            raise SystemExit("Falta la base de destino: usa --destino, RED_VIAL_DESTINO o DATABASE_URL en el .env")
        if donde(url_origen) == donde(url_destino):
            raise SystemExit("El origen y el destino son la misma base")

    print(f"Origen : {donde(url_origen)}")
    if not args.medir:
        print(f"Destino: {donde(url_destino)}")
    if args.simplificar:
        print(f"Dibujo simplificado a {args.simplificar:g} m (los costos y la topologia no cambian)")

    inicio = time.time()
    orig = conectar(url_origen)

    filtros: dict[str, str] = {}
    if args.zona:
        if not args.estados:
            raise SystemExit("Con --zona hace falta --estados con los nombres a tomar del archivo")
        zona = cargar_zona(orig, Path(args.zona), args.estados.split(","), args.campo_estado, args.margen)
        print(f"Zona: {', '.join(zona['nombres'])} ({zona['km2']:,} km2, columna '{zona['columna']}'"
              f"{f', margen {args.margen:g} km' if args.margen else ''})")
        if zona["sin_encontrar"]:
            print(f"  OJO: no aparecen en el archivo: {', '.join(zona['sin_encontrar'])}")
        filtro = FILTRO_ZONA
        if args.troncales:
            tipos = ", ".join(f"'{t}'" for t in TIPOS_TRONCALES)
            filtro = f'({filtro}) OR t."tipo" IN ({tipos})'
            print("  mas las troncales de todo el pais (autopistas, vias principales)")
        filtros = {"RedVialTramo": filtro, "RedVialNodo": filtro_nodos(orig, filtro)}
    elif args.troncales:
        raise SystemExit("--troncales solo tiene sentido junto con --zona")

    if args.medir:
        medir_seleccion(orig, filtros, args.simplificar)
        orig.close()
        return

    dest = conectar(url_destino)
    try:
        revisar_destino(dest)
        preparar_destino(dest)

        _, _, tramos_origen = rango(orig, "RedVialTramo")
        if not tramos_origen:
            raise SystemExit("El origen no tiene red cargada: corre antes cargar_red_vial.py en local")

        if args.vaciar:
            print("Vaciando el destino...")
            with dest.cursor() as cur:
                cur.execute('TRUNCATE "RedVialNodo"')
                cur.execute('TRUNCATE "RedVialTramo" CASCADE')
                cur.execute('TRUNCATE "RutaCalculada"')  # la cache de rutas viejas ya no vale
            dest.commit()

        guardados: list[dict] = []
        if args.sin_indices:
            guardados = indices(dest, ["RedVialTramo", "RedVialNodo"])
            print(f"Quitando {len(guardados)} indices del destino (se recrean al final)")
            with dest.cursor() as cur:
                for i in guardados:
                    cur.execute(f'DROP INDEX IF EXISTS "{i["nombre"]}"')
            dest.commit()

        print("1/3 copiando tramos...")
        orig, dest, n_tramos = copiar_tabla(url_origen, url_destino, orig, dest, "RedVialTramo",
                                            args.simplificar, filtros.get("RedVialTramo", ""))
        print("2/3 copiando nodos...")
        orig, dest, n_nodos = copiar_tabla(url_origen, url_destino, orig, dest, "RedVialNodo",
                                           0, filtros.get("RedVialNodo", ""))
        print("3/3 resumen de la carga...")
        copiar_cargas(orig, dest)

        faltan = asegurar_indices(dest, guardados)
        if faltan:
            print("\nQuedaron indices sin crear. Cuando haya sitio, corre esto:")
            for i in faltan:
                print(f"    {i['definicion']};")
            print("Sin ellos la red esta cargada pero las consultas van por barrido completo:")
            print("mejor dejar MOTOR_RUTAS=iserver hasta que esten.")

        with dest.cursor() as cur:
            cur.execute('ANALYZE "RedVialTramo"')
            cur.execute('ANALYZE "RedVialNodo"')
            cur.execute(
                "SELECT pg_size_pretty(pg_total_relation_size('\"RedVialTramo\"')) AS tramos, "
                "       pg_size_pretty(pg_total_relation_size('\"RedVialNodo\"')) AS nodos, "
                "       pg_size_pretty(pg_database_size(current_database())) AS base"
            )
            tamanos = dict(cur.fetchone())
            cur.execute('SELECT COUNT(*) AS n FROM "RedVialTramo" WHERE "source" IS NULL OR "target" IS NULL')
            sin_topologia = cur.fetchone()["n"]
        dest.commit()
    finally:
        for c in (orig, dest):
            try:
                c.close()
            except Exception:
                pass

    print(f"\nListo en {time.time() - inicio:.0f} s")
    print(f"  tramos: {n_tramos:,} (sin topologia: {sin_topologia})")
    print(f"  nodos: {n_nodos:,}")
    print(f"  tamano: tramos {tamanos['tramos']} · nodos {tamanos['nodos']} · base {tamanos['base']}")
    if sin_topologia:
        print("  AVISO: hay tramos sin source/target; la copia quedo incompleta")
        sys.exit(1)


if __name__ == "__main__":
    main()
