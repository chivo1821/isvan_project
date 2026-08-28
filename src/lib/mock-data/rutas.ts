// Trae las rutas reales desde la API (ver backend/app/api/rutas.py). Cada
// ruta ya viene con sus "despachos" (con items) y "puntos" anidados.
import { apiGet } from "@/lib/api-client";
import type { Ruta } from "./types";

/** Listado: cada ruta trae solo su último punto (posición actual), no el
 * trazado completo — para eso está getRutaRaw(id). */
export async function getRutasRaw(): Promise<Ruta[]> {
  return apiGet<Ruta[]>("/rutas");
}

/** Detalle de una ruta, con la geometría completa del trazado. */
export async function getRutaRaw(id: string): Promise<Ruta> {
  return apiGet<Ruta>(`/rutas/${id}`);
}
