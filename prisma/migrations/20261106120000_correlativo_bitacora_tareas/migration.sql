-- CreateTable
CREATE TABLE "Correlativo" (
    "empresaId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "serie" TEXT NOT NULL DEFAULT '',
    "siguiente" BIGINT NOT NULL DEFAULT 1,

    CONSTRAINT "Correlativo_pkey" PRIMARY KEY ("empresaId","tipo","serie")
);

-- CreateTable
CREATE TABLE "Bitacora" (
    "id" BIGSERIAL NOT NULL,
    "organizacionId" TEXT NOT NULL DEFAULT 'org-principal',
    "fecha" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usuarioId" TEXT,
    "entidad" TEXT NOT NULL,
    "entidadId" TEXT NOT NULL,
    "accion" TEXT NOT NULL,
    "antes" JSONB,
    "despues" JSONB,

    CONSTRAINT "Bitacora_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tarea" (
    "id" TEXT NOT NULL,
    "organizacionId" TEXT NOT NULL DEFAULT 'org-principal',
    "tipo" TEXT NOT NULL,
    "datos" JSONB NOT NULL,
    "claveUnica" TEXT,
    "estado" TEXT NOT NULL DEFAULT 'PENDIENTE',
    "intentos" INTEGER NOT NULL DEFAULT 0,
    "maxIntentos" INTEGER NOT NULL DEFAULT 5,
    "ejecutarDesde" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ultimoError" TEXT,
    "creadaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "terminadaEn" TIMESTAMP(3),

    CONSTRAINT "Tarea_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Bitacora_entidad_entidadId_idx" ON "Bitacora"("entidad", "entidadId");

-- CreateIndex
CREATE INDEX "Bitacora_fecha_idx" ON "Bitacora"("fecha");

-- CreateIndex
CREATE UNIQUE INDEX "Tarea_claveUnica_key" ON "Tarea"("claveUnica");

-- CreateIndex
CREATE INDEX "Tarea_estado_ejecutarDesde_idx" ON "Tarea"("estado", "ejecutarDesde");

-- La bitacora no se edita ni se borra.
CREATE OR REPLACE FUNCTION bitacora_solo_insertar() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'La bitacora no se puede modificar ni borrar';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER bitacora_solo_insertar
    BEFORE UPDATE OR DELETE ON "Bitacora"
    FOR EACH ROW EXECUTE FUNCTION bitacora_solo_insertar();
