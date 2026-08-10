// Trae los usuarios reales desde la API (ver backend/app/api/usuarios.py).
import { apiGet } from "@/lib/api-client";
import type { Usuario } from "./types";

export async function getUsuariosRaw(): Promise<Usuario[]> {
  return apiGet<Usuario[]>("/usuarios");
}

// "Usuario actual" fijo (no hay login) — el mismo que se usaba en el mock,
// el primero de la lista sembrada (Gustavo Marquina, Administrador).
export async function getUsuarioActualRaw(): Promise<Usuario> {
  const usuarios = await getUsuariosRaw();
  const actual = usuarios.find((u) => u.email === "gustavo.marquina@heladosypizzas.com") ?? usuarios[0];
  return actual;
}
