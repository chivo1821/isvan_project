-- Devolver un censo al vendedor desde Censos por corregir (ver
-- backend/app/services/censo_correccion.py): quien, cuando, por que y el lote.

-- AlterTable
ALTER TABLE "Censo" ADD COLUMN     "devueltoEn" TIMESTAMP(3),
ADD COLUMN     "devueltoPorId" TEXT,
ADD COLUMN     "loteDevolucion" TEXT,
ADD COLUMN     "motivoDevolucion" TEXT;

-- CreateIndex
CREATE INDEX "Censo_loteDevolucion_idx" ON "Censo"("loteDevolucion");

-- AddForeignKey
ALTER TABLE "Censo" ADD CONSTRAINT "Censo_devueltoPorId_fkey" FOREIGN KEY ("devueltoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
