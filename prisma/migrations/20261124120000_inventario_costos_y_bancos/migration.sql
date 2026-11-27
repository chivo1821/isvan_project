-- AlterTable: Pago (enlace opcional a CuentaTesoreria)
ALTER TABLE "Pago" ADD COLUMN "cuentaTesoreriaId" TEXT;

-- AlterTable: Producto (tres tipos de costos por caja)
ALTER TABLE "Producto"
    ADD COLUMN "ultimoCostoCajaUsd" DECIMAL(14,4),
    ADD COLUMN "ultimoCostoCajaBs" DECIMAL(20,4),
    ADD COLUMN "costoPromedioCajaUsd" DECIMAL(14,4),
    ADD COLUMN "costoPromedioCajaBs" DECIMAL(20,4),
    ADD COLUMN "costoPresupuestarioCajaUsd" DECIMAL(14,4),
    ADD COLUMN "modoPresupuestario" TEXT NOT NULL DEFAULT 'MANUAL',
    ADD COLUMN "porcentajePresupuestario" DECIMAL(7,2),
    ADD COLUMN "costosActualizadosEn" TIMESTAMP(3);

-- AlterTable: ListaPrecio (base de costo y metodo de margen)
ALTER TABLE "ListaPrecio"
    ADD COLUMN "baseCostoPorDefecto" TEXT NOT NULL DEFAULT 'ULTIMO',
    ADD COLUMN "margenObjetivoPct" DECIMAL(6,2),
    ADD COLUMN "metodoMargen" TEXT NOT NULL DEFAULT 'SOBRE_COSTO';

-- AlterTable: ListaPrecioItem (trazabilidad de margen y base de costo)
ALTER TABLE "ListaPrecioItem"
    ADD COLUMN "margenPct" DECIMAL(7,2),
    ADD COLUMN "baseCostoUsada" TEXT,
    ADD COLUMN "precioFijo" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable: MovimientoInventario (Kardex valorado Art. 177 RISLR)
ALTER TABLE "MovimientoInventario"
    ADD COLUMN "costoUnitarioUsd" DECIMAL(14,4),
    ADD COLUMN "costoUnitarioBs" DECIMAL(20,4),
    ADD COLUMN "tasa" DECIMAL(20,8),
    ADD COLUMN "valorTotalUsd" DECIMAL(20,2),
    ADD COLUMN "valorTotalBs" DECIMAL(20,2),
    ADD COLUMN "saldoCajasEmpresa" DECIMAL(14,3),
    ADD COLUMN "costoPromedioResultanteUsd" DECIMAL(14,4),
    ADD COLUMN "costoPromedioResultanteBs" DECIMAL(20,4),
    ADD COLUMN "proveedor" TEXT,
    ADD COLUMN "numeroFacturaCompra" TEXT;

-- CreateIndex
-- destructivo-aprobado: tabla MovimientoInventario aun sin trafico en produccion (modulo administrativo desactivado), indice pequeno
CREATE INDEX "MovimientoInventario_empresaId_fecha_idx" ON "MovimientoInventario"("empresaId", "fecha");

-- CreateTable: HistorialCostoProducto
CREATE TABLE "HistorialCostoProducto" (
    "id" BIGSERIAL NOT NULL,
    "organizacionId" TEXT NOT NULL DEFAULT 'org-principal',
    "empresaId" TEXT NOT NULL,
    "productoId" TEXT NOT NULL,
    "tipoCosto" TEXT NOT NULL,
    "costoAnteriorUsd" DECIMAL(14,4),
    "costoNuevoUsd" DECIMAL(14,4) NOT NULL,
    "costoNuevoBs" DECIMAL(20,4),
    "tasa" DECIMAL(20,8),
    "motivo" TEXT,
    "movimientoId" BIGINT,
    "usuarioId" TEXT,
    "fecha" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HistorialCostoProducto_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "HistorialCostoProducto_productoId_fecha_idx" ON "HistorialCostoProducto"("productoId", "fecha");
CREATE INDEX "HistorialCostoProducto_empresaId_tipoCosto_fecha_idx" ON "HistorialCostoProducto"("empresaId", "tipoCosto", "fecha");

ALTER TABLE "HistorialCostoProducto"
    ADD CONSTRAINT "HistorialCostoProducto_productoId_fkey"
    FOREIGN KEY ("productoId") REFERENCES "Producto"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: CuentaTesoreria
CREATE TABLE "CuentaTesoreria" (
    "id" TEXT NOT NULL,
    "organizacionId" TEXT NOT NULL DEFAULT 'org-principal',
    "empresaId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "moneda" TEXT NOT NULL,
    "bancoCodigo" TEXT,
    "numeroCuenta" TEXT,
    "titular" TEXT,
    "rif" TEXT,
    "saldoInicial" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "fechaSaldoInicial" DATE NOT NULL,
    "saldoActual" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "cuentaPortalId" TEXT,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "creadaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CuentaTesoreria_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CuentaTesoreria_empresaId_activa_idx" ON "CuentaTesoreria"("empresaId", "activa");

ALTER TABLE "CuentaTesoreria"
    ADD CONSTRAINT "CuentaTesoreria_empresaId_fkey"
    FOREIGN KEY ("empresaId") REFERENCES "EmpresaFiscal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable: MovimientoBancario
CREATE TABLE "MovimientoBancario" (
    "id" BIGSERIAL NOT NULL,
    "organizacionId" TEXT NOT NULL DEFAULT 'org-principal',
    "empresaId" TEXT NOT NULL,
    "cuentaId" TEXT NOT NULL,
    "fecha" DATE NOT NULL,
    "tipo" TEXT NOT NULL,
    "metodo" TEXT NOT NULL,
    "categoria" TEXT NOT NULL,
    "concepto" TEXT NOT NULL,
    "tercero" TEXT,
    "referencia" TEXT,
    "monto" DECIMAL(20,2) NOT NULL,
    "tasa" DECIMAL(20,8),
    "montoUsd" DECIMAL(20,2) NOT NULL,
    "montoBs" DECIMAL(20,2),
    "saldoResultante" DECIMAL(20,2) NOT NULL,
    "transferenciaGrupoId" TEXT,
    "pagoId" TEXT,
    "gastoId" TEXT,
    "liquidacionDeliveryId" TEXT,
    "conciliado" BOOLEAN NOT NULL DEFAULT false,
    "conciliadoEn" TIMESTAMP(3),
    "conciliadoPorId" TEXT,
    "anuladoEn" TIMESTAMP(3),
    "anuladoPorId" TEXT,
    "motivoAnulacion" TEXT,
    "reversoDeId" BIGINT,
    "usuarioId" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MovimientoBancario_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MovimientoBancario_cuentaId_fecha_idx" ON "MovimientoBancario"("cuentaId", "fecha");
CREATE INDEX "MovimientoBancario_empresaId_fecha_idx" ON "MovimientoBancario"("empresaId", "fecha");
CREATE INDEX "MovimientoBancario_transferenciaGrupoId_idx" ON "MovimientoBancario"("transferenciaGrupoId");
CREATE INDEX "MovimientoBancario_pagoId_idx" ON "MovimientoBancario"("pagoId");
CREATE INDEX "MovimientoBancario_gastoId_idx" ON "MovimientoBancario"("gastoId");

-- Idempotencia para movimientos vinculados a pagos/gastos/liquidaciones no anulados
CREATE UNIQUE INDEX "MovimientoBancario_pagoId_activo_key"
    ON "MovimientoBancario"("pagoId") WHERE "pagoId" IS NOT NULL AND "anuladoEn" IS NULL;
CREATE UNIQUE INDEX "MovimientoBancario_gastoId_activo_key"
    ON "MovimientoBancario"("gastoId") WHERE "gastoId" IS NOT NULL AND "anuladoEn" IS NULL;

ALTER TABLE "MovimientoBancario"
    ADD CONSTRAINT "MovimientoBancario_cuentaId_fkey"
    FOREIGN KEY ("cuentaId") REFERENCES "CuentaTesoreria"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable: ConciliacionBancaria
CREATE TABLE "ConciliacionBancaria" (
    "id" TEXT NOT NULL,
    "organizacionId" TEXT NOT NULL DEFAULT 'org-principal',
    "empresaId" TEXT NOT NULL,
    "cuentaId" TEXT NOT NULL,
    "archivo" TEXT NOT NULL,
    "periodoDesde" DATE NOT NULL,
    "periodoHasta" DATE NOT NULL,
    "saldoExtractoFinal" DECIMAL(20,2),
    "estado" TEXT NOT NULL DEFAULT 'BORRADOR',
    "resumen" JSONB NOT NULL,
    "lineas" JSONB NOT NULL,
    "creadaPorId" TEXT NOT NULL,
    "creadaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmadaPorId" TEXT,
    "confirmadaEn" TIMESTAMP(3),

    CONSTRAINT "ConciliacionBancaria_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ConciliacionBancaria_cuentaId_creadaEn_idx" ON "ConciliacionBancaria"("cuentaId", "creadaEn");
CREATE INDEX "ConciliacionBancaria_empresaId_creadaEn_idx" ON "ConciliacionBancaria"("empresaId", "creadaEn");

ALTER TABLE "ConciliacionBancaria"
    ADD CONSTRAINT "ConciliacionBancaria_empresaId_fkey"
    FOREIGN KEY ("empresaId") REFERENCES "EmpresaFiscal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ConciliacionBancaria"
    ADD CONSTRAINT "ConciliacionBancaria_cuentaId_fkey"
    FOREIGN KEY ("cuentaId") REFERENCES "CuentaTesoreria"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Row Level Security por organizacion (consistente con 20261121120000_rls_organizacion)
ALTER TABLE "HistorialCostoProducto" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "HistorialCostoProducto" FORCE ROW LEVEL SECURITY;
CREATE POLICY "historial_costo_producto_organizacion_policy" ON "HistorialCostoProducto"
    USING ("organizacionId" = COALESCE(NULLIF(current_setting('app.organizacion_id', true), ''), 'org-principal'))
    WITH CHECK ("organizacionId" = COALESCE(NULLIF(current_setting('app.organizacion_id', true), ''), 'org-principal'));

ALTER TABLE "CuentaTesoreria" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CuentaTesoreria" FORCE ROW LEVEL SECURITY;
CREATE POLICY "cuenta_tesoreria_organizacion_policy" ON "CuentaTesoreria"
    USING ("organizacionId" = COALESCE(NULLIF(current_setting('app.organizacion_id', true), ''), 'org-principal'))
    WITH CHECK ("organizacionId" = COALESCE(NULLIF(current_setting('app.organizacion_id', true), ''), 'org-principal'));

ALTER TABLE "MovimientoBancario" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MovimientoBancario" FORCE ROW LEVEL SECURITY;
CREATE POLICY "movimiento_bancario_organizacion_policy" ON "MovimientoBancario"
    USING ("organizacionId" = COALESCE(NULLIF(current_setting('app.organizacion_id', true), ''), 'org-principal'))
    WITH CHECK ("organizacionId" = COALESCE(NULLIF(current_setting('app.organizacion_id', true), ''), 'org-principal'));

ALTER TABLE "ConciliacionBancaria" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ConciliacionBancaria" FORCE ROW LEVEL SECURITY;
CREATE POLICY "conciliacion_bancaria_organizacion_policy" ON "ConciliacionBancaria"
    USING ("organizacionId" = COALESCE(NULLIF(current_setting('app.organizacion_id', true), ''), 'org-principal'))
    WITH CHECK ("organizacionId" = COALESCE(NULLIF(current_setting('app.organizacion_id', true), ''), 'org-principal'));

-- Permisos nuevos para Costos de Inventario y Modulo de Bancos
INSERT INTO "Permiso" ("codigo", "modulo", "descripcion") VALUES
    ('inventario.costos', 'inventario', 'Ver y configurar costos de inventario y costo presupuestario'),
    ('bancos.ver', 'bancos', 'Ver cuentas bancarias, disponible y flujo de caja'),
    ('bancos.operar', 'bancos', 'Registrar ingresos, egresos y transferencias bancarias'),
    ('bancos.conciliar', 'bancos', 'Cargar y confirmar conciliaciones de estados de cuenta bancarios'),
    ('bancos.administrar', 'bancos', 'Crear/editar cuentas bancarias y anular movimientos')
ON CONFLICT ("codigo") DO NOTHING;

INSERT INTO "RolPermiso" ("rol", "permisoCodigo") VALUES
    ('COBRANZAS', 'bancos.ver'),
    ('COBRANZAS', 'bancos.operar'),
    ('COBRANZAS', 'bancos.conciliar')
ON CONFLICT DO NOTHING;
