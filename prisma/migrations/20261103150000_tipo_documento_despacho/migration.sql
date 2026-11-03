-- AlterTable
ALTER TABLE "Despacho" ADD COLUMN     "tipoDocumento" TEXT;

-- Los despachos que ya existen toman el tipo de las ventas cargadas: mismo
-- numero de documento, misma empresa y mismo cliente (el numero solo no
-- alcanza, porque una factura y una nota de entrega pueden compartirlo).
-- Si no aparece en ventas o aparece con los dos tipos, queda sin tipo.
UPDATE "Despacho" d
SET "tipoDocumento" = t."tipo"
FROM (
  SELECT d2."id", MIN(v."codTipoDoc") AS "tipo"
  FROM "Despacho" d2
  JOIN "Cliente" c ON c."id" = d2."destinoClienteId"
  JOIN "Venta" v
    ON v."empresa" = c."empresa"
   AND v."numDoc" = d2."numeroDocumento"
   AND ltrim(v."codigoCliente", '0') = ltrim(c."codigo", '0')
   AND v."codTipoDoc" IN ('FA', 'NE')
  GROUP BY d2."id"
  HAVING COUNT(DISTINCT v."codTipoDoc") = 1
) t
WHERE d."id" = t."id";
