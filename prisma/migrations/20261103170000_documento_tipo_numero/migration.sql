-- El numero de documento se puede repetir con otro tipo (FA 1000 y NE 1000
-- son papeles distintos): la llave pasa a ser numero + tipo.

-- DropIndex
DROP INDEX "Despacho_numeroDocumento_key";

-- CreateIndex
CREATE UNIQUE INDEX "Despacho_numeroDocumento_tipoDocumento_key" ON "Despacho"("numeroDocumento", "tipoDocumento");
