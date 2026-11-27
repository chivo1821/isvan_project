import Link from "@/components/shared/enlace";
import { ChevronLeftIcon, ChevronRightIcon, PlusIcon } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { AjustesPlanificacionDialog } from "@/components/modules/rutas/ajustes-planificacion-dialog";
import { PlanificacionAgenda } from "@/components/modules/rutas/planificacion-agenda";
import { Button } from "@/components/ui/button";
import { apiGet } from "@/lib/api-client";
import {
  diaCaracas,
  etiquetaDia,
  formatDia,
  lunesDe,
  sumarDias,
  type AjustePlanificacion,
  type Agenda,
} from "@/lib/planificacion";
import { getUsuarioActual } from "@/lib/session";

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

      <PlanificacionAgenda
        agenda={agenda}
        vista={vista}
        fecha={fecha}
        hoy={hoy}
        dias={dias}
        puedeProgramar={puedeProgramar}
      />
    </div>
  );
}
