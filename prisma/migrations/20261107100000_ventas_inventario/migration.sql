-- CreateEnum
CREATE TYPE "EstadoPedido" AS ENUM ('BORRADOR', 'CONFIRMADO', 'FACTURADO', 'ANULADO');

-- CreateEnum
CREATE TYPE "TipoDocumentoVenta" AS ENUM ('FA', 'NE', 'NC', 'ND');

-- CreateEnum
CREATE TYPE "EstadoDocumentoVenta" AS ENUM ('BORRADOR', 'EN_EMISION', 'EMITIDA', 'RECHAZADA');

-- AlterTable
ALTER TABLE "VentaCarga" ADD COLUMN     "origen" TEXT NOT NULL DEFAULT 'EXTRACTO';

-- CreateTable
CREATE TABLE "Pedido" (
    "id" TEXT NOT NULL,
    "organizacionId" TEXT NOT NULL DEFAULT 'org-principal',
    "empresaId" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "almacenId" TEXT NOT NULL,
    "vendedorId" TEXT,
    "origen" TEXT NOT NULL DEFAULT 'WEB',
    "estado" "EstadoPedido" NOT NULL DEFAULT 'BORRADOR',
    "listaPrecioCodigo" TEXT,
    "notas" TEXT,
    "creadoPorId" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmadoEn" TIMESTAMP(3),
    "anuladoEn" TIMESTAMP(3),
    "motivoAnulacion" TEXT,

    CONSTRAINT "Pedido_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PedidoItem" (
    "id" TEXT NOT NULL,
    "pedidoId" TEXT NOT NULL,
    "productoId" TEXT NOT NULL,
    "cajas" DECIMAL(14,3) NOT NULL,
    "precioCajaUsd" DECIMAL(14,4) NOT NULL,
    "descuentoPct" DECIMAL(5,2) NOT NULL DEFAULT 0,

    CONSTRAINT "PedidoItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentoVenta" (
    "id" TEXT NOT NULL,
    "organizacionId" TEXT NOT NULL DEFAULT 'org-principal',
    "empresaId" TEXT NOT NULL,
    "tipo" "TipoDocumentoVenta" NOT NULL,
    "numero" TEXT,
    "numeroControl" TEXT,
    "estado" "EstadoDocumentoVenta" NOT NULL DEFAULT 'BORRADOR',
    "pedidoId" TEXT,
    "documentoAfectadoId" TEXT,
    "motivo" TEXT,
    "devuelveInventario" BOOLEAN NOT NULL DEFAULT false,
    "clienteId" TEXT NOT NULL,
    "almacenId" TEXT,
    "clienteRif" TEXT,
    "clienteRazonSocial" TEXT,
    "clienteDomicilio" TEXT,
    "clienteContribuyenteEspecial" BOOLEAN NOT NULL DEFAULT false,
    "clientePorcentajeRetencionIva" INTEGER,
    "fechaEmision" DATE,
    "vencimiento" DATE,
    "tasa" DECIMAL(20,8),
    "fechaTasa" DATE,
    "pagoEnDivisas" BOOLEAN NOT NULL DEFAULT false,
    "igtfPorcentaje" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "baseImponibleUsd" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "exentoUsd" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "ivaUsd" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "igtfUsd" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "totalUsd" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "baseImponibleBs" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "exentoBs" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "ivaBs" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "igtfBs" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "totalBs" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "impuestos" JSONB,
    "emisorFiscal" TEXT,
    "respuestaEmisor" JSONB,
    "errorEmision" TEXT,
    "creadoPorId" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "emitidoEn" TIMESTAMP(3),

    CONSTRAINT "DocumentoVenta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentoVentaItem" (
    "id" TEXT NOT NULL,
    "documentoId" TEXT NOT NULL,
    "productoId" TEXT NOT NULL,
    "codigoProducto" BIGINT NOT NULL,
    "descripcion" TEXT NOT NULL,
    "cajas" DECIMAL(14,3) NOT NULL,
    "unidadesPorCaja" INTEGER NOT NULL,
    "precioCajaUsd" DECIMAL(14,4) NOT NULL,
    "descuentoPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "impuestoCodigo" TEXT NOT NULL,
    "porcentajeImpuesto" DECIMAL(6,2) NOT NULL,
    "subtotalUsd" DECIMAL(20,2) NOT NULL,

    CONSTRAINT "DocumentoVentaItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lote" (
    "id" TEXT NOT NULL,
    "productoId" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "vencimiento" DATE,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Lote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Existencia" (
    "id" TEXT NOT NULL,
    "almacenId" TEXT NOT NULL,
    "productoId" TEXT NOT NULL,
    "loteId" TEXT NOT NULL,
    "cajas" DECIMAL(14,3) NOT NULL DEFAULT 0,

    CONSTRAINT "Existencia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MovimientoInventario" (
    "id" BIGSERIAL NOT NULL,
    "organizacionId" TEXT NOT NULL DEFAULT 'org-principal',
    "empresaId" TEXT NOT NULL,
    "almacenId" TEXT NOT NULL,
    "productoId" TEXT NOT NULL,
    "loteId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "cajas" DECIMAL(14,3) NOT NULL,
    "documentoVentaId" TEXT,
    "ajusteId" TEXT,
    "referencia" TEXT,
    "usuarioId" TEXT,
    "fecha" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MovimientoInventario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AjusteInventario" (
    "id" TEXT NOT NULL,
    "organizacionId" TEXT NOT NULL DEFAULT 'org-principal',
    "empresaId" TEXT NOT NULL,
    "almacenId" TEXT NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'PROPUESTO',
    "motivo" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "propuestoPorId" TEXT NOT NULL,
    "resueltoPorId" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resueltoEn" TIMESTAMP(3),

    CONSTRAINT "AjusteInventario_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Pedido_empresaId_estado_idx" ON "Pedido"("empresaId", "estado");

-- CreateIndex
CREATE INDEX "Pedido_clienteId_idx" ON "Pedido"("clienteId");

-- CreateIndex
CREATE UNIQUE INDEX "Pedido_empresaId_numero_key" ON "Pedido"("empresaId", "numero");

-- CreateIndex
CREATE INDEX "DocumentoVenta_empresaId_fechaEmision_idx" ON "DocumentoVenta"("empresaId", "fechaEmision");

-- CreateIndex
CREATE INDEX "DocumentoVenta_clienteId_idx" ON "DocumentoVenta"("clienteId");

-- CreateIndex
CREATE INDEX "DocumentoVenta_pedidoId_idx" ON "DocumentoVenta"("pedidoId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentoVenta_empresaId_tipo_numero_key" ON "DocumentoVenta"("empresaId", "tipo", "numero");

-- CreateIndex
CREATE UNIQUE INDEX "Lote_productoId_numero_key" ON "Lote"("productoId", "numero");

-- CreateIndex
CREATE INDEX "Existencia_productoId_idx" ON "Existencia"("productoId");

-- CreateIndex
CREATE UNIQUE INDEX "Existencia_almacenId_productoId_loteId_key" ON "Existencia"("almacenId", "productoId", "loteId");

-- CreateIndex
CREATE INDEX "MovimientoInventario_productoId_fecha_idx" ON "MovimientoInventario"("productoId", "fecha");

-- CreateIndex
CREATE INDEX "MovimientoInventario_documentoVentaId_idx" ON "MovimientoInventario"("documentoVentaId");

-- AddForeignKey
ALTER TABLE "PedidoItem" ADD CONSTRAINT "PedidoItem_pedidoId_fkey" FOREIGN KEY ("pedidoId") REFERENCES "Pedido"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentoVenta" ADD CONSTRAINT "DocumentoVenta_documentoAfectadoId_fkey" FOREIGN KEY ("documentoAfectadoId") REFERENCES "DocumentoVenta"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentoVentaItem" ADD CONSTRAINT "DocumentoVentaItem_documentoId_fkey" FOREIGN KEY ("documentoId") REFERENCES "DocumentoVenta"("id") ON DELETE CASCADE ON UPDATE CASCADE;
