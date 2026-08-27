// Trae los usuarios reales desde la API (ver backend/app/api/usuarios.py).
// El "usuario actual" ya no se adivina aquí — viene de la sesión real, ver
// src/lib/session.ts (GET /auth/me).
import { apiGet } from "@/lib/api-client";
import type { Usuario } from "./types";

export async function getUsuariosRaw(): Promise<Usuario[]> {
  return apiGet<Usuario[]>("/usuarios");
}
