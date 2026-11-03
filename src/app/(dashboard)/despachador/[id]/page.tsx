import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { ViajeEnCurso } from "@/components/modules/despachador/viaje-en-curso";
import { IniciarRutaButton, NoCompletarRutaButton } from "@/components/modules/despachador/despachador-actions";
import { ESTADO_RUTA_META, describirVehiculo, formatDateTime, formatHora } from "@/lib/constants";
import { getRutaConDetalle } from "@/lib/mock-data";

export default async function DespachadorDetallePage({ params }: PageProps<"/despachador/[id]">) {
  const { id } = await params;
  const ruta = await getRutaConDetalle(id);
  if (!ruta) notFound();
  const enCamino = ruta.estado === "EN_TRANSITO";

  return (
    <div className="space-y-6">
      <PageHeader
        title={ruta.numero}
        subtitle={`${ruta.origen.nombre} · ${describirVehiculo(ruta.vehiculo)}`}
        actions={<StatusBadge {...ESTADO_RUTA_META[ruta.estado]} />}
      />

      {/* En camino, la hora de salida va en el resumen del viaje: aquí solo
          queda lo de antes de salir. */}
      {!enCamino && (
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
      )}

      <ViajeEnCurso
        rutaId={ruta.id}
        estadoRuta={ruta.estado}
        enCaminoDesde={
          enCamino
            ? `En camino desde las ${formatHora(ruta.iniciadaEn ?? ruta.salidaProgramada)}${
                ruta.distanciaTotalKm != null ? ` · ${ruta.distanciaTotalKm.toLocaleString("es-VE")} km` : ""
              }`
            : undefined
        }
        puntos={ruta.puntos}
        paradas={ruta.despachos}
      />

      {/* Al final y no arriba: es para una emergencia, y arriba quedaba a un
          toque de distancia justo donde el repartidor empieza a usar la
          pantalla. */}
      {enCamino && ruta.despachos.some((d) => d.estado !== "ENTREGADO") && (
        <div className="flex justify-center border-t border-border pt-4">
          <NoCompletarRutaButton rutaId={ruta.id} />
        </div>
      )}
    </div>
  );
}
