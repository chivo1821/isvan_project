-- CreateTable
CREATE TABLE "MetaLitros" (
    "id" TEXT NOT NULL,
    "empresa" "Empresa" NOT NULL,
    "ruta" TEXT NOT NULL,
    "mes" DATE NOT NULL,
    "litros" DECIMAL(14,2) NOT NULL,
    "actualizadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoPorId" TEXT,

    CONSTRAINT "MetaLitros_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiaFeriado" (
    "fecha" DATE NOT NULL,
    "nombre" TEXT NOT NULL,

    CONSTRAINT "DiaFeriado_pkey" PRIMARY KEY ("fecha")
);

-- CreateIndex
CREATE INDEX "MetaLitros_empresa_mes_idx" ON "MetaLitros"("empresa", "mes");

-- CreateIndex
CREATE UNIQUE INDEX "MetaLitros_empresa_ruta_mes_key" ON "MetaLitros"("empresa", "ruta", "mes");

-- AddForeignKey
ALTER TABLE "MetaLitros" ADD CONSTRAINT "MetaLitros_actualizadoPorId_fkey" FOREIGN KEY ("actualizadoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Feriados nacionales de Venezuela (LOTTT, art. 184) de 2026 y 2027, para
-- arrancar. Carnaval y Semana Santa cambian cada ano; los que caen en fin de
-- semana igual se cargan (no restan dias de venta). Se editan desde el cuadro.
INSERT INTO "DiaFeriado" ("fecha", "nombre") VALUES
  ('2026-01-01', 'Año Nuevo'),
  ('2026-02-16', 'Carnaval'),
  ('2026-02-17', 'Carnaval'),
  ('2026-04-02', 'Jueves Santo'),
  ('2026-04-03', 'Viernes Santo'),
  ('2026-04-19', 'Declaración de la Independencia'),
  ('2026-05-01', 'Día del Trabajador'),
  ('2026-06-24', 'Batalla de Carabobo'),
  ('2026-07-05', 'Día de la Independencia'),
  ('2026-07-24', 'Natalicio de Simón Bolívar'),
  ('2026-10-12', 'Día de la Resistencia Indígena'),
  ('2026-12-24', 'Nochebuena'),
  ('2026-12-25', 'Navidad'),
  ('2026-12-31', 'Fin de Año'),
  ('2027-01-01', 'Año Nuevo'),
  ('2027-02-08', 'Carnaval'),
  ('2027-02-09', 'Carnaval'),
  ('2027-03-25', 'Jueves Santo'),
  ('2027-03-26', 'Viernes Santo'),
  ('2027-04-19', 'Declaración de la Independencia'),
  ('2027-05-01', 'Día del Trabajador'),
  ('2027-06-24', 'Batalla de Carabobo'),
  ('2027-07-05', 'Día de la Independencia'),
  ('2027-07-24', 'Natalicio de Simón Bolívar'),
  ('2027-10-12', 'Día de la Resistencia Indígena'),
  ('2027-12-24', 'Nochebuena'),
  ('2027-12-25', 'Navidad'),
  ('2027-12-31', 'Fin de Año')
ON CONFLICT ("fecha") DO NOTHING;
