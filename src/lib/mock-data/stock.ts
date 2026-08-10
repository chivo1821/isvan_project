// Trae el stock real desde la API (ver backend/app/api/productos.py).
import { apiGet } from "@/lib/api-client";
import type { StockAlmacen } from "./types";

export async function getStockRaw(): Promise<StockAlmacen[]> {
  return apiGet<StockAlmacen[]>("/stock");
}
