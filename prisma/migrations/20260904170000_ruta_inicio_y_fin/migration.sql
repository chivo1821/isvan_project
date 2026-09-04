-- Cuando el vehiculo salio del almacen y cuando se entrego la ultima parada.
-- Junto con Despacho.llegadaEn/entregadoEn permiten medir la duracion real
-- del viaje contra la estimada y los tiempos entre paradas (reportes de
-- rendimiento de conductores). Nullable: las rutas anteriores no las tienen.
-- AlterTable
ALTER TABLE "Ruta" ADD COLUMN     "iniciadaEn" TIMESTAMP(3),
ADD COLUMN     "completadaEn" TIMESTAMP(3);
