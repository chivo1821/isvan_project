// Trae los puntos de ruta reales desde la API (ver backend/app/api/historial.py).
import { apiGet } from "@/lib/api-client";
import type { RutaPunto } from "./types";

export async function getRutaPuntosRaw(): Promise<RutaPunto[]> {
  return apiGet<RutaPunto[]>("/ruta-puntos");
}
