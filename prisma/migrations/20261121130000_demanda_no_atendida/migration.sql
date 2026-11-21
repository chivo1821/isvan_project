-- CreateTable
CREATE TABLE "DemandaNoAtendida" (
    "id" TEXT NOT NULL,
    "organizacionId" TEXT NOT NULL DEFAULT 'org-principal',
    "empresaId" TEXT NOT NULL,
    "almacenId" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "vendedorId" TEXT,
    "productoId" TEXT NOT NULL,
    "pedidoId" TEXT,
    "cajasSolicitadas" DECIMAL(14,3) NOT NULL,
    "cajasDisponibles" DECIMAL(14,3) NOT NULL,
    "cajasFaltantes" DECIMAL(14,3) NOT NULL,
    "motivo" TEXT NOT NULL,
    "fecha" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DemandaNoAtendida_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DemandaNoAtendida_empresaId_fecha_idx" ON "DemandaNoAtendida"("empresaId", "fecha");

-- CreateIndex
CREATE INDEX "DemandaNoAtendida_vendedorId_fecha_idx" ON "DemandaNoAtendida"("vendedorId", "fecha");

-- CreateIndex
CREATE INDEX "DemandaNoAtendida_productoId_fecha_idx" ON "DemandaNoAtendida"("productoId", "fecha");

-- CreateIndex
CREATE INDEX "DemandaNoAtendida_clienteId_idx" ON "DemandaNoAtendida"("clienteId");

-- CreateIndex
CREATE INDEX "DemandaNoAtendida_pedidoId_idx" ON "DemandaNoAtendida"("pedidoId");

-- AddForeignKey
ALTER TABLE "DemandaNoAtendida" ADD CONSTRAINT "DemandaNoAtendida_organizacionId_fkey" FOREIGN KEY ("organizacionId") REFERENCES "Organizacion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DemandaNoAtendida" ADD CONSTRAINT "DemandaNoAtendida_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "EmpresaFiscal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DemandaNoAtendida" ADD CONSTRAINT "DemandaNoAtendida_almacenId_fkey" FOREIGN KEY ("almacenId") REFERENCES "Almacen"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DemandaNoAtendida" ADD CONSTRAINT "DemandaNoAtendida_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DemandaNoAtendida" ADD CONSTRAINT "DemandaNoAtendida_vendedorId_fkey" FOREIGN KEY ("vendedorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DemandaNoAtendida" ADD CONSTRAINT "DemandaNoAtendida_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "Producto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DemandaNoAtendida" ADD CONSTRAINT "DemandaNoAtendida_pedidoId_fkey" FOREIGN KEY ("pedidoId") REFERENCES "Pedido"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Row Level Security por organizacion
ALTER TABLE "DemandaNoAtendida" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DemandaNoAtendida" FORCE ROW LEVEL SECURITY;
CREATE POLICY "demanda_no_atendida_organizacion_policy" ON "DemandaNoAtendida"
    USING ("organizacionId" = COALESCE(NULLIF(current_setting('app.organizacion_id', true), ''), 'org-principal'))
    WITH CHECK ("organizacionId" = COALESCE(NULLIF(current_setting('app.organizacion_id', true), ''), 'org-principal'));
