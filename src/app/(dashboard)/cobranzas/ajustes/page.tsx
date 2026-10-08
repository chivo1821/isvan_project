import { PageHeader } from "@/components/layout/page-header";
import { AjustesCartera, CuentasEmpresa, TasasBcv } from "@/components/modules/cobranzas/ajustes-cobranza";
import { apiGet } from "@/lib/api-client";
import type { AjustesCobranza, CuentaEmpresa, TasaBcv } from "@/lib/cobranzas";
import { getUsuarioActual } from "@/lib/session";

export default async function CobranzasAjustesPage() {
  const [ajustes, tasas, cuentas, usuario] = await Promise.all([
    apiGet<AjustesCobranza>("/cobranzas/ajustes"),
    apiGet<TasaBcv[]>("/cobranzas/tasas"),
    apiGet<CuentaEmpresa[]>("/cobranzas/cuentas-empresa"),
    getUsuarioActual(),
  ]);
  const esAdmin = usuario?.rol === "ADMIN";

  return (
    <div className="space-y-6">
      <PageHeader title="Ajustes de cobranzas" subtitle="Cuándo se bloquea un cliente, la tasa BCV y dónde pagan los clientes." />
      <AjustesCartera ajustes={ajustes} editable={esAdmin} />
      <TasasBcv tasas={tasas} />
      <CuentasEmpresa cuentas={cuentas} editable={esAdmin} />
    </div>
  );
}
