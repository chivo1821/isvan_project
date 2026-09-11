import { MapIcon } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { DespachosVendedorLista } from "@/components/modules/vendedor/despachos-vendedor";
import { Card, CardContent } from "@/components/ui/card";
import { apiGet } from "@/lib/api-client";
import { rutasComoTexto, type DespachosVendedor } from "@/lib/vendedor";

export default async function MisDespachosPage() {
  const { rutas, despachos } = await apiGet<DespachosVendedor>("/vendedor/despachos");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Mis despachos"
        subtitle={
          rutas.length > 0
            ? `Rutas ${rutasComoTexto(rutas)} · últimos 30 días y todo lo que sigue abierto`
            : "Los despachos de los clientes de tus rutas"
        }
      />
      {rutas.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center text-sm text-muted-foreground">
            <MapIcon className="size-8" />
            Todavía no tienes rutas de venta asignadas. Pídele a un administrador que te las asigne para ver los
            despachos de tus clientes.
          </CardContent>
        </Card>
      ) : (
        <DespachosVendedorLista despachos={despachos} />
      )}
    </div>
  );
}
