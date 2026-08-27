// Trae las rutas reales desde la API (ver backend/app/api/rutas.py). Cada
// ruta ya viene con sus "despachos" (con items) y "puntos" anidados.
import { apiGet } from "@/lib/api-client";
import type { Ruta } from "./types";

export async function getRutasRaw(): Promise<Ruta[]> {
  return apiGet<Ruta[]>("/rutas");
}
