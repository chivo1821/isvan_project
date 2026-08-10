-- CreateEnum
CREATE TYPE "RolUsuario" AS ENUM ('ADMIN', 'VENTAS', 'INVENTARIO', 'DESPACHOS', 'APROBADOR', 'REPARTIDOR');

-- CreateEnum
CREATE TYPE "CategoriaProducto" AS ENUM ('HELADO', 'PIZZA');

-- CreateEnum
CREATE TYPE "EstadoVenta" AS ENUM ('PENDIENTE', 'EN_REVISION', 'APROBADA', 'RECHAZADA', 'DESPACHADA', 'ANULADA');

-- CreateEnum
CREATE TYPE "AccionRevision" AS ENUM ('APROBADA', 'RECHAZADA');

-- CreateEnum
CREATE TYPE "EstadoFactura" AS ENUM ('PENDIENTE', 'PAGADA', 'VENCIDA');

-- CreateEnum
CREATE TYPE "EstadoDespacho" AS ENUM ('BORRADOR', 'PENDIENTE_APROBACION', 'APROBADO', 'RECHAZADO', 'EN_PREPARACION', 'EN_TRANSITO', 'ENTREGADO', 'CANCELADO');

-- CreateEnum
CREATE TYPE "TipoVehiculo" AS ENUM ('CAMION_REFRIGERADO', 'CAMIONETA', 'MOTO');

-- CreateEnum
CREATE TYPE "EstadoVehiculo" AS ENUM ('FUNCIONAL', 'EN_MANTENIMIENTO', 'FUERA_DE_SERVICIO');

-- CreateTable
CREATE TABLE "Usuario" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "rol" "RolUsuario" NOT NULL,
    "avatarUrl" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Usuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Producto" (
    "id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "categoria" "CategoriaProducto" NOT NULL,
    "subcategoria" TEXT,
    "unidadMedida" TEXT NOT NULL,
    "requiereCadenaFrio" BOOLEAN NOT NULL DEFAULT true,
    "temperaturaMinC" INTEGER,
    "temperaturaMaxC" INTEGER,
    "precioUnitario" DECIMAL(65,30) NOT NULL,
    "imagenUrl" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Producto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Almacen" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "direccion" TEXT NOT NULL,
    "ciudad" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "esFrigorifico" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Almacen_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockAlmacen" (
    "id" TEXT NOT NULL,
    "productoId" TEXT NOT NULL,
    "almacenId" TEXT NOT NULL,
    "cantidad" INTEGER NOT NULL,
    "stockMinimo" INTEGER NOT NULL,

    CONSTRAINT "StockAlmacen_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TasaCambio" (
    "id" TEXT NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL,
    "tasa" DECIMAL(65,30) NOT NULL,

    CONSTRAINT "TasaCambio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cliente" (
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "direccion" TEXT NOT NULL,
    "ciudad" TEXT NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "telefono" TEXT,
    "email" TEXT,

    CONSTRAINT "Cliente_pkey" PRIMARY KEY ("codigo")
);

-- CreateTable
CREATE TABLE "Factura" (
    "id" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "monto" DECIMAL(65,30) NOT NULL,
    "fechaEmision" TIMESTAMP(3) NOT NULL,
    "fechaVencimiento" TIMESTAMP(3) NOT NULL,
    "estado" "EstadoFactura" NOT NULL DEFAULT 'PENDIENTE',
    "tasaBcv" DECIMAL(65,30) NOT NULL,
    "fechaPago" TIMESTAMP(3),
    "montoPagado" DECIMAL(65,30),
    "metodoPago" TEXT,
    "pagoAprobado" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Factura_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Venta" (
    "id" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "vendedorId" TEXT NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "estado" "EstadoVenta" NOT NULL DEFAULT 'PENDIENTE',
    "total" DECIMAL(65,30) NOT NULL,
    "tasaBcv" DECIMAL(65,30) NOT NULL,

    CONSTRAINT "Venta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VentaItem" (
    "id" TEXT NOT NULL,
    "ventaId" TEXT NOT NULL,
    "productoId" TEXT NOT NULL,
    "cantidad" INTEGER NOT NULL,
    "precioUnitario" DECIMAL(65,30) NOT NULL,
    "subtotal" DECIMAL(65,30) NOT NULL,

    CONSTRAINT "VentaItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VentaRevision" (
    "id" TEXT NOT NULL,
    "ventaId" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "accion" "AccionRevision" NOT NULL,
    "comentario" TEXT,
    "fecha" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VentaRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vehiculo" (
    "id" TEXT NOT NULL,
    "placa" TEXT NOT NULL,
    "tipo" "TipoVehiculo" NOT NULL,
    "capacidadKg" DOUBLE PRECISION NOT NULL,
    "tieneRefrigeracion" BOOLEAN NOT NULL DEFAULT true,
    "estado" "EstadoVehiculo" NOT NULL DEFAULT 'FUNCIONAL',
    "almacenBaseId" TEXT NOT NULL,
    "conductorNombre" TEXT,
    "ultimaRevision" TIMESTAMP(3),

    CONSTRAINT "Vehiculo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Despacho" (
    "id" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "ventaId" TEXT,
    "origenId" TEXT NOT NULL,
    "destinoClienteId" TEXT NOT NULL,
    "creadoPorId" TEXT NOT NULL,
    "estado" "EstadoDespacho" NOT NULL DEFAULT 'BORRADOR',
    "fechaCreacion" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fechaEstimadaEntrega" TIMESTAMP(3),
    "vehiculoId" TEXT,
    "distanciaEstimadaKm" DOUBLE PRECISION,
    "tiempoEstimadoMin" INTEGER,
    "rutaCalculada" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Despacho_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DespachoItem" (
    "id" TEXT NOT NULL,
    "despachoId" TEXT NOT NULL,
    "productoId" TEXT NOT NULL,
    "cantidad" INTEGER NOT NULL,

    CONSTRAINT "DespachoItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DespachoAprobacion" (
    "id" TEXT NOT NULL,
    "despachoId" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "accion" "AccionRevision" NOT NULL,
    "comentario" TEXT,
    "fecha" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DespachoAprobacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RutaPunto" (
    "id" TEXT NOT NULL,
    "despachoId" TEXT NOT NULL,
    "orden" INTEGER NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "estado" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "descripcion" TEXT,

    CONSTRAINT "RutaPunto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Usuario_email_key" ON "Usuario"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Producto_sku_key" ON "Producto"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "StockAlmacen_productoId_almacenId_key" ON "StockAlmacen"("productoId", "almacenId");

-- CreateIndex
CREATE UNIQUE INDEX "TasaCambio_fecha_key" ON "TasaCambio"("fecha");

-- CreateIndex
CREATE UNIQUE INDEX "Factura_numero_key" ON "Factura"("numero");

-- CreateIndex
CREATE UNIQUE INDEX "Venta_numero_key" ON "Venta"("numero");

-- CreateIndex
CREATE UNIQUE INDEX "Vehiculo_placa_key" ON "Vehiculo"("placa");

-- CreateIndex
CREATE UNIQUE INDEX "Despacho_numero_key" ON "Despacho"("numero");

-- AddForeignKey
ALTER TABLE "StockAlmacen" ADD CONSTRAINT "StockAlmacen_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "Producto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockAlmacen" ADD CONSTRAINT "StockAlmacen_almacenId_fkey" FOREIGN KEY ("almacenId") REFERENCES "Almacen"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Factura" ADD CONSTRAINT "Factura_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("codigo") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Venta" ADD CONSTRAINT "Venta_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("codigo") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Venta" ADD CONSTRAINT "Venta_vendedorId_fkey" FOREIGN KEY ("vendedorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VentaItem" ADD CONSTRAINT "VentaItem_ventaId_fkey" FOREIGN KEY ("ventaId") REFERENCES "Venta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VentaItem" ADD CONSTRAINT "VentaItem_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "Producto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VentaRevision" ADD CONSTRAINT "VentaRevision_ventaId_fkey" FOREIGN KEY ("ventaId") REFERENCES "Venta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VentaRevision" ADD CONSTRAINT "VentaRevision_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vehiculo" ADD CONSTRAINT "Vehiculo_almacenBaseId_fkey" FOREIGN KEY ("almacenBaseId") REFERENCES "Almacen"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Despacho" ADD CONSTRAINT "Despacho_ventaId_fkey" FOREIGN KEY ("ventaId") REFERENCES "Venta"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Despacho" ADD CONSTRAINT "Despacho_origenId_fkey" FOREIGN KEY ("origenId") REFERENCES "Almacen"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Despacho" ADD CONSTRAINT "Despacho_destinoClienteId_fkey" FOREIGN KEY ("destinoClienteId") REFERENCES "Cliente"("codigo") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Despacho" ADD CONSTRAINT "Despacho_creadoPorId_fkey" FOREIGN KEY ("creadoPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Despacho" ADD CONSTRAINT "Despacho_vehiculoId_fkey" FOREIGN KEY ("vehiculoId") REFERENCES "Vehiculo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DespachoItem" ADD CONSTRAINT "DespachoItem_despachoId_fkey" FOREIGN KEY ("despachoId") REFERENCES "Despacho"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DespachoItem" ADD CONSTRAINT "DespachoItem_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "Producto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DespachoAprobacion" ADD CONSTRAINT "DespachoAprobacion_despachoId_fkey" FOREIGN KEY ("despachoId") REFERENCES "Despacho"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DespachoAprobacion" ADD CONSTRAINT "DespachoAprobacion_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RutaPunto" ADD CONSTRAINT "RutaPunto_despachoId_fkey" FOREIGN KEY ("despachoId") REFERENCES "Despacho"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
