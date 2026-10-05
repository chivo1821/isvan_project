import Link from "next/link";
import { ChevronLeftIcon, ChevronRightIcon, PlusIcon, TriangleAlertIcon } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { AjustesPlanificacionDialog } from "@/components/modules/rutas/ajustes-planificacion-dialog";
import { RutaAgendaCard } from "@/components/modules/rutas/ruta-agenda-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { apiGet } from "@/lib/api-client";
import {
  diaCaracas,
  etiquetaDia,
  formatDia,
  lunesDe,
  sumarDias,
  type AjustePlanificacion,
  type Agenda,
  type RutaAgenda,
} from "@/lib/planificacion";
import { getUsuarioActual } from "@/lib/session";
import { cn } from "@/lib/utils";

type SearchParams = { vista?: string; fecha?: string };
type Vista = "dia" | "semana";

function enlace(vista: Vista, fecha: string) {
  return `/rutas/planificacion?vista=${vista}&fecha=${fecha}`;
}

/** Agenda de salidas: qué rutas salen cada día y a qué hora, con o sin
 * vehículo, y lo que hay que resolver antes (ver
 * backend/app/services/planificacion.py). Por día o por semana. */
export default async function PlanificacionPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const vista: Vista = params.vista === "semana" ? "semana" : "dia";
  const hoy = diaCaracas();
  const fecha = params.fecha && /^\d{4}-\d{2}-\d{2}$/.test(params.fecha) ? params.fecha : hoy;
  const desde = vista === "dia" ? fecha : lunesDe(fecha);
  const hasta = vista === "dia" ? fecha : sumarDias(desde, 6);
  const paso = vista === "dia" ? 1 : 7;

  const [agenda, ajustes, usuarioActual] = await Promise.all([
    apiGet<Agenda>(`/rutas/agenda?desde=${desde}&hasta=${hasta}`),
    apiGet<AjustePlanificacion[]>("/rutas/configuracion").catch(() => []),
    getUsuarioActual(),
  ]);
  const puedeProgramar = usuarioActual?.rol === "ADMIN" || usuarioActual?.rol === "DESPACHOS";
  const limiteMoto = ajustes.find((a) => a.clave === "motoDistanciaMaxKm");

  const dias = Array.from({ length: vista === "dia" ? 1 : 7 }, (_, i) => sumarDias(desde, i));
  const porDia = new Map<string, RutaAgenda[]>(dias.map((d) => [d, []]));
  for (const r of agenda.rutas) porDia.get(diaCaracas(r.salidaProgramada))?.push(r);

  const todas = [...agenda.rutas, ...agenda.atrasadas];
  const activas = todas.filter((r) => r.estado === "PLANIFICADA" || r.estado === "EN_TRANSITO");
  const sinVehiculo = activas.filter((r) => !r.vehiculoId).length;
  const conAvisos = activas.filter((r) => r.avisos.length > 0).length;
  const pedidos = agenda.rutas.reduce((n, r) => n + r.pedidos.length, 0);

  const rango =
    vista === "dia" ? `${etiquetaDia(fecha, hoy)} · ${formatDia(fecha)}` : `${formatDia(desde)} – ${formatDia(hasta)}`;
  const incluyeHoy = desde <= hoy && hoy <= hasta;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Planificación"
        subtitle={`Salidas de las rutas desde el almacén${
          limiteMoto ? ` · motos hasta ${limiteMoto.valor.toLocaleString("es-VE")} ${limiteMoto.unidad} del almacén` : ""
        }`}
        helpText="Las rutas se planifican con fecha y hora de salida, con o sin vehículo. Lo que falta resolver (sin vehículo, horarios que se pisan, vehículo en taller, moto demasiado lejos, salida vencida) aparece como aviso: no bloquea."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {usuarioActual?.rol === "ADMIN" && ajustes.length > 0 && <AjustesPlanificacionDialog ajustes={ajustes} />}
            {puedeProgramar && (
              <Button asChild>
                <Link href="/rutas/nueva">
                  <PlusIcon />
                  Nueva ruta
                </Link>
              </Button>
            )}
          </div>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline" size="icon" aria-label={vista === "dia" ? "Día anterior" : "Semana anterior"}>
            <Link href={enlace(vista, sumarDias(fecha, -paso))}>
              <ChevronLeftIcon />
            </Link>
          </Button>
          <Button asChild variant={incluyeHoy ? "secondary" : "outline"} size="sm">
            <Link href={enlace(vista, hoy)}>Hoy</Link>
          </Button>
          <Button asChild variant="outline" size="icon" aria-label={vista === "dia" ? "Día siguiente" : "Semana siguiente"}>
            <Link href={enlace(vista, sumarDias(fecha, paso))}>
              <ChevronRightIcon />
            </Link>
          </Button>
          <h2 className="ml-1 font-heading text-base font-medium">{rango}</h2>
        </div>
        <div className="flex items-center gap-1 rounded-lg border p-0.5" role="group" aria-label="Vista">
          {(["dia", "semana"] as const).map((v) => (
            <Button key={v} asChild size="sm" variant={vista === v ? "secondary" : "ghost"}>
              <Link href={enlace(v, fecha)} aria-current={vista === v ? "page" : undefined}>
                {v === "dia" ? "Día" : "Semana"}
              </Link>
            </Button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Resumen etiqueta="Rutas" valor={agenda.rutas.length} />
        <Resumen etiqueta="Pedidos" valor={pedidos} />
        <Resumen etiqueta="Sin vehículo" valor={sinVehiculo} alerta={sinVehiculo > 0} />
        <Resumen etiqueta="Con avisos" valor={conAvisos} alerta={conAvisos > 0} />
      </div>

      {agenda.atrasadas.length > 0 && (
        <section className="space-y-3">
          <h2 className="flex items-center gap-1.5 font-heading text-base font-medium">
            <TriangleAlertIcon className="size-4 text-[var(--warning)]" aria-hidden />
            Atrasadas: debían salir antes y siguen planificadas ({agenda.atrasadas.length})
          </h2>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {agenda.atrasadas.map((r) => (
              <RutaAgendaCard
                key={r.id}
                ruta={r}
                vehiculos={agenda.vehiculos}
                puedeProgramar={puedeProgramar}
                mostrarFecha
              />
            ))}
          </div>
        </section>
      )}

      {vista === "dia" ? (
        (porDia.get(fecha) ?? []).length === 0 ? (
          <SinRutas puedeProgramar={puedeProgramar} />
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {porDia.get(fecha)!.map((r) => (
              <RutaAgendaCard key={r.id} ruta={r} vehiculos={agenda.vehiculos} puedeProgramar={puedeProgramar} />
            ))}
          </div>
        )
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-7">
          {dias.map((d) => {
            const delDia = porDia.get(d) ?? [];
            return (
              <section
                key={d}
                className={cn("space-y-2 rounded-lg border p-2", d === hoy ? "border-primary/50 bg-primary/5" : "bg-muted/30")}
              >
                <Link href={enlace("dia", d)} className="block rounded-md px-1 hover:bg-muted">
                  <span className="block text-sm font-medium">{etiquetaDia(d, hoy)}</span>
                  <span className="block text-xs text-muted-foreground">
                    {formatDia(d)} · {delDia.length} ruta(s)
                  </span>
                </Link>
                {delDia.length === 0 ? (
                  <p className="px-1 py-3 text-xs text-muted-foreground">Sin salidas</p>
                ) : (
                  delDia.map((r) => (
                    <RutaAgendaCard
                      key={r.id}
                      ruta={r}
                      vehiculos={agenda.vehiculos}
                      puedeProgramar={puedeProgramar}
                      compacta
                    />
                  ))
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Resumen({ etiqueta, valor, alerta = false }: { etiqueta: string; valor: number; alerta?: boolean }) {
  return (
    <Card className="py-3">
      <CardContent className="px-4">
        <p className="text-xs text-muted-foreground">{etiqueta}</p>
        <p className={cn("text-2xl font-bold tabular-nums", alerta && "text-warning")}>{valor}</p>
      </CardContent>
    </Card>
  );
}

function SinRutas({ puedeProgramar }: { puedeProgramar: boolean }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-12 text-center text-sm text-muted-foreground">
        No hay rutas que salgan este día.
        {puedeProgramar && (
          <Button asChild variant="outline" size="sm">
            <Link href="/rutas/nueva">
              <PlusIcon />
              Planificar una ruta
            </Link>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
