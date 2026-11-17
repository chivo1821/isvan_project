// Trae las rutas reales desde la API (ver backend/app/api/rutas.py). Cada
// ruta ya viene con sus "despachos" (con items) y "puntos" anidados.
import { apiGet } from "@/lib/api-client";
import type { Ruta, RutasConRelaciones } from "./types";

/** Listado: cada ruta trae solo su último punto (posición actual), no el
 * trazado completo — para eso está getRutaRaw(id). */
export async function getRutasRaw(): Promise<Ruta[]> {
  return apiGet<Ruta[]>("/rutas");
}

/** Detalle de una ruta, con la geometría completa del trazado. */
export async function getRutaRaw(id: string): Promise<Ruta> {
  return apiGet<Ruta>(`/rutas/${id}`);
}

/** Las rutas activas con solo las relaciones que usan, en una sola llamada
 * (la API ya las filtra por estado y por rol). Es lo que usan el dashboard,
 * Seguimiento y el Despachador. */
export async function getRutasActivasConRelacionesRaw(): Promise<RutasConRelaciones> {
  return apiGet<RutasConRelaciones>("/rutas/activas/con-relaciones");
}

/** Una ruta (trazado completo) con solo las relaciones que usa, en una sola
 * llamada. Es lo que usan las páginas de detalle. */
export async function getRutaConRelacionesRaw(id: string): Promise<RutasConRelaciones> {
  return apiGet<RutasConRelaciones>(`/rutas/${id}/con-relaciones`);
}
