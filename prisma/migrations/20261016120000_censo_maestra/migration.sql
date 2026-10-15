-- Censo en la pagina: maestra de clientes por empresa (sin activos en uso),
-- origen de cada censo (pagina o importado de Survey123), duplicados y la
-- relacion de cada censo con el o los clientes que nombra. Las reglas viven
-- en backend/app/services/censo_clientes.py y maestra_import.py.

-- CreateEnum
CREATE TYPE "OrigenCenso" AS ENUM ('PAGINA', 'SURVEY123');

-- CreateEnum
CREATE TYPE "AccionCensoCliente" AS ENUM ('CREADO', 'COMPLETADO', 'EXISTENTE', 'REVISAR');

-- AlterTable
ALTER TABLE "Censo" ADD COLUMN "origen" "OrigenCenso" NOT NULL DEFAULT 'PAGINA',
ADD COLUMN "externoId" TEXT,
ADD COLUMN "duplicadoDeId" TEXT,
ADD COLUMN "descartadoEn" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "CensoCliente" (
    "id" TEXT NOT NULL,
    "censoId" TEXT NOT NULL,
    "empresa" "Empresa" NOT NULL,
    "codigo" TEXT NOT NULL,
    "enMaestra" BOOLEAN NOT NULL DEFAULT false,
    "enVentas" BOOLEAN NOT NULL DEFAULT false,
    "clienteId" TEXT,
    "accion" "AccionCensoCliente" NOT NULL,
    "motivo" TEXT,
    "procesadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CensoCliente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaestraCarga" (
    "id" TEXT NOT NULL,
    "empresa" "Empresa" NOT NULL,
    "archivo" TEXT NOT NULL,
    "filas" INTEGER NOT NULL,
    "resumen" JSONB NOT NULL,
    "subidaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "subidaPorId" TEXT,

    CONSTRAINT "MaestraCarga_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaestraCliente" (
    "id" TEXT NOT NULL,
    "cargaId" TEXT NOT NULL,
    "empresa" "Empresa" NOT NULL,
    "codigo" TEXT NOT NULL,
    "razonSocial" TEXT NOT NULL,
    "ruta" TEXT,
    "diaVisita" TEXT,
    "frecuencia" TEXT,
    "secuencia" TEXT,
    "direccion" TEXT,
    "condicion" TEXT,
    "tipoCliente" TEXT,
    "listaPrecio" TEXT,
    "zona" TEXT,
    "observacion" TEXT,
    "activoCodigo" TEXT,
    "activoTipo" TEXT,
    "activoMarca" TEXT,

    CONSTRAINT "MaestraCliente_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Censo_externoId_key" ON "Censo"("externoId");

-- CreateIndex
CREATE INDEX "Censo_duplicadoDeId_idx" ON "Censo"("duplicadoDeId");

-- CreateIndex
CREATE UNIQUE INDEX "CensoCliente_censoId_empresa_key" ON "CensoCliente"("censoId", "empresa");

-- CreateIndex
CREATE INDEX "CensoCliente_empresa_codigo_idx" ON "CensoCliente"("empresa", "codigo");

-- CreateIndex
CREATE INDEX "MaestraCarga_empresa_subidaEn_idx" ON "MaestraCarga"("empresa", "subidaEn");

-- CreateIndex
CREATE UNIQUE INDEX "MaestraCliente_cargaId_codigo_key" ON "MaestraCliente"("cargaId", "codigo");

-- CreateIndex
CREATE INDEX "MaestraCliente_empresa_codigo_idx" ON "MaestraCliente"("empresa", "codigo");

-- CreateIndex
CREATE INDEX "MaestraCliente_empresa_ruta_idx" ON "MaestraCliente"("empresa", "ruta");

-- AddForeignKey
ALTER TABLE "Censo" ADD CONSTRAINT "Censo_duplicadoDeId_fkey" FOREIGN KEY ("duplicadoDeId") REFERENCES "Censo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CensoCliente" ADD CONSTRAINT "CensoCliente_censoId_fkey" FOREIGN KEY ("censoId") REFERENCES "Censo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CensoCliente" ADD CONSTRAINT "CensoCliente_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaestraCarga" ADD CONSTRAINT "MaestraCarga_subidaPorId_fkey" FOREIGN KEY ("subidaPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaestraCliente" ADD CONSTRAINT "MaestraCliente_cargaId_fkey" FOREIGN KEY ("cargaId") REFERENCES "MaestraCarga"("id") ON DELETE CASCADE ON UPDATE CASCADE;
