-- Morocho: un pedido grande que sale en dos motos juntas. La segunda moto
-- de la ruta es vehiculoApoyoId (la principal sigue siendo vehiculoId). Cada
-- motorizado cobra la parada completa, asi que lo liquidado se guarda por
-- vehiculo. Ver backend/app/services/plan_rutas.py y delivery.py.

-- AlterTable
ALTER TABLE "Ruta" ADD COLUMN "vehiculoApoyoId" TEXT;

-- AlterTable
ALTER TABLE "LiquidacionDeliveryParada" ADD COLUMN "vehiculoId" TEXT;

-- Lo ya liquidado se pago a la moto de su ruta.
UPDATE "LiquidacionDeliveryParada" lp SET "vehiculoId" = r."vehiculoId"
FROM "Ruta" r WHERE r."id" = lp."rutaId";

-- DropIndex
DROP INDEX "LiquidacionDeliveryParada_rutaId_clienteId_key";

-- CreateIndex
CREATE INDEX "Ruta_vehiculoApoyoId_estado_idx" ON "Ruta"("vehiculoApoyoId", "estado");

-- CreateIndex
CREATE UNIQUE INDEX "LiquidacionDeliveryParada_rutaId_clienteId_vehiculoId_key" ON "LiquidacionDeliveryParada"("rutaId", "clienteId", "vehiculoId");

-- AddForeignKey
ALTER TABLE "Ruta" ADD CONSTRAINT "Ruta_vehiculoApoyoId_fkey" FOREIGN KEY ("vehiculoApoyoId") REFERENCES "Vehiculo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiquidacionDeliveryParada" ADD CONSTRAINT "LiquidacionDeliveryParada_vehiculoId_fkey" FOREIGN KEY ("vehiculoId") REFERENCES "Vehiculo"("id") ON DELETE SET NULL ON UPDATE CASCADE;
