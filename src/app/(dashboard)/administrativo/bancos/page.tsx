import { PageHeader } from "@/components/layout/page-header";
import { AvisoTasa, ModuloApagado, SelectorEmpresa } from "@/components/modules/administrativo/comunes";
import { BancosModulo } from "@/components/modules/administrativo/bancos";
import { apiGet } from "@/lib/api-client";
import {
  empresaElegida,
  type EmpresaFiscal,
  type EstadoTasa,
  type ResumenBancos,
  type SearchParams,
} from "@/lib/administrativo";

export default async function BancosPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const [empresas, tasa] = await Promise.all([
    apiGet<EmpresaFiscal[]>("/empresas"),
    apiGet<EstadoTasa>("/tasa/estado").catch(() => null),
  ]);
  const empresa = empresaElegida(empresas, await searchParams);
  if (!empresa) return null;

  const encabezado = (
    <PageHeader
      title="Bancos y caja"
      subtitle="Disponible consolidado en USD y Bs, flujo de caja, transferencias entre cuentas y conciliación de estados de cuenta."
      actions={<SelectorEmpresa empresas={empresas} actual={empresa.id} />}
    />
  );

  if (!empresa.modulos.bancos) {
    return (
      <div className="space-y-6">
        {encabezado}
        <ModuloApagado modulo="bancos" empresa={empresa} />
      </div>
    );
  }

  const resumen = await apiGet<ResumenBancos>(`/bancos/resumen?empresaId=${empresa.id}`).catch(() => null);

  return (
    <div className="space-y-6">
      {encabezado}
      {tasa && <AvisoTasa tasa={tasa} />}
      <BancosModulo empresaId={empresa.id} initialResumen={resumen} tasa={tasa} />
    </div>
  );
}
