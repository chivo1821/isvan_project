import { defineConfig } from "prisma/config";

// Fase 1 (solo UI): este archivo solo declara donde vive el schema para que
// "npx prisma generate" pueda tipar los datos mock. La URL real de conexion
// (DATABASE_URL) y el resto de la configuracion de Migrate/Client se conectan
// en Fase 2, cuando exista una base de datos PostgreSQL real.
export default defineConfig({
  schema: "prisma/schema.prisma",
});
