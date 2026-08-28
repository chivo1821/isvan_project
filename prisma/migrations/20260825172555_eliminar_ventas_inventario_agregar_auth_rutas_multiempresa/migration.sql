-- Todo el contenido actual de estas tablas es data de demo/semilla (ver
-- backend/app/seed.py, hace TRUNCATE+INSERT completo cada vez) — se vacia
-- antes de las alteraciones de esquema para evitar conflictos de columnas
-- NOT NULL sin default y el cambio de llave primaria de Cliente contra filas
-- existentes. Se vuelve a sembrar con `python -m app.seed` despues de
-- aplicar esta migracion.
TRUNCATE TABLE
    "DespachoAprobacion",
    "RutaPunto",
    "DespachoItem",
    "Despacho",
    "VentaRevision",
    "VentaItem",
    "Venta",
    "Factura",
    "StockAlmacen",
    "Cliente",
    "Vehiculo",
    "Producto",
    "Almacen",
    "TasaCambio",
    "Usuario"
CASCADE;

-- CreateEnum
CREATE TYPE "Empresa" AS ENUM ('ISVAN', 'TRALOG');

-- CreateEnum
CREATE TYPE "EstadoRuta" AS ENUM ('PLANIFICADA', 'EN_TRANSITO', 'COMPLETADA', 'CANCELADA');

-- AlterEnum
BEGIN;
CREATE TYPE "RolUsuario_new" AS ENUM ('ADMIN', 'DESPACHOS', 'APROBADOR', 'REPARTIDOR');
ALTER TABLE "Usuario" ALTER COLUMN "rol" TYPE "RolUsuario_new" USING ("rol"::text::"RolUsuario_new");
ALTER TYPE "RolUsuario" RENAME TO "RolUsuario_old";
ALTER TYPE "RolUsuario_new" RENAME TO "RolUsuario";
DROP TYPE "public"."RolUsuario_old";
COMMIT;

-- DropForeignKey
ALTER TABLE "Despacho" DROP CONSTRAINT "Despacho_destinoClienteId_fkey";

-- DropForeignKey
ALTER TABLE "Despacho" DROP CONSTRAINT "Despacho_vehiculoId_fkey";

-- DropForeignKey
ALTER TABLE "Despacho" DROP CONSTRAINT "Despacho_ventaId_fkey";

-- DropForeignKey
ALTER TABLE "DespachoItem" DROP CONSTRAINT "DespachoItem_productoId_fkey";

-- DropForeignKey
ALTER TABLE "Factura" DROP CONSTRAINT "Factura_clienteId_fkey";

-- DropForeignKey
ALTER TABLE "RutaPunto" DROP CONSTRAINT "RutaPunto_despachoId_fkey";

-- DropForeignKey
ALTER TABLE "StockAlmacen" DROP CONSTRAINT "StockAlmacen_almacenId_fkey";

-- DropForeignKey
ALTER TABLE "StockAlmacen" DROP CONSTRAINT "StockAlmacen_productoId_fkey";

-- DropForeignKey
ALTER TABLE "Venta" DROP CONSTRAINT "Venta_clienteId_fkey";

-- DropForeignKey
ALTER TABLE "Venta" DROP CONSTRAINT "Venta_vendedorId_fkey";

-- DropForeignKey
ALTER TABLE "VentaItem" DROP CONSTRAINT "VentaItem_productoId_fkey";

-- DropForeignKey
ALTER TABLE "VentaItem" DROP CONSTRAINT "VentaItem_ventaId_fkey";

-- DropForeignKey
ALTER TABLE "VentaRevision" DROP CONSTRAINT "VentaRevision_usuarioId_fkey";

-- DropForeignKey
ALTER TABLE "VentaRevision" DROP CONSTRAINT "VentaRevision_ventaId_fkey";

-- AlterTable
ALTER TABLE "Cliente" DROP CONSTRAINT "Cliente_pkey",
ADD COLUMN     "empresa" "Empresa" NOT NULL,
ADD COLUMN     "id" TEXT NOT NULL,
ADD CONSTRAINT "Cliente_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "Despacho" DROP COLUMN "distanciaEstimadaKm",
DROP COLUMN "rutaCalculada",
DROP COLUMN "tiempoEstimadoMin",
DROP COLUMN "vehiculoId",
DROP COLUMN "ventaId",
ADD COLUMN     "numeroDocumento" TEXT NOT NULL,
ADD COLUMN     "ordenEnRuta" INTEGER,
ADD COLUMN     "rutaId" TEXT;

-- AlterTable
ALTER TABLE "DespachoItem" DROP COLUMN "productoId",
ADD COLUMN     "descripcion" TEXT NOT NULL,
ADD COLUMN     "pesoUnitarioKg" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "requiereFrio" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "RutaPunto" DROP COLUMN "despachoId",
ADD COLUMN     "paradaDespachoId" TEXT,
ADD COLUMN     "rutaId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Usuario" ADD COLUMN     "passwordHash" TEXT NOT NULL;

-- DropTable
DROP TABLE "Factura";

-- DropTable
DROP TABLE "Producto";

-- DropTable
DROP TABLE "StockAlmacen";

-- DropTable
DROP TABLE "TasaCambio";

-- DropTable
DROP TABLE "Venta";

-- DropTable
DROP TABLE "VentaItem";

-- DropTable
DROP TABLE "VentaRevision";

-- DropEnum
DROP TYPE "CategoriaProducto";

-- DropEnum
DROP TYPE "EstadoFactura";

-- DropEnum
DROP TYPE "EstadoVenta";

-- CreateTable
CREATE TABLE "Sesion" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiraEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sesion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ruta" (
    "id" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "vehiculoId" TEXT NOT NULL,
    "origenId" TEXT NOT NULL,
    "creadoPorId" TEXT NOT NULL,
    "estado" "EstadoRuta" NOT NULL DEFAULT 'PLANIFICADA',
    "fechaCreacion" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "distanciaTotalKm" DOUBLE PRECISION,
    "tiempoTotalMin" INTEGER,

    CONSTRAINT "Ruta_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Sesion_tokenHash_key" ON "Sesion"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "Ruta_numero_key" ON "Ruta"("numero");

-- CreateIndex
CREATE UNIQUE INDEX "Cliente_empresa_codigo_key" ON "Cliente"("empresa", "codigo");

-- CreateIndex
CREATE UNIQUE INDEX "Despacho_numeroDocumento_key" ON "Despacho"("numeroDocumento");

-- AddForeignKey
ALTER TABLE "Sesion" ADD CONSTRAINT "Sesion_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Despacho" ADD CONSTRAINT "Despacho_destinoClienteId_fkey" FOREIGN KEY ("destinoClienteId") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Despacho" ADD CONSTRAINT "Despacho_rutaId_fkey" FOREIGN KEY ("rutaId") REFERENCES "Ruta"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ruta" ADD CONSTRAINT "Ruta_vehiculoId_fkey" FOREIGN KEY ("vehiculoId") REFERENCES "Vehiculo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ruta" ADD CONSTRAINT "Ruta_origenId_fkey" FOREIGN KEY ("origenId") REFERENCES "Almacen"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ruta" ADD CONSTRAINT "Ruta_creadoPorId_fkey" FOREIGN KEY ("creadoPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RutaPunto" ADD CONSTRAINT "RutaPunto_rutaId_fkey" FOREIGN KEY ("rutaId") REFERENCES "Ruta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RutaPunto" ADD CONSTRAINT "RutaPunto_paradaDespachoId_fkey" FOREIGN KEY ("paradaDespachoId") REFERENCES "Despacho"("id") ON DELETE SET NULL ON UPDATE CASCADE;
