-- CreateEnum
CREATE TYPE "EstadoCargaVenta" AS ENUM ('PENDIENTE', 'CONFIRMADA', 'REVERTIDA');

-- CreateEnum
CREATE TYPE "TipoMovimientoVenta" AS ENUM ('VENTA', 'DEVOLUCION');

-- CreateTable
CREATE TABLE "VentaCarga" (
    "id" TEXT NOT NULL,
    "empresa" "Empresa" NOT NULL,
    "archivo" TEXT NOT NULL,
    "periodoDesde" DATE NOT NULL,
    "periodoHasta" DATE NOT NULL,
    "filas" INTEGER NOT NULL,
    "estado" "EstadoCargaVenta" NOT NULL DEFAULT 'PENDIENTE',
    "subidaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "subidaPorId" TEXT NOT NULL,
    "confirmadaEn" TIMESTAMP(3),
    "revertidaEn" TIMESTAMP(3),
    "resumen" JSONB NOT NULL,
    "dimensiones" JSONB NOT NULL,

    CONSTRAINT "VentaCarga_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VentaCliente" (
    "id" TEXT NOT NULL,
    "empresa" "Empresa" NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "ruta" TEXT NOT NULL,
    "listaPrecio" TEXT,

    CONSTRAINT "VentaCliente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VentaProducto" (
    "id" TEXT NOT NULL,
    "empresa" "Empresa" NOT NULL,
    "codigo" BIGINT NOT NULL,
    "nombre" TEXT NOT NULL,
    "grupo" TEXT NOT NULL,
    "codigoProveedor" TEXT,
    "unidadesPorCaja" INTEGER,
    "litrosPorUnidad" DECIMAL(12,4),
    "costoCajaUsd" DECIMAL(14,4),

    CONSTRAINT "VentaProducto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Venta" (
    "id" BIGSERIAL NOT NULL,
    "empresa" "Empresa" NOT NULL,
    "cargaId" TEXT NOT NULL,
    "reemplazadaPorCargaId" TEXT,
    "fecha" DATE NOT NULL,
    "numDoc" TEXT NOT NULL,
    "codTipoDoc" TEXT NOT NULL,
    "tipoMovimiento" "TipoMovimientoVenta" NOT NULL,
    "codigoCliente" TEXT NOT NULL,
    "codigoProducto" BIGINT NOT NULL,
    "cajas" DECIMAL(20,10) NOT NULL,
    "unidades" INTEGER NOT NULL,
    "litros" DECIMAL(18,6) NOT NULL,
    "montoBs" DECIMAL(20,4) NOT NULL,
    "montoUsd" DECIMAL(20,10) NOT NULL,

    CONSTRAINT "Venta_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VentaCarga_empresa_estado_idx" ON "VentaCarga"("empresa", "estado");

-- CreateIndex
CREATE INDEX "VentaCliente_empresa_ruta_idx" ON "VentaCliente"("empresa", "ruta");

-- CreateIndex
CREATE UNIQUE INDEX "VentaCliente_empresa_codigo_key" ON "VentaCliente"("empresa", "codigo");

-- CreateIndex
CREATE INDEX "VentaProducto_empresa_grupo_idx" ON "VentaProducto"("empresa", "grupo");

-- CreateIndex
CREATE UNIQUE INDEX "VentaProducto_empresa_codigo_key" ON "VentaProducto"("empresa", "codigo");

-- CreateIndex
CREATE INDEX "Venta_empresa_fecha_idx" ON "Venta"("empresa", "fecha");

-- CreateIndex
CREATE INDEX "Venta_empresa_codigoCliente_idx" ON "Venta"("empresa", "codigoCliente");

-- CreateIndex
CREATE INDEX "Venta_empresa_codigoProducto_idx" ON "Venta"("empresa", "codigoProducto");

-- CreateIndex
CREATE INDEX "Venta_cargaId_idx" ON "Venta"("cargaId");

-- CreateIndex
CREATE INDEX "Venta_reemplazadaPorCargaId_idx" ON "Venta"("reemplazadaPorCargaId");

-- AddForeignKey
ALTER TABLE "VentaCarga" ADD CONSTRAINT "VentaCarga_subidaPorId_fkey" FOREIGN KEY ("subidaPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Venta" ADD CONSTRAINT "Venta_cargaId_fkey" FOREIGN KEY ("cargaId") REFERENCES "VentaCarga"("id") ON DELETE CASCADE ON UPDATE CASCADE;

