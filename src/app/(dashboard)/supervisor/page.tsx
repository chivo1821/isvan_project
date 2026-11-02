import { PageHeader } from "@/components/layout/page-header";
import { RendimientoVendedoresCard } from "@/components/modules/dashboard/rendimiento-vendedores";
import { apiGet } from "@/lib/api-client";
import type { RendimientoVendedores } from "@/lib/vendedor";

/** Inicio del SUPERVISOR de los vendedores: la misma tarjeta de
 * rendimiento y mapa de visitas que ve el ADMIN en el resumen, sin la
 * operación ni las cifras de venta del negocio. La otra pantalla del
 * supervisor es el censo (ver MODULOS_POR_ROL en src/lib/constants.ts). */
export default async function SupervisorPage() {
  const rendimiento = await apiGet<RendimientoVendedores>("/vendedor/rendimiento");
  return (
    <div className="space-y-6">
      <PageHeader
        title="Vendedores"
        subtitle="Las visitas de cada vendedor: a cuántos de sus clientes atendió, cuánto tarda y dónde estuvo."
      />
      <RendimientoVendedoresCard rendimiento={rendimiento} />
    </div>
  );
}
