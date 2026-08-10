// Trae las facturas reales desde la API (ver backend/app/api/clientes.py).
import { apiGet } from "@/lib/api-client";
import type { Factura } from "./types";

export async function getFacturasRaw(): Promise<Factura[]> {
  return apiGet<Factura[]>("/clientes/facturas");
}
