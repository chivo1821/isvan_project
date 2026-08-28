import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SeguimientoDetalleMap } from "@/components/modules/seguimiento/seguimiento-detalle-map";
import { IniciarRutaButton, MarcarParadaEntregadaButton } from "@/components/modules/despachador/despachador-actions";
import { ESTADO_DESPACHO_META, ESTADO_RUTA_META, TIPO_VEHICULO_META } from "@/lib/constants";
import { getRutaConDetalle } from "@/lib/mock-data";

export default async function DespachadorDetallePage({ params }: PageProps<"/despachador/[id]">) {
  const { id } = await params;
  const ruta = await getRutaConDetalle(id);
  if (!ruta) notFound();

  return (
    <div className="space-y-6">
      <PageHeader
        title={ruta.numero}
        subtitle={`${ruta.origen.nombre} · ${ruta.vehiculo.placa} — ${TIPO_VEHICULO_META[ruta.vehiculo.tipo].label}`}
        actions={<StatusBadge {...ESTADO_RUTA_META[ruta.estado]} />}
      />

      {ruta.puntos.length > 0 ? (
        <SeguimientoDetalleMap ruta={ruta.puntos} className="h-[28rem]" />
      ) : (
        <Card>
          <CardContent className="flex h-[28rem] items-center justify-center text-center text-sm text-muted-foreground">
            Esta ruta todavía no tiene un trazado calculado.
          </CardContent>
        </Card>
      )}

      <div className="flex flex-col items-start justify-between gap-4 rounded-lg border border-border bg-card p-4 sm:flex-row sm:items-center">
        <div className="space-y-1 text-sm text-muted-foreground">
          {ruta.distanciaTotalKm != null && ruta.tiempoTotalMin != null && (
            <p>
              {ruta.distanciaTotalKm.toLocaleString("es-VE")} km · ~{ruta.tiempoTotalMin} min estimados
            </p>
          )}
        </div>
        {ruta.estado === "PLANIFICADA" && <IniciarRutaButton rutaId={ruta.id} />}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Paradas</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {ruta.despachos.map((d, index) => (
            <div
              key={d.id}
              className="flex flex-col items-start justify-between gap-3 rounded-lg border border-border p-3 text-sm sm:flex-row sm:items-center"
            >
              <div>
                <p className="font-medium text-foreground">
                  {index + 1}. {d.destinoCliente.nombre}
                </p>
                <p className="text-muted-foreground">
                  {d.numero} · {d.destinoCliente.direccion}, {d.destinoCliente.ciudad}
                </p>
                <ul className="mt-1 text-xs text-muted-foreground">
                  {d.items.map((item) => (
                    <li key={item.id}>
                      {item.cantidad}× {item.descripcion}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <StatusBadge {...ESTADO_DESPACHO_META[d.estado]} />
                {ruta.estado === "EN_TRANSITO" && d.estado === "EN_TRANSITO" && (
                  <MarcarParadaEntregadaButton rutaId={ruta.id} despachoId={d.id} size="sm" />
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
