-- Meta de venta por ruta y mes, cargada por el cliente desde la app
-- (ver backend/app/api/metas.py). El grafico de proyeccion compara la venta
-- real contra la suma de las metas de las rutas visibles.
CREATE TABLE "MetaVenta" (
    "id" TEXT NOT NULL,
    "empresa" "Empresa" NOT NULL,
    "ruta" TEXT NOT NULL,
    "mes" DATE NOT NULL,
    "montoUsd" DECIMAL(20,2) NOT NULL,
    "actualizadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoPorId" TEXT,

    CONSTRAINT "MetaVenta_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MetaVenta_empresa_mes_idx" ON "MetaVenta"("empresa", "mes");

-- CreateIndex
CREATE UNIQUE INDEX "MetaVenta_empresa_ruta_mes_key" ON "MetaVenta"("empresa", "ruta", "mes");

-- AddForeignKey
ALTER TABLE "MetaVenta" ADD CONSTRAINT "MetaVenta_actualizadoPorId_fkey" FOREIGN KEY ("actualizadoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
