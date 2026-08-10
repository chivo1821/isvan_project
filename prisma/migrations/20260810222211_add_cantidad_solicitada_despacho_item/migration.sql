-- AlterTable
-- Se agrega nullable, se rellena con el valor de "cantidad" para las filas
-- existentes (sin dato historico de demanda, no hay brecha que registrar),
-- y recien despues se marca NOT NULL.
ALTER TABLE "DespachoItem" ADD COLUMN     "cantidadSolicitada" INTEGER;

UPDATE "DespachoItem" SET "cantidadSolicitada" = "cantidad" WHERE "cantidadSolicitada" IS NULL;

ALTER TABLE "DespachoItem" ALTER COLUMN "cantidadSolicitada" SET NOT NULL;
