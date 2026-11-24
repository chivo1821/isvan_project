import { PageHeader } from "@/components/layout/page-header";
import { ModuloApagado, SelectorEmpresa } from "@/components/modules/administrativo/comunes";
import { InventarioModulo } from "@/components/modules/administrativo/inventario";
import { apiGet } from "@/lib/api-client";
import {
  empresaElegida,
  type Ajuste,
  type EmpresaFiscal,
  type Existencia,
  type Producto,
  type SearchParams,
} from "@/lib/administrativo";

export default async function InventarioPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const empresas = await apiGet<EmpresaFiscal[]>("/empresas");
  const empresa = empresaElegida(empresas, await searchParams);
  if (!empresa) return null;

  const encabezado = (
    <PageHeader
      title="Inventario y Costos"
      subtitle="Existencias por almacén y lote, valuación fiscal a Costo Promedio (Art. 177 RISLR), costo de reposición y presupuestario."
      actions={<SelectorEmpresa empresas={empresas} actual={empresa.id} />}
    />
  );

  if (!empresa.modulos.inventario) {
    return (
      <div className="space-y-6">
        {encabezado}
        <ModuloApagado modulo="inventario" empresa={empresa} />
      </div>
    );
  }

  const [existencias, ajustes, almacenes, productos] = await Promise.all([
    apiGet<Existencia[]>(`/inventario/existencias?empresaId=${empresa.id}`).catch(() => []),
    apiGet<Ajuste[]>(`/inventario/ajustes?empresaId=${empresa.id}`).catch(() => []),
    apiGet<{ id: string; nombre: string }[]>("/almacenes").catch(() => []),
    apiGet<Producto[]>(`/catalogo/productos?empresaId=${empresa.id}`).catch(() => []),
  ]);

  return (
    <div className="space-y-6">
      {encabezado}
      <InventarioModulo
        empresaId={empresa.id}
        existencias={existencias}
        ajustes={ajustes}
        almacenes={almacenes}
        productos={productos}
      />
    </div>
  );
}
