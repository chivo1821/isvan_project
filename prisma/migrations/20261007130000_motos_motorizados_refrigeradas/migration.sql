-- Las motos de los motorizados autogestionados llevan el bolso termico de la
-- empresa: tienen refrigeracion. Se crearon sin ella y el planificador las
-- descartaba (todo lo que se reparte requiere frio). Solo datos, sin
-- cambios de esquema.
UPDATE "Vehiculo" SET "tieneRefrigeracion" = true
WHERE "id" IN (
  SELECT "vehiculoAsignadoId" FROM "Usuario"
  WHERE "autogestionado" AND "vehiculoAsignadoId" IS NOT NULL
);
