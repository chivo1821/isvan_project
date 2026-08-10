import { PageHeader } from "@/components/layout/page-header";
import { NuevaVentaForm } from "@/components/modules/ventas/nueva-venta-form";
import { getClientesRaw, getFacturasRaw, getProductosRaw, getUsuarioActualRaw } from "@/lib/mock-data";

export default async function NuevaVentaPage() {
  const [clientes, productos, facturas, usuarioActual] = await Promise.all([
    getClientesRaw(),
    getProductosRaw(),
    getFacturasRaw(),
    getUsuarioActualRaw(),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Nueva venta"
        subtitle="Registra una venta y el sistema evaluará si el cliente puede pasar directo a despacho"
      />
      <div className="max-w-3xl">
        <NuevaVentaForm clientes={clientes} productos={productos} facturas={facturas} vendedorId={usuarioActual.id} />
      </div>
    </div>
  );
}
