import { PageHeader } from "@/components/layout/page-header";
import { DescargarReporteButton } from "@/components/shared/descargar-reporte-button";
import { ClientesTable } from "@/components/modules/clientes/clientes-table";
import { getClientesRaw } from "@/lib/mock-data";
import { getUsuarioActual } from "@/lib/session";

export default async function ClientesPage() {
  const [clientes, usuarioActual] = await Promise.all([getClientesRaw(), getUsuarioActual()]);
  const puedeCrear = usuarioActual?.rol === "ADMIN" || usuarioActual?.rol === "DESPACHOS";
  // Los reportes son información de gestión: el repartidor no los descarga
  // (la API también se lo niega, ver backend/app/api/reportes.py).
  const puedeDescargar = usuarioActual != null && usuarioActual.rol !== "REPARTIDOR";
  return (
    <div className="space-y-6">
      <PageHeader
        title="Clientes"
        subtitle="Cartera de clientes de ISVAN y TRALOG"
        helpText="El mismo código puede pertenecer a un cliente distinto según la empresa — por eso cada cliente muestra su empresa junto al código. Se necesitan coordenadas para poder incluir a un cliente en una ruta."
        actions={puedeDescargar ? <DescargarReporteButton reporte="clientes" /> : undefined}
      />
      <ClientesTable clientes={clientes} puedeCrear={puedeCrear} />
    </div>
  );
}
