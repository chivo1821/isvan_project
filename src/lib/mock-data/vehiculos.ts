// Trae los vehiculos reales desde la API (ver backend/app/api/vehiculos.py).
import { apiGet } from "@/lib/api-client";
import type { Vehiculo } from "./types";

export async function getVehiculosRaw(): Promise<Vehiculo[]> {
  return apiGet<Vehiculo[]>("/vehiculos");
}
