// Trae las ventas reales desde la API (ver backend/app/api/ventas.py). Cada
// venta ya viene con sus "items" anidados (misma forma que el mock).
import { apiGet } from "@/lib/api-client";
import type { Venta, VentaRevision } from "./types";

export async function getVentasRaw(): Promise<Venta[]> {
  return apiGet<Venta[]>("/ventas");
}

export async function getVentaRevisionesRaw(): Promise<VentaRevision[]> {
  return apiGet<VentaRevision[]>("/venta-revisiones");
}
