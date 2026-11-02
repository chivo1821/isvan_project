-- Listas de precios de compra subidas solas, sin un extracto de ventas
-- (ver aplicar_lista_precios en backend/app/api/indicadores.py). Se guardan
-- para volver a aplicarlas en orden cuando se revierte una carga de ventas.

-- CreateTable
CREATE TABLE "ListaPrecioCarga" (
    "id" TEXT NOT NULL,
    "empresa" "Empresa" NOT NULL,
    "archivo" TEXT NOT NULL,
    "productos" JSONB NOT NULL,
    "subidaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "subidaPorId" TEXT,

    CONSTRAINT "ListaPrecioCarga_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ListaPrecioCarga_empresa_subidaEn_idx" ON "ListaPrecioCarga"("empresa", "subidaEn");

-- AddForeignKey
ALTER TABLE "ListaPrecioCarga" ADD CONSTRAINT "ListaPrecioCarga_subidaPorId_fkey" FOREIGN KEY ("subidaPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
