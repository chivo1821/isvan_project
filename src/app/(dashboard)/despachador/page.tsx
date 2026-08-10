import Link from "next/link";
import { PackageSearchIcon } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { ESTADO_DESPACHO_META } from "@/lib/constants";
import { getDespachosConDetalle } from "@/lib/mock-data";

const ESTADOS_DESPACHADOR = ["APROBADO", "EN_TRANSITO"] as const;

export default async function DespachadorPage() {
  const despachos = (await getDespachosConDetalle()).filter((d) =>
    (ESTADOS_DESPACHADOR as readonly string[]).includes(d.estado)
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Despachador"
        subtitle="Despachos listos para salir o en camino — marca cada uno cuando salgas y cuando entregues"
      />

      {despachos.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center text-sm text-muted-foreground">
            <PackageSearchIcon className="size-8" />
            No hay despachos aprobados o en tránsito en este momento.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {despachos.map((d) => (
            <Link key={d.id} href={`/despachador/${d.id}`}>
              <Card className="h-full transition-colors hover:border-primary/40">
                <CardContent className="space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-foreground">{d.numero}</span>
                    <StatusBadge {...ESTADO_DESPACHO_META[d.estado]} />
                  </div>
                  <p className="text-muted-foreground">
                    {d.destinoCliente.nombre} · {d.destinoCliente.ciudad}
                  </p>
                  <p className="text-muted-foreground">
                    {d.vehiculo ? `${d.vehiculo.placa} — ${d.vehiculo.conductorNombre ?? "sin conductor"}` : "Sin vehículo asignado"}
                  </p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
