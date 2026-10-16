// Sesión del portal de clientes desde Server Components (layout y páginas
// de /portal). La cookie es otra (portal_sesion, ver
// backend/app/core/portal_auth.py), pero apiGet la reenvía igual: manda
// todas las cookies de la request.
import { cache } from "react";
import { apiGet } from "@/lib/api-client";
import type { Empresa, EstadoCuentaPortal } from "@/lib/cobranzas";

export type CuentaPortal = {
  id: string;
  email: string;
  nombre: string;
  rif: string;
  telefono: string | null;
  estado: EstadoCuentaPortal;
  clientes: { empresa: Empresa; codigoCliente: string; nombre: string }[];
};

/** Una sola llamada a /portal/me por request, aunque la pidan el layout y la
 * página (React.cache). null si no hay sesión válida. */
export const getCuentaPortal = cache(async (): Promise<CuentaPortal | null> => {
  try {
    return await apiGet<CuentaPortal>("/portal/me");
  } catch {
    return null;
  }
});

/** La cuenta solo si ya puede ver datos (activa y vinculada). Las páginas
 * del portal no consultan nada sin esto: una cuenta en validación recibiría
 * 403 de la API. */
export async function getCuentaActiva(): Promise<CuentaPortal | null> {
  const cuenta = await getCuentaPortal();
  return cuenta && cuenta.estado === "ACTIVA" && cuenta.clientes.length > 0 ? cuenta : null;
}
