-- AlterTable
ALTER TABLE "Sesion" ADD COLUMN     "dispositivo" TEXT,
ADD COLUMN     "origen" TEXT NOT NULL DEFAULT 'WEB',
ADD COLUMN     "ultimoUsoEn" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Jornada" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "vehiculoId" TEXT,
    "iniciadaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "terminadaEn" TIMESTAMP(3),
    "cierre" TEXT,

    CONSTRAINT "Jornada_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Posicion" (
    "id" BIGSERIAL NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "jornadaId" TEXT NOT NULL,
    "rutaId" TEXT,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "precisionM" DOUBLE PRECISION,
    "velocidad" DOUBLE PRECISION,
    "rumbo" DOUBLE PRECISION,
    "bateria" DOUBLE PRECISION,
    "tomadaEn" TIMESTAMP(3) NOT NULL,
    "tomadaTelefonoMs" BIGINT NOT NULL,
    "recibidaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Posicion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UltimaPosicion" (
    "usuarioId" TEXT NOT NULL,
    "jornadaId" TEXT NOT NULL,
    "rutaId" TEXT,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "precisionM" DOUBLE PRECISION,
    "velocidad" DOUBLE PRECISION,
    "rumbo" DOUBLE PRECISION,
    "bateria" DOUBLE PRECISION,
    "tomadaEn" TIMESTAMP(3) NOT NULL,
    "recibidaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UltimaPosicion_pkey" PRIMARY KEY ("usuarioId")
);

-- CreateIndex
CREATE INDEX "Jornada_usuarioId_iniciadaEn_idx" ON "Jornada"("usuarioId", "iniciadaEn");

-- CreateIndex
CREATE INDEX "Posicion_jornadaId_tomadaEn_idx" ON "Posicion"("jornadaId", "tomadaEn");

-- CreateIndex
CREATE INDEX "Posicion_rutaId_tomadaEn_idx" ON "Posicion"("rutaId", "tomadaEn");

-- CreateIndex
CREATE UNIQUE INDEX "Posicion_usuarioId_tomadaTelefonoMs_key" ON "Posicion"("usuarioId", "tomadaTelefonoMs");

-- AddForeignKey
ALTER TABLE "Jornada" ADD CONSTRAINT "Jornada_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Posicion" ADD CONSTRAINT "Posicion_jornadaId_fkey" FOREIGN KEY ("jornadaId") REFERENCES "Jornada"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UltimaPosicion" ADD CONSTRAINT "UltimaPosicion_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;
