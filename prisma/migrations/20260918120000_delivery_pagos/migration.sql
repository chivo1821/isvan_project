-- CreateTable
CREATE TABLE "TabuladorDelivery" (
    "id" TEXT NOT NULL,
    "orden" INTEGER NOT NULL,
    "hastaKm" DOUBLE PRECISION,
    "montoUsd" DECIMAL(10,2) NOT NULL,
    "actualizadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoPorId" TEXT,

    CONSTRAINT "TabuladorDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DistanciaCliente" (
    "id" TEXT NOT NULL,
    "almacenId" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "km" DOUBLE PRECISION NOT NULL,
    "fuente" TEXT NOT NULL,
    "calculadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DistanciaCliente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiquidacionDelivery" (
    "id" TEXT NOT NULL,
    "repartidorId" TEXT NOT NULL,
    "desde" DATE NOT NULL,
    "hasta" DATE NOT NULL,
    "entregas" INTEGER NOT NULL,
    "totalUsd" DECIMAL(12,2) NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creadoPorId" TEXT NOT NULL,
    "nota" TEXT,

    CONSTRAINT "LiquidacionDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiquidacionDeliveryParada" (
    "id" TEXT NOT NULL,
    "liquidacionId" TEXT NOT NULL,
    "rutaId" TEXT NOT NULL,
    "clienteId" TEXT NOT NULL,
    "entregadoEn" TIMESTAMP(3) NOT NULL,
    "km" DOUBLE PRECISION NOT NULL,
    "montoUsd" DECIMAL(10,2) NOT NULL,
    "rango" TEXT NOT NULL,

    CONSTRAINT "LiquidacionDeliveryParada_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TabuladorDelivery_orden_key" ON "TabuladorDelivery"("orden");

-- CreateIndex
CREATE UNIQUE INDEX "DistanciaCliente_almacenId_clienteId_key" ON "DistanciaCliente"("almacenId", "clienteId");

-- CreateIndex
CREATE INDEX "LiquidacionDelivery_repartidorId_desde_idx" ON "LiquidacionDelivery"("repartidorId", "desde");

-- CreateIndex
CREATE INDEX "LiquidacionDeliveryParada_liquidacionId_idx" ON "LiquidacionDeliveryParada"("liquidacionId");

-- CreateIndex
CREATE UNIQUE INDEX "LiquidacionDeliveryParada_rutaId_clienteId_key" ON "LiquidacionDeliveryParada"("rutaId", "clienteId");

-- AddForeignKey
ALTER TABLE "TabuladorDelivery" ADD CONSTRAINT "TabuladorDelivery_actualizadoPorId_fkey" FOREIGN KEY ("actualizadoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DistanciaCliente" ADD CONSTRAINT "DistanciaCliente_almacenId_fkey" FOREIGN KEY ("almacenId") REFERENCES "Almacen"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DistanciaCliente" ADD CONSTRAINT "DistanciaCliente_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiquidacionDelivery" ADD CONSTRAINT "LiquidacionDelivery_repartidorId_fkey" FOREIGN KEY ("repartidorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiquidacionDelivery" ADD CONSTRAINT "LiquidacionDelivery_creadoPorId_fkey" FOREIGN KEY ("creadoPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiquidacionDeliveryParada" ADD CONSTRAINT "LiquidacionDeliveryParada_liquidacionId_fkey" FOREIGN KEY ("liquidacionId") REFERENCES "LiquidacionDelivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiquidacionDeliveryParada" ADD CONSTRAINT "LiquidacionDeliveryParada_rutaId_fkey" FOREIGN KEY ("rutaId") REFERENCES "Ruta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiquidacionDeliveryParada" ADD CONSTRAINT "LiquidacionDeliveryParada_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Tabulador inicial (el que usa el cliente). Los rangos del papel dejaban
-- huecos entre 10-11, 16-17 y 20-20,1 km: aca cada rango llega hasta el
-- tope del siguiente y el ultimo va sin tope.
INSERT INTO "TabuladorDelivery" ("id", "orden", "hastaKm", "montoUsd") VALUES
  ('tabdel-0001', 1, 10, 2),
  ('tabdel-0002', 2, 16, 3),
  ('tabdel-0003', 3, 20, 4),
  ('tabdel-0004', 4, 25, 5),
  ('tabdel-0005', 5, 30, 7),
  ('tabdel-0006', 6, 35, 9),
  ('tabdel-0007', 7, NULL, 10);
