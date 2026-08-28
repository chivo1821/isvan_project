import { PageHeader } from "@/components/layout/page-header";
import { ClientesTable } from "@/components/modules/clientes/clientes-table";
import { getClientesRaw } from "@/lib/mock-data";
import { getUsuarioActual } from "@/lib/session";

export default async function ClientesPage() {
  const [clientes, usuarioActual] = await Promise.all([getClientesRaw(), getUsuarioActual()]);
  const puedeCrear = usuarioActual?.rol === "ADMIN" || usuarioActual?.rol === "DESPACHOS";
  return (
    <div className="space-y-6">
      <PageHeader
        title="Clientes"
        subtitle="Cartera de clientes de ISVAN y TRALOG"
        helpText="El mismo código puede pertenecer a un cliente distinto según la empresa — por eso cada cliente muestra su empresa junto al código. Se necesitan coordenadas para poder incluir a un cliente en una ruta."
      />
      <ClientesTable clientes={clientes} puedeCrear={puedeCrear} />
    </div>
  );
}
