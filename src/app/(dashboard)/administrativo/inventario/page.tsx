import { PageHeader } from "@/components/layout/page-header";
import { ModuloApagado, SelectorEmpresa } from "@/components/modules/administrativo/comunes";
import { AjustesTabla, ConteoExcel, ExistenciasTabla, NuevoAjuste } from "@/components/modules/administrativo/inventario";
import { apiGet } from "@/lib/api-client";
import { empresaElegida, type Ajuste, type EmpresaFiscal, type Existencia, type SearchParams } from "@/lib/administrativo";

export default async function InventarioPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const empresas = await apiGet<EmpresaFiscal[]>("/empresas");
  const empresa = empresaElegida(empresas, await searchParams);
  if (!empresa) return null;
  const encabezado = (
    <PageHeader
      title="Inventario"
      subtitle="Existencias por almacén y lote. Las ventas sacan primero lo que vence primero; los ajustes los aprueba otra persona."
      actions={<SelectorEmpresa empresas={empresas} actual={empresa.id} />}
    />
  );
  if (!empresa.modulos.inventario) {
    return <div className="space-y-6">{encabezado}<ModuloApagado modulo="inventario" empresa={empresa} /></div>;
  }
  const [existencias, ajustes, almacenes] = await Promise.all([
    apiGet<Existencia[]>(`/inventario/existencias?empresaId=${empresa.id}`),
    apiGet<Ajuste[]>(`/inventario/ajustes?empresaId=${empresa.id}`),
    apiGet<{ id: string; nombre: string }[]>("/almacenes"),
  ]);
  return (
    <div className="space-y-6">
      {encabezado}
      <ConteoExcel empresaId={empresa.id} almacenes={almacenes} />
      <div className="flex justify-end"><NuevoAjuste empresaId={empresa.id} almacenes={almacenes} existencias={existencias} /></div>
      <AjustesTabla ajustes={ajustes} existencias={existencias} />
      <ExistenciasTabla existencias={existencias} almacenes={almacenes} />
    </div>
  );
}
