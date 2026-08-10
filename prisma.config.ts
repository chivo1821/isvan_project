import "dotenv/config";
import { defineConfig, env } from "prisma/config";

// Prisma 7 ya no acepta "url" dentro de datasource en schema.prisma — la
// conexion real se configura aca. DATABASE_URL viene de .env (ver
// .env.example). Sin un .env con DATABASE_URL definido, "prisma generate"
// sigue funcionando (no necesita conexion), pero "migrate"/"db push"/correr
// el PrismaClient si la necesitan.
export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: env("DATABASE_URL"),
  },
});
