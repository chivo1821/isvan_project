// Sesion real (ver backend/app/core/auth.py, GET /auth/me) — reemplaza al
// viejo getUsuarioActualRaw() fijo. Usar desde Server Components: layouts y
// paginas que necesiten saber quien esta autenticado y con qué rol.
import { apiGet } from "@/lib/api-client";
import type { Usuario } from "@/lib/mock-data/types";

export async function getUsuarioActual(): Promise<Usuario | null> {
  try {
    return await apiGet<Usuario>("/auth/me");
  } catch {
    return null;
  }
}
