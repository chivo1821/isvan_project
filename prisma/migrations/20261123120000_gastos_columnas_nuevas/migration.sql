-- Nuevas columnas solicitadas por el cliente para la plantilla de gastos:
-- Tipo de Documento, Numero Documento Proveedor, Banco y Retencion.
-- Migracion aditiva (todas opcionales / NULL).

ALTER TABLE "Gasto"
  ADD COLUMN "tipoDocumento" TEXT,
  ADD COLUMN "numeroDocumentoProveedor" TEXT,
  ADD COLUMN "banco" TEXT,
  ADD COLUMN "retencion" TEXT;
