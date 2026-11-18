-- Costo por caja sellado en cada venta al confirmar su carga: el margen de
-- un mes ya cerrado no cambia cuando se sube una lista de precios nueva.
-- Las filas viejas quedan en NULL hasta correr el backfill
-- (backend/scripts/sellar_costos_historicos.py); mientras tanto las
-- consultas caen al costo vigente del producto con COALESCE, asi que los
-- indicadores de hoy no cambian al aplicar esta migracion.

-- AlterTable
ALTER TABLE "Venta" ADD COLUMN "costoCajaUsd" DECIMAL(14,4);
