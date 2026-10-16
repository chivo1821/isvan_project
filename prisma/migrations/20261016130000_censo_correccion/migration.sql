-- Correccion de censos desde Clientes (empresa y codigo mal escritos o
-- faltantes): quien y cuando lo corrigio. Ver
-- backend/app/services/censo_correccion.py.

-- AlterTable
ALTER TABLE "Censo" ADD COLUMN "corregidoEn" TIMESTAMP(3),
ADD COLUMN "corregidoPorId" TEXT;

-- AddForeignKey
ALTER TABLE "Censo" ADD CONSTRAINT "Censo_corregidoPorId_fkey" FOREIGN KEY ("corregidoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
