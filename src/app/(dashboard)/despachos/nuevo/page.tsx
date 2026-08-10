import { PageHeader } from "@/components/layout/page-header";
import { NuevoDespachoWizard } from "@/components/modules/despachos/nuevo-despacho-wizard";
import { getAlmacenesRaw, getUsuarioActualRaw, getVentasAprobadasSinDespacho } from "@/lib/mock-data";

export default async function NuevoDespachoPage() {
  const [ventasElegibles, almacenes, usuarioActual] = await Promise.all([
    getVentasAprobadasSinDespacho(),
    getAlmacenesRaw(),
    getUsuarioActualRaw(),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Nuevo despacho"
        subtitle="Genera un despacho a partir de una venta aprobada: el destino y los productos se toman de la venta"
      />
      <NuevoDespachoWizard ventasElegibles={ventasElegibles} origen={almacenes[0]} creadoPorId={usuarioActual.id} />
    </div>
  );
}
