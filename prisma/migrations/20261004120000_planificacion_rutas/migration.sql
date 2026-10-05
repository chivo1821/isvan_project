-- Planificacion de rutas: la ruta se puede planificar sin vehiculo y con su
-- fecha y hora de salida del almacen (ver app/services/planificacion.py).

-- El vehiculo pasa a ser opcional (la llave sigue igual: ON DELETE RESTRICT).
ALTER TABLE "Ruta" ALTER COLUMN "vehiculoId" DROP NOT NULL;

-- Salida programada, en tres pasos para no fallar con las rutas que ya hay:
-- las que salieron, con su hora real de salida; las demas, con su creacion.
ALTER TABLE "Ruta" ADD COLUMN "salidaProgramada" TIMESTAMP(3);
UPDATE "Ruta" SET "salidaProgramada" = COALESCE("iniciadaEn", "fechaCreacion");
ALTER TABLE "Ruta" ALTER COLUMN "salidaProgramada" SET NOT NULL;

-- CreateIndex
CREATE INDEX "Ruta_salidaProgramada_idx" ON "Ruta"("salidaProgramada");

-- CreateIndex
CREATE INDEX "Ruta_vehiculoId_estado_idx" ON "Ruta"("vehiculoId", "estado");

-- CreateTable
CREATE TABLE "Configuracion" (
    "clave" TEXT NOT NULL,
    "valor" JSONB NOT NULL,
    "actualizadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoPorId" TEXT,

    CONSTRAINT "Configuracion_pkey" PRIMARY KEY ("clave")
);

-- AddForeignKey
ALTER TABLE "Configuracion" ADD CONSTRAINT "Configuracion_actualizadoPorId_fkey" FOREIGN KEY ("actualizadoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
