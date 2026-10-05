import { TriangleAlertIcon } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { AvisoRuta } from "@/lib/mock-data/types";
import { cn } from "@/lib/utils";

/** Lo que hay que resolver antes de la salida de una ruta (sin vehículo,
 * horarios que se pisan, salida vencida...). Avisa, no bloquea: ver
 * backend/app/services/planificacion.py. */
export function AvisosRuta({ avisos, className }: { avisos?: AvisoRuta[]; className?: string }) {
  if (!avisos?.length) return null;
  return (
    <ul
      className={cn(
        "space-y-1.5 rounded-lg border border-[color-mix(in_oklab,var(--warning)_45%,transparent)] bg-[color-mix(in_oklab,var(--warning)_10%,transparent)] p-3 text-sm",
        className
      )}
      aria-label="Avisos de la ruta"
    >
      {avisos.map((a, i) => (
        <li key={`${a.tipo}-${i}`} className="flex items-start gap-2">
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-[var(--warning)]" aria-hidden />
          <span>{a.mensaje}</span>
        </li>
      ))}
    </ul>
  );
}

/** La versión corta, para tablas y tarjetas: el ícono con la cantidad, y
 * el detalle al pasar el cursor. */
export function IndicadorAvisos({ avisos }: { avisos?: AvisoRuta[] }) {
  if (!avisos?.length) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="inline-flex items-center gap-1 rounded-md bg-[color-mix(in_oklab,var(--warning)_15%,transparent)] px-1.5 py-0.5 text-xs font-medium"
          aria-label={`${avisos.length} aviso(s): ${avisos.map((a) => a.mensaje).join(". ")}`}
        >
          <TriangleAlertIcon className="size-3.5 text-[var(--warning)]" aria-hidden />
          {avisos.length}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        <ul className="space-y-1">
          {avisos.map((a, i) => (
            <li key={`${a.tipo}-${i}`}>{a.mensaje}</li>
          ))}
        </ul>
      </TooltipContent>
    </Tooltip>
  );
}
