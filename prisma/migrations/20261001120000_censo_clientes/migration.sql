-- CreateTable
CREATE TABLE "Censo" (
    "id" TEXT NOT NULL,
    "formulario" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "respuestas" JSONB NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "encuestador" TEXT,
    "nombreComercio" TEXT,
    "tipoCliente" TEXT,
    "empresa" TEXT,
    "ruta" TEXT,
    "iniciadoEn" TIMESTAMP(3) NOT NULL,
    "terminadoEn" TIMESTAMP(3) NOT NULL,
    "recibidoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Censo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CensoFoto" (
    "id" TEXT NOT NULL,
    "censoId" TEXT NOT NULL,
    "pregunta" TEXT NOT NULL,
    "clave" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "creadaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CensoFoto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Censo_formulario_recibidoEn_idx" ON "Censo"("formulario", "recibidoEn");

-- CreateIndex
CREATE INDEX "Censo_usuarioId_recibidoEn_idx" ON "Censo"("usuarioId", "recibidoEn");

-- CreateIndex
CREATE UNIQUE INDEX "CensoFoto_censoId_pregunta_key" ON "CensoFoto"("censoId", "pregunta");

-- AddForeignKey
ALTER TABLE "Censo" ADD CONSTRAINT "Censo_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CensoFoto" ADD CONSTRAINT "CensoFoto_censoId_fkey" FOREIGN KEY ("censoId") REFERENCES "Censo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

