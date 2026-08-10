// Trae los productos reales desde la API (ver backend/app/api/productos.py).
// El array estatico que vivia aca se sembro en Postgres — ver
// backend/app/seed_data.json (generado por scripts/export-mock-data.ts).
import { apiGet } from "@/lib/api-client";
import type { Producto } from "./types";

export async function getProductosRaw(): Promise<Producto[]> {
  return apiGet<Producto[]>("/productos");
}
