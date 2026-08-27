import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { NuevaRutaWizard } from "@/components/modules/rutas/nueva-ruta-wizard";
import { getClientesRaw, getDespachosDisponiblesParaRutaRaw } from "@/lib/mock-data";
import { getUsuarioActual } from "@/lib/session";

export default async function NuevaRutaPage() {
  const [despachos, clientes, usuarioActual] = await Promise.all([
    getDespachosDisponiblesParaRutaRaw(),
    getClientesRaw(),
    getUsuarioActual(),
  ]);
  if (!usuarioActual) redirect("/login");

  const despachosConCliente = despachos.map((d) => ({
    ...d,
    destinoCliente: clientes.find((c) => c.id === d.destinoClienteId)!,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Nueva ruta"
        subtitle="Agrupa varios despachos aprobados en el viaje de un vehículo — el orden de las paradas se calcula desde Almacén Catia"
      />
      <NuevaRutaWizard despachos={despachosConCliente} creadoPorId={usuarioActual.id} />
    </div>
  );
}
