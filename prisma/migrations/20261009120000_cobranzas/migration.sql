-- Modulo de cobranzas: cartera calculada desde el extracto de ventas, pagos
-- reportados por los clientes desde su portal (o registrados por cobranzas),
-- tasa BCV y excepciones al bloqueo de despachos por deuda vencida. Ver
-- backend/app/services/cartera.py.

-- Rol interno de cobranzas (solo entra a /cobranzas).
ALTER TYPE "RolUsuario" ADD VALUE 'COBRANZAS';

CREATE TYPE "EstadoCuentaPortal" AS ENUM ('PENDIENTE_CORREO', 'POR_VALIDAR', 'ACTIVA', 'SUSPENDIDA');
CREATE TYPE "MetodoPago" AS ENUM ('PAGO_MOVIL', 'TRANSFERENCIA', 'EFECTIVO', 'DIVISAS', 'RETENCION', 'AJUSTE');
CREATE TYPE "EstadoPago" AS ENUM ('REPORTADO', 'VERIFICADO', 'RECHAZADO');
CREATE TYPE "OrigenDocumento" AS ENUM ('EXTRACTO_VENTAS', 'CXC', 'MANUAL');

-- Quien puede aprobar el despacho de un cliente con deuda vencida (el ADMIN
-- siempre puede).
ALTER TABLE "Usuario" ADD COLUMN "autorizaExcepciones" BOOLEAN NOT NULL DEFAULT false;

-- ---------- Portal de clientes ----------

CREATE TABLE "CuentaPortal" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "rif" TEXT NOT NULL,
    "telefono" TEXT,
    "estado" "EstadoCuentaPortal" NOT NULL DEFAULT 'PENDIENTE_CORREO',
    "correoVerificadoEn" TIMESTAMP(3),
    "empresaDeclarada" "Empresa",
    "codigoDeclarado" TEXT,
    "intentosFallidos" INTEGER NOT NULL DEFAULT 0,
    "bloqueadoHasta" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CuentaPortal_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CuentaPortal_email_key" ON "CuentaPortal"("email");
CREATE INDEX "CuentaPortal_estado_idx" ON "CuentaPortal"("estado");

CREATE TABLE "CuentaPortalCliente" (
    "id" TEXT NOT NULL,
    "cuentaId" TEXT NOT NULL,
    "empresa" "Empresa" NOT NULL,
    "codigoCliente" TEXT NOT NULL,
    "origen" TEXT NOT NULL,
    "vinculadoPorId" TEXT,
    "vinculadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CuentaPortalCliente_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CuentaPortalCliente_cuentaId_empresa_codigoCliente_key" ON "CuentaPortalCliente"("cuentaId", "empresa", "codigoCliente");
CREATE INDEX "CuentaPortalCliente_empresa_codigoCliente_idx" ON "CuentaPortalCliente"("empresa", "codigoCliente");
ALTER TABLE "CuentaPortalCliente" ADD CONSTRAINT "CuentaPortalCliente_cuentaId_fkey" FOREIGN KEY ("cuentaId") REFERENCES "CuentaPortal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CuentaPortalCliente" ADD CONSTRAINT "CuentaPortalCliente_vinculadoPorId_fkey" FOREIGN KEY ("vinculadoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "SesionPortal" (
    "id" TEXT NOT NULL,
    "cuentaId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiraEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SesionPortal_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SesionPortal_tokenHash_key" ON "SesionPortal"("tokenHash");
ALTER TABLE "SesionPortal" ADD CONSTRAINT "SesionPortal_cuentaId_fkey" FOREIGN KEY ("cuentaId") REFERENCES "CuentaPortal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Codigos de 6 digitos enviados por correo (confirmar la cuenta, recuperar
-- la clave). Solo se guarda su hash.
CREATE TABLE "CodigoCorreo" (
    "id" TEXT NOT NULL,
    "cuentaId" TEXT NOT NULL,
    "proposito" TEXT NOT NULL,
    "codigoHash" TEXT NOT NULL,
    "enviadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiraEn" TIMESTAMP(3) NOT NULL,
    "intentos" INTEGER NOT NULL DEFAULT 0,
    "usadoEn" TIMESTAMP(3),

    CONSTRAINT "CodigoCorreo_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CodigoCorreo_cuentaId_proposito_idx" ON "CodigoCorreo"("cuentaId", "proposito");
ALTER TABLE "CodigoCorreo" ADD CONSTRAINT "CodigoCorreo_cuentaId_fkey" FOREIGN KEY ("cuentaId") REFERENCES "CuentaPortal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------- Tasa BCV ----------

-- La tasa de una fecha es la de la fila mas reciente con fecha <= esa fecha
-- (fines de semana y feriados usan la del ultimo dia habil).
CREATE TABLE "TasaCambio" (
    "fecha" DATE NOT NULL,
    "tasa" DECIMAL(20,8) NOT NULL,
    "fuente" TEXT NOT NULL,
    "registradoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "registradoPorId" TEXT,

    CONSTRAINT "TasaCambio_pkey" PRIMARY KEY ("fecha")
);
ALTER TABLE "TasaCambio" ADD CONSTRAINT "TasaCambio_registradoPorId_fkey" FOREIGN KEY ("registradoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------- Cartera ----------

-- Un documento por cobrar (FA/NE) o a favor del cliente (DV/DN, monto
-- negativo). Hoy sale del extracto de ventas; manana puede venir de un
-- reporte de cuentas por cobrar (origen CXC, con vencimiento propio).
CREATE TABLE "DocumentoCobro" (
    "id" TEXT NOT NULL,
    "empresa" "Empresa" NOT NULL,
    "tipoDoc" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "codigoCliente" TEXT NOT NULL,
    "fecha" DATE NOT NULL,
    "vencimiento" DATE,
    "montoUsd" DECIMAL(20,2) NOT NULL,
    "montoBs" DECIMAL(20,2) NOT NULL,
    "origen" "OrigenDocumento" NOT NULL,
    -- false si el documento ya no esta en su origen (se revirtio la carga);
    -- se conserva por los pagos que lo referencian.
    "vigente" BOOLEAN NOT NULL DEFAULT true,
    "actualizadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentoCobro_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DocumentoCobro_empresa_tipoDoc_numero_key" ON "DocumentoCobro"("empresa", "tipoDoc", "numero");
CREATE INDEX "DocumentoCobro_empresa_codigoCliente_idx" ON "DocumentoCobro"("empresa", "codigoCliente");
CREATE INDEX "DocumentoCobro_empresa_fecha_idx" ON "DocumentoCobro"("empresa", "fecha");

CREATE TABLE "Pago" (
    "id" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "empresa" "Empresa" NOT NULL,
    "codigoCliente" TEXT NOT NULL,
    "cuentaPortalId" TEXT,
    "registradoPorId" TEXT,
    "metodo" "MetodoPago" NOT NULL,
    "bancoCodigo" TEXT,
    "telefono" TEXT,
    "cedulaRif" TEXT,
    "cuenta" TEXT,
    "referencia" TEXT,
    "fechaPago" DATE NOT NULL,
    "montoBs" DECIMAL(20,2),
    "tasa" DECIMAL(20,8),
    "montoUsd" DECIMAL(20,2) NOT NULL,
    "comprobanteClave" TEXT,
    "comprobanteTipo" TEXT,
    "nota" TEXT,
    "estado" "EstadoPago" NOT NULL DEFAULT 'REPORTADO',
    "reportadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revisadoPorId" TEXT,
    "revisadoEn" TIMESTAMP(3),
    "motivoRechazo" TEXT,
    "metodoVerificacion" TEXT,

    CONSTRAINT "Pago_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Pago_numero_key" ON "Pago"("numero");
CREATE INDEX "Pago_empresa_codigoCliente_idx" ON "Pago"("empresa", "codigoCliente");
CREATE INDEX "Pago_estado_reportadoEn_idx" ON "Pago"("estado", "reportadoEn");
CREATE INDEX "Pago_cuentaPortalId_idx" ON "Pago"("cuentaPortalId");
-- Un mismo pago bancario no se puede reportar dos veces (salvo que el
-- anterior se haya rechazado).
CREATE UNIQUE INDEX "Pago_banco_referencia_fecha_key" ON "Pago"("bancoCodigo", "referencia", "fechaPago")
    WHERE "estado" <> 'RECHAZADO' AND "referencia" IS NOT NULL AND "bancoCodigo" IS NOT NULL;
ALTER TABLE "Pago" ADD CONSTRAINT "Pago_cuentaPortalId_fkey" FOREIGN KEY ("cuentaPortalId") REFERENCES "CuentaPortal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Pago" ADD CONSTRAINT "Pago_registradoPorId_fkey" FOREIGN KEY ("registradoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Pago" ADD CONSTRAINT "Pago_revisadoPorId_fkey" FOREIGN KEY ("revisadoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A que documentos abona un pago (el cliente lo propone al reportar;
-- cobranzas lo confirma o corrige al verificar).
CREATE TABLE "PagoAplicacion" (
    "id" TEXT NOT NULL,
    "pagoId" TEXT NOT NULL,
    "documentoId" TEXT NOT NULL,
    "montoUsd" DECIMAL(20,2) NOT NULL,

    CONSTRAINT "PagoAplicacion_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PagoAplicacion_pagoId_documentoId_key" ON "PagoAplicacion"("pagoId", "documentoId");
CREATE INDEX "PagoAplicacion_documentoId_idx" ON "PagoAplicacion"("documentoId");
ALTER TABLE "PagoAplicacion" ADD CONSTRAINT "PagoAplicacion_pagoId_fkey" FOREIGN KEY ("pagoId") REFERENCES "Pago"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PagoAplicacion" ADD CONSTRAINT "PagoAplicacion_documentoId_fkey" FOREIGN KEY ("documentoId") REFERENCES "DocumentoCobro"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Despacho aprobado aunque el cliente tenia deuda vencida.
CREATE TABLE "ExcepcionDespacho" (
    "id" TEXT NOT NULL,
    "despachoId" TEXT NOT NULL,
    "autorizadoPorId" TEXT NOT NULL,
    "motivo" TEXT NOT NULL,
    "saldoVencidoUsd" DECIMAL(20,2) NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExcepcionDespacho_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ExcepcionDespacho_despachoId_key" ON "ExcepcionDespacho"("despachoId");
ALTER TABLE "ExcepcionDespacho" ADD CONSTRAINT "ExcepcionDespacho_despachoId_fkey" FOREIGN KEY ("despachoId") REFERENCES "Despacho"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExcepcionDespacho" ADD CONSTRAINT "ExcepcionDespacho_autorizadoPorId_fkey" FOREIGN KEY ("autorizadoPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Donde pagan los clientes (se muestra en el portal).
CREATE TABLE "CuentaBancariaEmpresa" (
    "id" TEXT NOT NULL,
    "empresa" "Empresa" NOT NULL,
    "bancoCodigo" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "rif" TEXT NOT NULL,
    "titular" TEXT NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "creadaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CuentaBancariaEmpresa_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CuentaBancariaEmpresa_empresa_idx" ON "CuentaBancariaEmpresa"("empresa");

-- Relleno inicial de la cartera desde las ventas confirmadas (lo mismo que
-- hace cartera.sincronizar_documentos al confirmar o revertir una carga).
INSERT INTO "DocumentoCobro" ("id", "empresa", "tipoDoc", "numero", "codigoCliente", "fecha", "montoUsd", "montoBs", "origen")
SELECT 'doc-' || substr(md5(v."empresa"::text || v."codTipoDoc" || v."numDoc"), 1, 16),
       v."empresa", v."codTipoDoc", v."numDoc", min(v."codigoCliente"), min(v."fecha"),
       round(sum(v."montoUsd"), 2), round(sum(v."montoBs"), 2), 'EXTRACTO_VENTAS'
FROM "Venta" v JOIN "VentaCarga" c ON c."id" = v."cargaId"
WHERE c."estado" = 'CONFIRMADA' AND v."reemplazadaPorCargaId" IS NULL
GROUP BY v."empresa", v."codTipoDoc", v."numDoc";
