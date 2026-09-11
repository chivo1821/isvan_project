-- AlterEnum
ALTER TYPE "RolUsuario" ADD VALUE 'VENDEDOR';

-- AlterTable
ALTER TABLE "Ruta" ADD COLUMN     "canceladaEn" TIMESTAMP(3),
ADD COLUMN     "canceladaPorId" TEXT,
ADD COLUMN     "despachosAlCancelar" JSONB,
ADD COLUMN     "motivoCancelacion" TEXT;

-- CreateTable
CREATE TABLE "VendedorRuta" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "empresa" "Empresa" NOT NULL,
    "ruta" TEXT NOT NULL,

    CONSTRAINT "VendedorRuta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Visita" (
    "id" TEXT NOT NULL,
    "vendedorId" TEXT NOT NULL,
    "empresa" "Empresa" NOT NULL,
    "codigoCliente" TEXT NOT NULL,
    "semana" DATE NOT NULL,
    "llegadaEn" TIMESTAMP(3) NOT NULL,
    "llegadaLat" DOUBLE PRECISION,
    "llegadaLng" DOUBLE PRECISION,
    "llegadaPrecisionM" DOUBLE PRECISION,
    "distanciaClienteM" DOUBLE PRECISION,
    "salidaEn" TIMESTAMP(3),
    "observaciones" TEXT,

    CONSTRAINT "Visita_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VendedorRuta_empresa_ruta_idx" ON "VendedorRuta"("empresa", "ruta");

-- CreateIndex
CREATE UNIQUE INDEX "VendedorRuta_usuarioId_empresa_ruta_key" ON "VendedorRuta"("usuarioId", "empresa", "ruta");

-- CreateIndex
CREATE INDEX "Visita_vendedorId_semana_idx" ON "Visita"("vendedorId", "semana");

-- CreateIndex
CREATE INDEX "Visita_empresa_codigoCliente_idx" ON "Visita"("empresa", "codigoCliente");

-- AddForeignKey
ALTER TABLE "Ruta" ADD CONSTRAINT "Ruta_canceladaPorId_fkey" FOREIGN KEY ("canceladaPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendedorRuta" ADD CONSTRAINT "VendedorRuta_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Visita" ADD CONSTRAINT "Visita_vendedorId_fkey" FOREIGN KEY ("vendedorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

