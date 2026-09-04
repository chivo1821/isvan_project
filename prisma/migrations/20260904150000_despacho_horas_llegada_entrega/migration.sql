-- Marcas de tiempo que pone el repartidor en la calle: cuando llego al
-- cliente y cuando termino de entregar. Con ellas se mide el tiempo de
-- atencion por parada y el de traslado entre paradas (reportes de
-- rendimiento de conductores). Nullable: los despachos ya entregados antes
-- de esta version no las tienen.
-- AlterTable
ALTER TABLE "Despacho" ADD COLUMN     "llegadaEn" TIMESTAMP(3),
ADD COLUMN     "entregadoEn" TIMESTAMP(3);
