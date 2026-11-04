-- AlterTable
ALTER TABLE "LiquidacionDelivery" ADD COLUMN     "anuladaEn" TIMESTAMP(3),
ADD COLUMN     "anuladaPorId" TEXT,
ADD COLUMN     "motivoAnulacion" TEXT,
ADD COLUMN     "paradasAnuladas" JSONB;

-- CreateTable
CREATE TABLE "ParadaDeliveryExcluida" (
    "id" TEXT NOT NULL,
    "rutaId" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "vehiculoId" TEXT NOT NULL,
    "motivo" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creadoPorId" TEXT,

    CONSTRAINT "ParadaDeliveryExcluida_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ParadaDeliveryExcluida_rutaId_clienteId_vehiculoId_key" ON "ParadaDeliveryExcluida"("rutaId", "clienteId", "vehiculoId");

-- AddForeignKey
ALTER TABLE "LiquidacionDelivery" ADD CONSTRAINT "LiquidacionDelivery_anuladaPorId_fkey" FOREIGN KEY ("anuladaPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParadaDeliveryExcluida" ADD CONSTRAINT "ParadaDeliveryExcluida_rutaId_fkey" FOREIGN KEY ("rutaId") REFERENCES "Ruta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParadaDeliveryExcluida" ADD CONSTRAINT "ParadaDeliveryExcluida_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParadaDeliveryExcluida" ADD CONSTRAINT "ParadaDeliveryExcluida_vehiculoId_fkey" FOREIGN KEY ("vehiculoId") REFERENCES "Vehiculo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParadaDeliveryExcluida" ADD CONSTRAINT "ParadaDeliveryExcluida_creadoPorId_fkey" FOREIGN KEY ("creadoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
