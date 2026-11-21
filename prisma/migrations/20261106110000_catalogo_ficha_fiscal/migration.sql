-- AlterTable
ALTER TABLE "Cliente" ADD COLUMN     "contribuyenteEspecial" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "diasCredito" INTEGER,
ADD COLUMN     "domicilioFiscal" TEXT,
ADD COLUMN     "limiteCreditoUsd" DECIMAL(14,2),
ADD COLUMN     "listaPrecioCodigo" TEXT,
ADD COLUMN     "porcentajeRetencionIva" INTEGER,
ADD COLUMN     "razonSocial" TEXT,
ADD COLUMN     "rifCedula" TEXT,
ADD COLUMN     "rutaVenta" TEXT,
ADD COLUMN     "tipoVenta" TEXT;

-- CreateTable
CREATE TABLE "Impuesto" (
    "id" TEXT NOT NULL,
    "organizacionId" TEXT NOT NULL DEFAULT 'org-principal',
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "porcentaje" DECIMAL(6,2) NOT NULL,
    "vigenteDesde" DATE NOT NULL,
    "vigenteHasta" DATE,

    CONSTRAINT "Impuesto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Producto" (
    "id" TEXT NOT NULL,
    "organizacionId" TEXT NOT NULL DEFAULT 'org-principal',
    "empresaId" TEXT NOT NULL,
    "codigo" BIGINT NOT NULL,
    "nombre" TEXT NOT NULL,
    "grupo" TEXT,
    "codigoProveedor" TEXT,
    "unidadesPorCaja" INTEGER NOT NULL DEFAULT 1,
    "litrosPorUnidad" DECIMAL(12,4),
    "pesoCajaKg" DECIMAL(10,3),
    "impuestoCodigo" TEXT NOT NULL DEFAULT 'IVA_GENERAL',
    "requiereFrio" BOOLEAN NOT NULL DEFAULT true,
    "manejaLote" BOOLEAN NOT NULL DEFAULT true,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Producto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ListaPrecio" (
    "id" TEXT NOT NULL,
    "organizacionId" TEXT NOT NULL DEFAULT 'org-principal',
    "empresaId" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ListaPrecio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ListaPrecioItem" (
    "id" TEXT NOT NULL,
    "listaId" TEXT NOT NULL,
    "productoId" TEXT NOT NULL,
    "precioCajaUsd" DECIMAL(14,4) NOT NULL,
    "actualizadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoPorId" TEXT,

    CONSTRAINT "ListaPrecioItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Impuesto_organizacionId_codigo_vigenteDesde_key" ON "Impuesto"("organizacionId", "codigo", "vigenteDesde");

-- CreateIndex
CREATE UNIQUE INDEX "Producto_empresaId_codigo_key" ON "Producto"("empresaId", "codigo");

-- CreateIndex
CREATE UNIQUE INDEX "ListaPrecio_empresaId_codigo_key" ON "ListaPrecio"("empresaId", "codigo");

-- CreateIndex
CREATE UNIQUE INDEX "ListaPrecioItem_listaId_productoId_key" ON "ListaPrecioItem"("listaId", "productoId");

-- AddForeignKey
ALTER TABLE "Producto" ADD CONSTRAINT "Producto_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "EmpresaFiscal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListaPrecio" ADD CONSTRAINT "ListaPrecio_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "EmpresaFiscal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListaPrecioItem" ADD CONSTRAINT "ListaPrecioItem_listaId_fkey" FOREIGN KEY ("listaId") REFERENCES "ListaPrecio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListaPrecioItem" ADD CONSTRAINT "ListaPrecioItem_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "Producto"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------- Datos iniciales ----------
-- Alicuotas vigentes (Ley del IVA). Confirmar con el contador antes de
-- facturar: el sistema guarda en cada documento el porcentaje con que salio.
INSERT INTO "Impuesto" ("id", "codigo", "nombre", "porcentaje", "vigenteDesde") VALUES
    ('imp-iva-general', 'IVA_GENERAL', 'IVA alicuota general', 16.00, '2000-01-01'),
    ('imp-iva-reducido', 'IVA_REDUCIDO', 'IVA alicuota reducida', 8.00, '2000-01-01'),
    ('imp-iva-adicional', 'IVA_ADICIONAL', 'IVA alicuota general mas adicional (bienes suntuarios)', 31.00, '2000-01-01'),
    ('imp-exento', 'EXENTO', 'Exento', 0.00, '2000-01-01')
ON CONFLICT DO NOTHING;
