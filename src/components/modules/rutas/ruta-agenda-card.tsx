import Link from "next/link";
import { CalendarClockIcon, PackageIcon, TruckIcon, UserIcon } from "lucide-react";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { AvisosRuta, IndicadorAvisos } from "@/components/modules/rutas/avisos-ruta";
import { ProgramarRutaDialog } from "@/components/modules/rutas/programar-ruta-dialog";
import { ESTADO_RUTA_META, TIPO_VEHICULO_META, formatDateTime, formatHora } from "@/lib/constants";
import type { RutaAgenda, VehiculoOpcion } from "@/lib/planificacion";
import { cn } from "@/lib/utils";

function formatKg(kg: number) {
  return `${kg.toLocaleString("es-VE", { maximumFractionDigits: 0 })} kg`;
}

/** Una ruta en la agenda de planificación. `compacta` para la vista
 * semanal (columnas angostas): sin la lista de pedidos ni los avisos
 * completos, que quedan en el ícono. */
export function RutaAgendaCard({
  ruta,
  vehiculos,
  puedeProgramar,
  compacta = false,
  mostrarFecha = false,
}: {
  ruta: RutaAgenda;
  vehiculos: VehiculoOpcion[];
  puedeProgramar: boolean;
  compacta?: boolean;
  /** Para las atrasadas, que no caen en el día que se está viendo. */
  mostrarFecha?: boolean;
}) {
  const vehiculo = vehiculos.find((v) => v.id === ruta.vehiculoId);
  const programable = puedeProgramar && ruta.estado === "PLANIFICADA";

  return (
    <div
      className={cn(
        "space-y-2 rounded-lg border bg-card p-3 text-sm",
        ruta.avisos.length > 0 ? "border-[color-mix(in_oklab,var(--warning)_45%,transparent)]" : "border-border"
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 font-semibold tabular-nums">
            <CalendarClockIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            {mostrarFecha ? formatDateTime(ruta.salidaProgramada) : formatHora(ruta.salidaProgramada)}
          </p>
          <Link href={`/rutas/${ruta.id}`} className="text-primary hover:underline">
            {ruta.numero}
          </Link>
        </div>
        <span className="flex flex-wrap items-center gap-1.5">
          <IndicadorAvisos avisos={ruta.avisos} />
          {!compacta && <StatusBadge {...ESTADO_RUTA_META[ruta.estado]} />}
        </span>
      </div>

      <div className="space-y-0.5 text-muted-foreground">
        <p className="flex items-center gap-1.5">
          <TruckIcon className="size-3.5 shrink-0" aria-hidden />
          {vehiculo ? (
            <span className="truncate">
              <span className="text-foreground">{vehiculo.placa}</span>
              {!compacta && ` — ${TIPO_VEHICULO_META[vehiculo.tipo].label}`}
            </span>
          ) : (
            <span className="font-medium text-warning">Sin vehículo</span>
          )}
        </p>
        {vehiculo && !compacta && (
          <p className="flex items-center gap-1.5">
            <UserIcon className="size-3.5 shrink-0" aria-hidden />
            {vehiculo.conductor ?? <span className="text-warning">Sin chofer asignado</span>}
          </p>
        )}
        <p className="flex items-center gap-1.5">
          <PackageIcon className="size-3.5 shrink-0" aria-hidden />
          {ruta.pedidos.length} pedido(s) · {formatKg(ruta.pesoKg)}
        </p>
      </div>

      {compacta && <StatusBadge {...ESTADO_RUTA_META[ruta.estado]} />}

      {!compacta && ruta.pedidos.length > 0 && (
        <ol className="space-y-0.5 border-t pt-2 text-xs text-muted-foreground">
          {ruta.pedidos.map((p, i) => (
            <li key={p.id}>
              {i + 1}. {p.numero} — <span className="text-foreground">{p.cliente}</span>
              {p.ciudad ? ` · ${p.ciudad}` : ""}
            </li>
          ))}
        </ol>
      )}

      {!compacta && <AvisosRuta avisos={ruta.avisos} />}

      {programable && (
        <ProgramarRutaDialog
          ruta={ruta}
          vehiculos={vehiculos}
          libres={ruta.vehiculosLibres}
          pesoKg={ruta.pesoKg}
          trigger={
            <Button size="sm" variant={vehiculo ? "outline" : "default"} className="w-full">
              {vehiculo ? "Reprogramar" : "Asignar vehículo"}
            </Button>
          }
        />
      )}
    </div>
  );
}
