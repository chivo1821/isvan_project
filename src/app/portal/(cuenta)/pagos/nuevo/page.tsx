import { ReportarPagoWizard } from "@/components/modules/portal/reportar-pago-wizard";
import { apiGet } from "@/lib/api-client";
import type { CuentaEmpresa, Documento } from "@/lib/cobranzas";
import { getCuentaActiva } from "@/lib/portal";

export default async function ReportarPagoPage() {
  const cuenta = await getCuentaActiva();
  if (!cuenta) return null;
  const [pendientes, cuentasEmpresa] = await Promise.all([
    apiGet<Documento[]>("/portal/documentos?estado=pendientes"),
    apiGet<CuentaEmpresa[]>("/portal/cuentas-empresa"),
  ]);

  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold">Reportar un pago</h1>
        <p className="text-sm text-muted-foreground">
          Pago móvil o transferencia en bolívares. Lo convertimos a dólares con la última tasa BCV publicada.
        </p>
      </div>
      <ReportarPagoWizard clientes={cuenta.clientes} pendientes={pendientes} cuentasEmpresa={cuentasEmpresa} />
    </>
  );
}
