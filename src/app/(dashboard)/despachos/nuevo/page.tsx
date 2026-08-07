import { PageHeader } from "@/components/layout/page-header";
import { NuevoDespachoWizard } from "@/components/modules/despachos/nuevo-despacho-wizard";

export default function NuevoDespachoPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Nuevo despacho"
        subtitle="Genera un despacho a partir de una venta aprobada: el destino y los productos se toman de la venta"
      />
      <NuevoDespachoWizard />
    </div>
  );
}
