import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { NuevaRutaWizard } from "@/components/modules/rutas/nueva-ruta-wizard";
import { getAlmacenById, getClientesRaw, getDespachosDisponiblesParaRutaRaw } from "@/lib/mock-data";
import { proximaHoraEnPunto } from "@/lib/planificacion";
import { getUsuarioActual } from "@/lib/session";

// De donde salen las rutas (ALMACEN_BASE_ID en backend/app/api/rutas.py).
const ALMACEN_BASE_ID = "alm-catia";

export default async function NuevaRutaPage() {
  const [despachos, clientes, usuarioActual, almacen] = await Promise.all([
    getDespachosDisponiblesParaRutaRaw(),
    getClientesRaw(),
    getUsuarioActual(),
    getAlmacenById(ALMACEN_BASE_ID),
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
      <NuevaRutaWizard
        despachos={despachosConCliente}
        salidaInicial={proximaHoraEnPunto()}
        almacen={almacen ?? null}
      />
    </div>
  );
}
