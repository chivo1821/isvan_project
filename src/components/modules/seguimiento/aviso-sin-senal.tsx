"use client";

import { useState } from "react";
import Link from "@/components/shared/enlace";
import { ChevronDownIcon, MapPinOffIcon, PhoneIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatHora } from "@/lib/constants";
import { haceCuanto, type RepartidorEnVivo } from "@/lib/seguimiento";

/** Minutos sin enviar, para ordenar: el que nunca envió cuenta desde que
 * abrió la jornada. */
function minutosSinEnviar(r: RepartidorEnVivo): number {
  if (r.minutosDesdeUltimo != null) return r.minutosDesdeUltimo;
  return Math.round((Date.now() - new Date(r.jornadaDesde).getTime()) / 60_000);
}

/** Los repartidores con la jornada abierta cuyo teléfono dejó de mandar la
 * ubicación (más de `minutos` sin un punto). Puede ser falta de señal, el GPS
 * apagado o que el teléfono cerró la app (algunas marcas, como Tecno o
 * Infinix, la cierran al limpiar las apps recientes).
 *
 * Cerrado por defecto: solo dice cuántos. El detalle de cada uno lo abre quien
 * lo necesite (con 100 repartidores la lista abierta tapaba la página). */
export function AvisoSinSenal({ repartidores, minutos }: { repartidores: RepartidorEnVivo[]; minutos: number }) {
  const [abierto, setAbierto] = useState(false);
  const sinSenal = repartidores.filter((r) => r.sinSenal).sort((a, b) => minutosSinEnviar(b) - minutosSinEnviar(a));
  if (sinSenal.length === 0) return null;

  return (
    <section role="status" aria-live="polite" className="rounded-lg border border-warning/60 bg-warning/10 text-sm">
      <button
        type="button"
        aria-expanded={abierto}
        aria-controls="aviso-sin-senal-detalle"
        onClick={() => setAbierto((v) => !v)}
        className="flex w-full items-center gap-2 rounded-lg p-4 text-left hover:bg-warning/10 focus-visible:outline-2 focus-visible:outline-ring"
      >
        <MapPinOffIcon className="size-4 shrink-0 text-foreground" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block font-semibold text-foreground">
            {sinSenal.length === 1
              ? "Un repartidor dejó de enviar su ubicación"
              : `${sinSenal.length} repartidores dejaron de enviar su ubicación`}
          </span>
          <span className="block text-muted-foreground">
            Con la jornada abierta y sin enviar hace más de {minutos} min.{" "}
            {abierto ? "Toca para ocultar el detalle." : "Toca para ver quiénes son."}
          </span>
        </span>
        <ChevronDownIcon
          className={cn("size-4 shrink-0 text-foreground transition-transform", abierto && "rotate-180")}
          aria-hidden
        />
      </button>

      {abierto && (
        <div id="aviso-sin-senal-detalle" className="border-t border-warning/40 px-4 pb-4">
          <p className="pt-3 text-muted-foreground">
            Puede ser falta de señal, el GPS apagado o que el teléfono cerró la app. Llámalos para confirmar. Primero
            los que llevan más tiempo sin enviar.
          </p>
          <ul className="mt-2 max-h-96 divide-y divide-warning/30 overflow-y-auto pr-1">
            {sinSenal.map((r) => (
              <li key={r.usuarioId} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2">
                <span className="min-w-0 font-medium text-foreground">
                  {r.nombre}
                  {r.vehiculoPlaca && <span className="font-normal text-muted-foreground"> · {r.vehiculoPlaca}</span>}
                </span>
                <span className="text-muted-foreground">
                  {r.tomadaEn
                    ? `Última ubicación ${haceCuanto(r.minutosDesdeUltimo)} (${formatHora(r.tomadaEn)})`
                    : `Sin ninguna ubicación desde que abrió la jornada (${formatHora(r.jornadaDesde)})`}
                  {r.bateria != null && ` · batería ${Math.round(r.bateria * 100)} %`}
                </span>
                <span className="ml-auto flex items-center gap-3">
                  {r.rutaId && (
                    <Link href={`/seguimiento/${r.rutaId}`} className="enlace-tactil text-primary hover:underline">
                      Ruta {r.rutaNumero}
                    </Link>
                  )}
                  {r.telefono && (
                    <a
                      href={`tel:${r.telefono.replace(/[^\d+]/g, "")}`}
                      className="enlace-tactil inline-flex items-center gap-1 text-primary hover:underline"
                    >
                      <PhoneIcon className="size-3.5" aria-hidden />
                      {r.telefono}
                    </a>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
