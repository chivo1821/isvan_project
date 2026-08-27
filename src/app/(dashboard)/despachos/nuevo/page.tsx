import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { NuevoDespachoWizard } from "@/components/modules/despachos/nuevo-despacho-wizard";
import { getAlmacenesRaw, getClientesRaw } from "@/lib/mock-data";
import { getUsuarioActual } from "@/lib/session";

export default async function NuevoDespachoPage() {
  const [clientes, almacenes, usuarioActual] = await Promise.all([
    getClientesRaw(),
    getAlmacenesRaw(),
    getUsuarioActual(),
  ]);
  if (!usuarioActual) redirect("/login");
  const origen = almacenes[0];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Nuevo despacho"
        subtitle="Importa el Excel del día (ISVAN o TRALOG) o carga un pedido suelto a mano"
      />
      <NuevoDespachoWizard clientes={clientes} origen={origen} creadoPorId={usuarioActual.id} />
    </div>
  );
}
