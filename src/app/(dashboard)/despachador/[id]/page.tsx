import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { ViajeEnCurso } from "@/components/modules/despachador/viaje-en-curso";
import { IniciarRutaButton } from "@/components/modules/despachador/despachador-actions";
import { ESTADO_RUTA_META, describirVehiculo, formatDateTime } from "@/lib/constants";
import { getRutaConDetalle } from "@/lib/mock-data";

export default async function DespachadorDetallePage({ params }: PageProps<"/despachador/[id]">) {
  const { id } = await params;
  const ruta = await getRutaConDetalle(id);
  if (!ruta) notFound();

  return (
    <div className="space-y-6">
      <PageHeader
        title={ruta.numero}
        subtitle={`${ruta.origen.nombre} · ${describirVehiculo(ruta.vehiculo)}`}
        actions={<StatusBadge {...ESTADO_RUTA_META[ruta.estado]} />}
      />

      <div className="flex flex-col items-start justify-between gap-4 rounded-lg border border-border bg-card p-4 sm:flex-row sm:items-center">
        <div className="space-y-1 text-sm text-muted-foreground">
          <p className="text-base font-semibold text-foreground">
            Recoger en el almacén: {formatDateTime(ruta.salidaProgramada)}
          </p>
          {ruta.distanciaTotalKm != null && ruta.tiempoTotalMin != null && (
            <p>
              {ruta.distanciaTotalKm.toLocaleString("es-VE")} km · ~{ruta.tiempoTotalMin} min estimados
            </p>
          )}
        </div>
        {ruta.estado === "PLANIFICADA" && <IniciarRutaButton rutaId={ruta.id} />}
      </div>

      <ViajeEnCurso
        rutaId={ruta.id}
        estadoRuta={ruta.estado}
        puntos={ruta.puntos}
        paradas={ruta.despachos}
      />
    </div>
  );
}
