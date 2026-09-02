import Link from "next/link";
import { PackageSearchIcon } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { ESTADO_RUTA_META, TIPO_VEHICULO_META } from "@/lib/constants";
import { getRutasActivas } from "@/lib/mock-data";
import { getUsuarioActual } from "@/lib/session";

export default async function DespachadorPage() {
  const [rutas, usuarioActual] = await Promise.all([getRutasActivas(), getUsuarioActual()]);
  // Un repartidor sin vehículo asignado no ve ninguna ruta (la API se las
  // filtra por vehículo). Sin este aviso, la pantalla vacía no explica nada.
  const sinVehiculo = usuarioActual?.rol === "REPARTIDOR" && !usuarioActual.vehiculoAsignadoId;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Despachador"
        subtitle="Rutas listas para salir o en camino — marca cuando salgas y cuando entregues cada parada"
      />

      {rutas.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center text-sm text-muted-foreground">
            <PackageSearchIcon className="size-8" />
            {sinVehiculo
              ? "Todavía no tienes un vehículo asignado — pídele a un administrador que te asigne uno para ver tu ruta."
              : "No hay rutas planificadas o en tránsito en este momento."}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rutas.map((r) => (
            <Link key={r.id} href={`/despachador/${r.id}`}>
              <Card className="h-full transition-colors hover:border-primary/40">
                <CardContent className="space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-foreground">{r.numero}</span>
                    <StatusBadge {...ESTADO_RUTA_META[r.estado]} />
                  </div>
                  <p className="text-muted-foreground">
                    {r.vehiculo.placa} — {TIPO_VEHICULO_META[r.vehiculo.tipo].label}
                  </p>
                  <p className="text-muted-foreground">{r.despachos.length} parada(s)</p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
