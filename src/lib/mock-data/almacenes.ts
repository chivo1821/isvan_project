// Trae los almacenes reales desde la API (ver backend/app/api/almacenes.py).
import { apiGet } from "@/lib/api-client";
import type { Almacen } from "./types";

export async function getAlmacenesRaw(): Promise<Almacen[]> {
  return apiGet<Almacen[]>("/almacenes");
}
