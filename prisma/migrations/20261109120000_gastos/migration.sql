-- CreateEnum
CREATE TYPE "EstadoCargaGasto" AS ENUM ('CONFIRMADA', 'REVERTIDA');

-- CreateTable
CREATE TABLE "GastoCarga" (
    "id" TEXT NOT NULL,
    "empresa" "Empresa" NOT NULL,
    "archivo" TEXT NOT NULL,
    "periodoDesde" DATE NOT NULL,
    "periodoHasta" DATE NOT NULL,
    "filas" INTEGER NOT NULL,
    "totalUsd" DECIMAL(20,2) NOT NULL,
    "estado" "EstadoCargaGasto" NOT NULL DEFAULT 'CONFIRMADA',
    "subidaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "subidaPorId" TEXT NOT NULL,
    "revertidaEn" TIMESTAMP(3),

    CONSTRAINT "GastoCarga_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Gasto" (
    "id" TEXT NOT NULL,
    "cargaId" TEXT NOT NULL,
    "empresa" "Empresa" NOT NULL,
    "fecha" DATE NOT NULL,
    "categoria" TEXT NOT NULL,
    "descripcion" TEXT,
    "proveedor" TEXT,
    "referencia" TEXT,
    "montoUsd" DECIMAL(20,2) NOT NULL,
    "montoBs" DECIMAL(20,2),
    "moneda" TEXT NOT NULL,
    "tasa" DECIMAL(20,8),

    CONSTRAINT "Gasto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GastoCarga_empresa_estado_idx" ON "GastoCarga"("empresa", "estado");

-- CreateIndex
CREATE INDEX "Gasto_empresa_fecha_idx" ON "Gasto"("empresa", "fecha");

-- CreateIndex
CREATE INDEX "Gasto_cargaId_idx" ON "Gasto"("cargaId");

-- AddForeignKey
ALTER TABLE "GastoCarga" ADD CONSTRAINT "GastoCarga_subidaPorId_fkey" FOREIGN KEY ("subidaPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Gasto" ADD CONSTRAINT "Gasto_cargaId_fkey" FOREIGN KEY ("cargaId") REFERENCES "GastoCarga"("id") ON DELETE CASCADE ON UPDATE CASCADE;
