// Trae los despachos reales desde la API (ver backend/app/api/despachos.py).
// Cada despacho ya viene con sus "items" anidados (misma forma que el mock).
import { apiGet } from "@/lib/api-client";
import type { Despacho, DespachoAprobacion } from "./types";

export async function getDespachosRaw(): Promise<Despacho[]> {
  return apiGet<Despacho[]>("/despachos");
}

// Despachos ya aprobados y sin ruta asignada todavía — el set del que se
// arma una nueva ruta multi-parada (ver /rutas/nueva).
export async function getDespachosDisponiblesParaRutaRaw(): Promise<Despacho[]> {
  return apiGet<Despacho[]>("/despachos/disponibles-para-ruta");
}

export async function getDespachoAprobacionesRaw(): Promise<DespachoAprobacion[]> {
  return apiGet<DespachoAprobacion[]>("/despacho-aprobaciones");
}
