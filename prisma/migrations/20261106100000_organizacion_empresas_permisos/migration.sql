-- AlterTable
ALTER TABLE "Usuario" ADD COLUMN     "organizacionId" TEXT NOT NULL DEFAULT 'org-principal';

-- AlterTable
ALTER TABLE "Almacen" ADD COLUMN     "organizacionId" TEXT NOT NULL DEFAULT 'org-principal';

-- AlterTable
ALTER TABLE "Vehiculo" ADD COLUMN     "organizacionId" TEXT NOT NULL DEFAULT 'org-principal';

-- AlterTable
ALTER TABLE "Cliente" ADD COLUMN     "organizacionId" TEXT NOT NULL DEFAULT 'org-principal';

-- AlterTable
ALTER TABLE "Despacho" ADD COLUMN     "organizacionId" TEXT NOT NULL DEFAULT 'org-principal';

-- AlterTable
ALTER TABLE "Ruta" ADD COLUMN     "organizacionId" TEXT NOT NULL DEFAULT 'org-principal';

-- AlterTable
ALTER TABLE "VendedorRuta" ADD COLUMN     "organizacionId" TEXT NOT NULL DEFAULT 'org-principal';

-- AlterTable
ALTER TABLE "Visita" ADD COLUMN     "organizacionId" TEXT NOT NULL DEFAULT 'org-principal';

-- AlterTable
ALTER TABLE "VentaCarga" ADD COLUMN     "organizacionId" TEXT NOT NULL DEFAULT 'org-principal';

-- AlterTable
ALTER TABLE "VentaCliente" ADD COLUMN     "organizacionId" TEXT NOT NULL DEFAULT 'org-principal';

-- AlterTable
ALTER TABLE "VentaProducto" ADD COLUMN     "organizacionId" TEXT NOT NULL DEFAULT 'org-principal';

-- AlterTable
ALTER TABLE "ListaPrecioCarga" ADD COLUMN     "organizacionId" TEXT NOT NULL DEFAULT 'org-principal';

-- AlterTable
ALTER TABLE "MetaVenta" ADD COLUMN     "organizacionId" TEXT NOT NULL DEFAULT 'org-principal';

-- AlterTable
ALTER TABLE "MetaLitros" ADD COLUMN     "organizacionId" TEXT NOT NULL DEFAULT 'org-principal';

-- AlterTable
ALTER TABLE "Venta" ADD COLUMN     "organizacionId" TEXT NOT NULL DEFAULT 'org-principal';

-- AlterTable
ALTER TABLE "TabuladorDelivery" ADD COLUMN     "organizacionId" TEXT NOT NULL DEFAULT 'org-principal';

-- AlterTable
ALTER TABLE "LiquidacionDelivery" ADD COLUMN     "organizacionId" TEXT NOT NULL DEFAULT 'org-principal';

-- AlterTable
ALTER TABLE "Censo" ADD COLUMN     "organizacionId" TEXT NOT NULL DEFAULT 'org-principal';

-- AlterTable
ALTER TABLE "MaestraCarga" ADD COLUMN     "organizacionId" TEXT NOT NULL DEFAULT 'org-principal';

-- AlterTable
ALTER TABLE "MaestraCliente" ADD COLUMN     "organizacionId" TEXT NOT NULL DEFAULT 'org-principal';

-- AlterTable
ALTER TABLE "CuentaPortal" ADD COLUMN     "organizacionId" TEXT NOT NULL DEFAULT 'org-principal';

-- AlterTable
ALTER TABLE "DocumentoCobro" ADD COLUMN     "organizacionId" TEXT NOT NULL DEFAULT 'org-principal';

-- AlterTable
ALTER TABLE "Pago" ADD COLUMN     "organizacionId" TEXT NOT NULL DEFAULT 'org-principal';

-- AlterTable
ALTER TABLE "CuentaBancariaEmpresa" ADD COLUMN     "organizacionId" TEXT NOT NULL DEFAULT 'org-principal';

-- CreateTable
CREATE TABLE "Organizacion" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "creadaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Organizacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmpresaFiscal" (
    "id" TEXT NOT NULL,
    "organizacionId" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "rif" TEXT,
    "razonSocial" TEXT NOT NULL,
    "nombreComercial" TEXT,
    "domicilioFiscal" TEXT,
    "telefono" TEXT,
    "correo" TEXT,
    "contribuyenteEspecial" BOOLEAN NOT NULL DEFAULT false,
    "agenteRetencionIva" BOOLEAN NOT NULL DEFAULT false,
    "porcentajeRetencionIva" INTEGER,
    "agenteRetencionIslr" BOOLEAN NOT NULL DEFAULT false,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "creadaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmpresaFiscal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsuarioEmpresa" (
    "usuarioId" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,

    CONSTRAINT "UsuarioEmpresa_pkey" PRIMARY KEY ("usuarioId","empresaId")
);

-- CreateTable
CREATE TABLE "Permiso" (
    "codigo" TEXT NOT NULL,
    "modulo" TEXT NOT NULL,
    "descripcion" TEXT NOT NULL,

    CONSTRAINT "Permiso_pkey" PRIMARY KEY ("codigo")
);

-- CreateTable
CREATE TABLE "RolPermiso" (
    "rol" "RolUsuario" NOT NULL,
    "permisoCodigo" TEXT NOT NULL,

    CONSTRAINT "RolPermiso_pkey" PRIMARY KEY ("rol","permisoCodigo")
);

-- CreateTable
CREATE TABLE "UsuarioPermiso" (
    "usuarioId" TEXT NOT NULL,
    "permisoCodigo" TEXT NOT NULL,

    CONSTRAINT "UsuarioPermiso_pkey" PRIMARY KEY ("usuarioId","permisoCodigo")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmpresaFiscal_organizacionId_codigo_key" ON "EmpresaFiscal"("organizacionId", "codigo");

-- AddForeignKey
ALTER TABLE "EmpresaFiscal" ADD CONSTRAINT "EmpresaFiscal_organizacionId_fkey" FOREIGN KEY ("organizacionId") REFERENCES "Organizacion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsuarioEmpresa" ADD CONSTRAINT "UsuarioEmpresa_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsuarioEmpresa" ADD CONSTRAINT "UsuarioEmpresa_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "EmpresaFiscal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolPermiso" ADD CONSTRAINT "RolPermiso_permisoCodigo_fkey" FOREIGN KEY ("permisoCodigo") REFERENCES "Permiso"("codigo") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsuarioPermiso" ADD CONSTRAINT "UsuarioPermiso_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsuarioPermiso" ADD CONSTRAINT "UsuarioPermiso_permisoCodigo_fkey" FOREIGN KEY ("permisoCodigo") REFERENCES "Permiso"("codigo") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------- Datos iniciales ----------
-- La organizacion de hoy y sus dos empresas. Los datos fiscales (RIF,
-- razon social, domicilio) los completa el administrador en la pantalla de
-- empresas; sin ellos no se puede facturar.
INSERT INTO "Organizacion" ("id", "nombre") VALUES ('org-principal', 'ISVAN / TRALOG')
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "EmpresaFiscal" ("id", "organizacionId", "codigo", "razonSocial") VALUES
    ('emp-isvan', 'org-principal', 'ISVAN', 'ISVAN'),
    ('emp-tralog', 'org-principal', 'TRALOG', 'TRALOG')
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "Permiso" ("codigo", "modulo", "descripcion") VALUES
    ('empresas.administrar', 'administracion', 'Editar los datos fiscales de las empresas'),
    ('bitacora.ver', 'administracion', 'Ver la bitacora de cambios'),
    ('catalogo.ver', 'catalogo', 'Ver productos y listas de precio'),
    ('catalogo.editar', 'catalogo', 'Crear y editar productos e impuestos'),
    ('precios.editar', 'catalogo', 'Cambiar precios de las listas'),
    ('clientes.ficha_fiscal', 'clientes', 'Editar la ficha fiscal y el credito de los clientes'),
    ('ventas.pedidos.ver', 'ventas', 'Ver pedidos'),
    ('ventas.pedidos.crear', 'ventas', 'Crear y confirmar pedidos'),
    ('ventas.pedidos.anular', 'ventas', 'Anular pedidos'),
    ('ventas.documentos.ver', 'ventas', 'Ver facturas, notas de entrega y notas de credito'),
    ('ventas.facturar', 'ventas', 'Emitir facturas y notas de entrega'),
    ('ventas.notas', 'ventas', 'Emitir notas de credito y de debito'),
    ('inventario.ver', 'inventario', 'Ver existencias y movimientos'),
    ('inventario.entradas', 'inventario', 'Registrar entradas y traslados'),
    ('inventario.ajustar', 'inventario', 'Proponer ajustes de inventario'),
    ('inventario.aprobar_ajuste', 'inventario', 'Aprobar ajustes de inventario'),
    ('fiscal.libros', 'fiscal', 'Ver y descargar el libro de ventas')
ON CONFLICT ("codigo") DO NOTHING;

-- Plantillas por rol (ADMIN tiene todo sin filas).
INSERT INTO "RolPermiso" ("rol", "permisoCodigo") VALUES
    ('VENDEDOR', 'catalogo.ver'),
    ('VENDEDOR', 'ventas.pedidos.ver'),
    ('VENDEDOR', 'ventas.pedidos.crear'),
    ('DESPACHOS', 'inventario.ver'),
    ('DESPACHOS', 'ventas.documentos.ver'),
    ('APROBADOR', 'ventas.documentos.ver'),
    ('COBRANZAS', 'ventas.documentos.ver'),
    ('SUPERVISOR', 'ventas.pedidos.ver')
ON CONFLICT DO NOTHING;
