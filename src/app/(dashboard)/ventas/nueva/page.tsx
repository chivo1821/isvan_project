import { PageHeader } from "@/components/layout/page-header";
import { NuevaVentaForm } from "@/components/modules/ventas/nueva-venta-form";

export default function NuevaVentaPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Nueva venta"
        subtitle="Registra una venta y el sistema evaluará si el cliente puede pasar directo a despacho"
      />
      <div className="max-w-3xl">
        <NuevaVentaForm />
      </div>
    </div>
  );
}
