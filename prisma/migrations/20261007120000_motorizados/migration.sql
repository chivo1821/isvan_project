-- Motorizados autogestionados: se registran solos con nombre, placa,
-- telefono y un PIN, y entran con placa + PIN (sin correo). Ver
-- backend/app/services/motorizados.py.

-- El correo deja de ser obligatorio (solo para los motorizados; la unicidad
-- se mantiene: Postgres admite varios NULL en un indice unico).
ALTER TABLE "Usuario" ALTER COLUMN "email" DROP NOT NULL;

ALTER TABLE "Usuario" ADD COLUMN "autogestionado" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Usuario" ADD COLUMN "telefono" TEXT;
ALTER TABLE "Usuario" ADD COLUMN "pinHash" TEXT;
ALTER TABLE "Usuario" ADD COLUMN "intentosFallidos" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Usuario" ADD COLUMN "bloqueadoHasta" TIMESTAMP(3);
