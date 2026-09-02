-- Vehiculo asignado a un usuario REPARTIDOR: es lo que acota su acceso a la
-- unica ruta activa de ese vehiculo (ver backend/app/core/permisos.py).
-- Nullable porque los demas roles no lo usan; ON DELETE SET NULL para que
-- borrar un vehiculo no arrastre al usuario.
-- AlterTable
ALTER TABLE "Usuario" ADD COLUMN     "vehiculoAsignadoId" TEXT;

-- AddForeignKey
ALTER TABLE "Usuario" ADD CONSTRAINT "Usuario_vehiculoAsignadoId_fkey" FOREIGN KEY ("vehiculoAsignadoId") REFERENCES "Vehiculo"("id") ON DELETE SET NULL ON UPDATE CASCADE;
