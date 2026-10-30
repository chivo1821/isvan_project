-- Despachos que salen de su ruta sin entregarse y vuelven a "Aprobado"
-- (ver liberar_despachos en backend/app/api/rutas.py): quien, cuando, por
-- que y desde donde. Historial del despacho y estadistica del reparto.

-- CreateEnum
CREATE TYPE "AlcanceReverso" AS ENUM ('RUTA', 'DESPACHO', 'REPARTIDOR');

-- CreateTable
CREATE TABLE "DespachoReverso" (
    "id" TEXT NOT NULL,
    "despachoId" TEXT NOT NULL,
    "rutaId" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "alcance" "AlcanceReverso" NOT NULL,
    "motivo" TEXT NOT NULL,
    "estadoAnterior" "EstadoDespacho" NOT NULL,
    "llegadaEn" TIMESTAMP(3),
    "fecha" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DespachoReverso_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DespachoReverso_despachoId_idx" ON "DespachoReverso"("despachoId");

-- CreateIndex
CREATE INDEX "DespachoReverso_rutaId_idx" ON "DespachoReverso"("rutaId");

-- CreateIndex
CREATE INDEX "DespachoReverso_fecha_idx" ON "DespachoReverso"("fecha");

-- AddForeignKey
ALTER TABLE "DespachoReverso" ADD CONSTRAINT "DespachoReverso_despachoId_fkey" FOREIGN KEY ("despachoId") REFERENCES "Despacho"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DespachoReverso" ADD CONSTRAINT "DespachoReverso_rutaId_fkey" FOREIGN KEY ("rutaId") REFERENCES "Ruta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DespachoReverso" ADD CONSTRAINT "DespachoReverso_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

