-- AlterTable: Despacho (salida por tandas para rutas flexibles de motos)
ALTER TABLE "Despacho"
    ADD COLUMN "salidaEn" TIMESTAMP(3),
    ADD COLUMN "tandaSalida" TEXT,
    ADD COLUMN "salidaLat" DOUBLE PRECISION,
    ADD COLUMN "salidaLng" DOUBLE PRECISION;

CREATE INDEX "Despacho_rutaId_tandaSalida_idx" ON "Despacho"("rutaId", "tandaSalida");
