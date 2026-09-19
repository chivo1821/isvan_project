-- PostGIS y pgRouting: el calculo de rutas pasa a hacerse en la base
-- (ver backend/app/services/red_vial.py). Neon tambien las soporta.
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgrouting;

-- CreateTable
CREATE TABLE "RedVialTramo" (
    "id" BIGSERIAL NOT NULL,
    "osmId" TEXT,
    "source" INTEGER,
    "target" INTEGER,
    "costoMin" DOUBLE PRECISION NOT NULL,
    "costoMinInverso" DOUBLE PRECISION NOT NULL,
    "longitudM" DOUBLE PRECISION NOT NULL,
    "velocidadKmh" DOUBLE PRECISION NOT NULL,
    "tipo" TEXT NOT NULL,
    "nombre" TEXT,
    "sentido" TEXT NOT NULL,
    "geom" geometry(LineString, 4326) NOT NULL,

    CONSTRAINT "RedVialTramo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RedVialNodo" (
    "id" BIGINT NOT NULL,
    "geom" geometry(Point, 4326) NOT NULL,

    CONSTRAINT "RedVialNodo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RedVialCarga" (
    "id" TEXT NOT NULL,
    "archivo" TEXT NOT NULL,
    "tramos" INTEGER NOT NULL,
    "nodos" INTEGER NOT NULL,
    "tramosDescartados" INTEGER NOT NULL,
    "tramosSinVelocidad" INTEGER NOT NULL,
    "resumen" JSONB NOT NULL,
    "cargadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cargadoPorId" TEXT,

    CONSTRAINT "RedVialCarga_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RutaCalculada" (
    "id" TEXT NOT NULL,
    "perfil" TEXT NOT NULL DEFAULT 'vehiculo',
    "origenLat" DOUBLE PRECISION NOT NULL,
    "origenLng" DOUBLE PRECISION NOT NULL,
    "destinoLat" DOUBLE PRECISION NOT NULL,
    "destinoLng" DOUBLE PRECISION NOT NULL,
    "distanciaKm" DOUBLE PRECISION NOT NULL,
    "tiempoMin" INTEGER NOT NULL,
    "geometria" JSONB NOT NULL,
    "calculadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RutaCalculada_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RedVialTramo_source_idx" ON "RedVialTramo"("source");

-- CreateIndex
CREATE INDEX "RedVialTramo_target_idx" ON "RedVialTramo"("target");

-- CreateIndex
CREATE INDEX "RedVialTramo_geom_idx" ON "RedVialTramo" USING GIST ("geom");

-- CreateIndex
CREATE INDEX "RedVialNodo_geom_idx" ON "RedVialNodo" USING GIST ("geom");

-- CreateIndex
CREATE UNIQUE INDEX "RutaCalculada_perfil_origenLat_origenLng_destinoLat_destino_key" ON "RutaCalculada"("perfil", "origenLat", "origenLng", "destinoLat", "destinoLng");

-- AddForeignKey
ALTER TABLE "RedVialCarga" ADD CONSTRAINT "RedVialCarga_cargadoPorId_fkey" FOREIGN KEY ("cargadoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

