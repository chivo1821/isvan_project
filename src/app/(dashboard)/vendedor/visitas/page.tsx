import { MapIcon } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { VisitasVendedor } from "@/components/modules/vendedor/visitas-vendedor";
import { Card, CardContent } from "@/components/ui/card";
import { apiGet } from "@/lib/api-client";
import { formatDate } from "@/lib/constants";
import { rutasComoTexto, type VisitasSemana } from "@/lib/vendedor";

export default async function VisitasPage() {
  const datos = await apiGet<VisitasSemana>("/vendedor/visitas/semana");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Visitas"
        subtitle={`Semana del ${formatDate(datos.semana)}${
          datos.rutas.length > 0 ? ` · rutas ${rutasComoTexto(datos.rutas)}` : ""
        } · cada lunes todos tus clientes vuelven a «Por visitar»`}
        helpText="Al empezar una visita se toma la ubicación del teléfono una sola vez; al terminarla se guardan la hora de salida y tus observaciones."
      />
      {datos.rutas.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center text-sm text-muted-foreground">
            <MapIcon className="size-8" />
            Todavía no tienes rutas de venta asignadas. Pídele a un administrador que te las asigne para ver a tus
            clientes.
          </CardContent>
        </Card>
      ) : (
        <VisitasVendedor inicial={datos} />
      )}
    </div>
  );
}
