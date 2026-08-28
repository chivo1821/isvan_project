-- Cliente.telefono pasa a obligatorio (lo usan los despachadores para
-- contactar al cliente). No hace falta backfill: no hay filas con
-- telefono NULL al momento de esta migracion.
ALTER TABLE "Cliente" ALTER COLUMN "telefono" SET NOT NULL;
