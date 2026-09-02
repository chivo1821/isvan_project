-- Ruta comercial (de venta/reparto) a la que el negocio asigna cada cliente.
-- Viene del extracto de ventas y tambien se puede cargar en el Excel de
-- clientes; se usa como criterio de agrupacion al sugerir rutas. Nullable
-- porque hay clientes ya cargados antes de que existiera la columna.
-- AlterTable
ALTER TABLE "Cliente" ADD COLUMN     "rutaComercial" TEXT;

-- Costo operativo por kilometro del vehiculo (USD), opcional: si esta vacio
-- se estima con un valor de referencia por tipo de vehiculo.
-- AlterTable
ALTER TABLE "Vehiculo" ADD COLUMN     "costoPorKm" DOUBLE PRECISION;
