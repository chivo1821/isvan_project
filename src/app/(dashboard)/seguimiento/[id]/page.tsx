import { notFound } from "next/navigation";
import { CheckIcon, MapPinIcon, PauseIcon, TruckIcon } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { SeguimientoDetalleMap } from "@/components/modules/seguimiento/seguimiento-detalle-map";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ESTADO_DESPACHO_META, formatDateTime } from "@/lib/constants";
import { getDespachoConDetalle } from "@/lib/mock-data";
import { cn } from "@/lib/utils";

const ICONO_POR_ESTADO = {
  salida: TruckIcon,
  en_ruta: MapPinIcon,
  parada: PauseIcon,
  entregado: CheckIcon,
} as const;

export default async function SeguimientoDetallePage({ params }: PageProps<"/seguimiento/[id]">) {
  const { id } = await params;
  const despacho = getDespachoConDetalle(id);
  if (!despacho) notFound();

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Seguimiento — ${despacho.numero}`}
        subtitle={`${despacho.origen.nombre} → ${despacho.destinoCliente.nombre}`}
        actions={<StatusBadge {...ESTADO_DESPACHO_META[despacho.estado]} />}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {despacho.ruta.length > 0 ? (
            <SeguimientoDetalleMap ruta={despacho.ruta} />
          ) : (
            <Card>
              <CardContent className="flex h-[26rem] items-center justify-center text-sm text-muted-foreground">
                Este despacho todavía no tiene puntos de ruta registrados.
              </CardContent>
            </Card>
          )}
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Línea de tiempo</CardTitle>
          </CardHeader>
          <CardContent>
            {despacho.ruta.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin eventos registrados todavía.</p>
            ) : (
              <ol className="space-y-4">
                {despacho.ruta.map((punto, index) => {
                  const Icono = ICONO_POR_ESTADO[punto.estado];
                  const esUltimo = index === despacho.ruta.length - 1;
                  return (
                    <li key={punto.id} className="relative flex gap-3 pb-1">
                      {!esUltimo && (
                        <span className="absolute top-6 left-[11px] h-full w-px bg-border" aria-hidden="true" />
                      )}
                      <span
                        className={cn(
                          "z-10 flex size-6 shrink-0 items-center justify-center rounded-full",
                          esUltimo ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                        )}
                      >
                        <Icono className="size-3.5" />
                      </span>
                      <div className="text-sm">
                        <p className="font-medium capitalize text-foreground">{punto.estado.replace("_", " ")}</p>
                        {punto.descripcion && <p className="text-muted-foreground">{punto.descripcion}</p>}
                        <p className="text-xs text-muted-foreground">{formatDateTime(punto.timestamp)}</p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
