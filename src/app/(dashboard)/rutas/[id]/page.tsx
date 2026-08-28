import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { SeguimientoDetalleMap } from "@/components/modules/seguimiento/seguimiento-detalle-map";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ESTADO_DESPACHO_META, ESTADO_RUTA_META, TIPO_VEHICULO_META, formatDate } from "@/lib/constants";
import { getRutaConDetalle } from "@/lib/mock-data";

export default async function RutaDetallePage({ params }: PageProps<"/rutas/[id]">) {
  const { id } = await params;
  const ruta = await getRutaConDetalle(id);
  if (!ruta) notFound();

  const rutaActiva = ruta.estado === "PLANIFICADA" || ruta.estado === "EN_TRANSITO";

  return (
    <div className="space-y-6">
      <PageHeader
        title={ruta.numero}
        subtitle={`${ruta.origen.nombre} · ${ruta.vehiculo.placa} — ${TIPO_VEHICULO_META[ruta.vehiculo.tipo].label} · creada el ${formatDate(ruta.fechaCreacion)} por ${ruta.creadoPor.nombre}`}
        actions={
          <div className="flex items-center gap-3">
            <StatusBadge {...ESTADO_RUTA_META[ruta.estado]} />
            {rutaActiva && (
              <Link href={`/despachador/${ruta.id}`} className="text-sm text-primary hover:underline">
                Ver en despachador →
              </Link>
            )}
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {ruta.puntos.length > 0 ? (
            <SeguimientoDetalleMap ruta={ruta.puntos} className="h-[28rem]" />
          ) : (
            <Card>
              <CardContent className="flex h-[28rem] items-center justify-center text-center text-sm text-muted-foreground">
                Esta ruta todavía no tiene trazado calculado.
              </CardContent>
            </Card>
          )}
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Paradas ({ruta.despachos.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {ruta.despachos.map((d, index) => (
              <Link
                key={d.id}
                href={`/despachos/${d.id}`}
                className="flex items-start justify-between gap-2 rounded-lg border border-border p-3 text-sm transition-colors hover:border-primary/40"
              >
                <div>
                  <p className="font-medium text-foreground">
                    {index + 1}. {d.destinoCliente.nombre}
                  </p>
                  <p className="text-muted-foreground">
                    {d.numero} · {d.destinoCliente.ciudad}
                  </p>
                </div>
                <StatusBadge {...ESTADO_DESPACHO_META[d.estado]} />
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>

      {(ruta.distanciaTotalKm != null || ruta.tiempoTotalMin != null) && (
        <p className="text-sm text-muted-foreground">
          {ruta.distanciaTotalKm?.toLocaleString("es-VE")} km · ~{ruta.tiempoTotalMin} min estimados en total.
        </p>
      )}
    </div>
  );
}
