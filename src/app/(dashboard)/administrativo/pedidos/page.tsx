import { PageHeader } from "@/components/layout/page-header";
import { AvisoTasa, ModuloApagado, SelectorEmpresa } from "@/components/modules/administrativo/comunes";
import { NuevoPedido, PedidosTabla } from "@/components/modules/administrativo/pedidos";
import { apiGet } from "@/lib/api-client";
import {
  empresaElegida,
  type EmpresaFiscal,
  type EstadoTasa,
  type PedidoResumen,
  type Producto,
  type SearchParams,
} from "@/lib/administrativo";

export default async function PedidosPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const empresas = await apiGet<EmpresaFiscal[]>("/empresas");
  const empresa = empresaElegida(empresas, await searchParams);
  if (!empresa) return null;
  const encabezado = (
    <PageHeader
      title="Pedidos"
      subtitle="Pedidos de los clientes: al confirmarlos se revisa el crédito y se reserva la mercancía; al facturarlos sale la factura o la nota de entrega."
      actions={<SelectorEmpresa empresas={empresas} actual={empresa.id} />}
    />
  );
  if (!empresa.modulos.ventas) {
    return <div className="space-y-6">{encabezado}<ModuloApagado modulo="ventas" empresa={empresa} /></div>;
  }
  const [pedidos, almacenes, productos, tasa] = await Promise.all([
    apiGet<PedidoResumen[]>(`/ventas/pedidos?empresaId=${empresa.id}`),
    apiGet<{ id: string; nombre: string }[]>("/almacenes"),
    apiGet<Producto[]>(`/catalogo/productos?empresaId=${empresa.id}&soloActivos=true`),
    apiGet<EstadoTasa>("/tasa/estado"),
  ]);
  return (
    <div className="space-y-6">
      {encabezado}
      <AvisoTasa tasa={tasa} />
      <NuevoPedido empresaId={empresa.id} almacenes={almacenes} productos={productos} />
      <PedidosTabla pedidos={pedidos} />
    </div>
  );
}
