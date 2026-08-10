// Trae los clientes reales desde la API (ver backend/app/api/clientes.py).
import { apiGet } from "@/lib/api-client";
import type { Cliente } from "./types";

export async function getClientesRaw(): Promise<Cliente[]> {
  return apiGet<Cliente[]>("/clientes");
}
