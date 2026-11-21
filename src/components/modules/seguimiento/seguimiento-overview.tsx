"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import Link from "@/components/shared/enlace";
import { BatteryLowIcon, BatteryMediumIcon, SignalZeroIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { ESTADO_RUTA_META } from "@/lib/constants";
import { StatusBadge } from "@/components/shared/status-badge";
import { AvisoSinSenal } from "@/components/modules/seguimiento/aviso-sin-senal";
import { haceCuanto, useSondeo, type RepartidorEnVivo, type RepartidoresEnVivo } from "@/lib/seguimiento";
import type { EstadoRuta } from "@prisma/client";

const LeafletMap = dynamic(() => import("@/components/map/leaflet-map").then((m) => m.LeafletMap), {
  ssr: false,
  loading: () => <div className="h-[28rem] w-full animate-pulse rounded-lg bg-muted" />,
});
const DespachoMarker = dynamic(() => import("@/components/map/despacho-marker").then((m) => m.DespachoMarker), {
  ssr: false,
});
const FlyTo = dynamic(() => import("@/components/map/fly-to").then((m) => m.FlyTo), { ssr: false });

// Las posiciones llegan de la app cada ~90 s: preguntar cada 20 s basta para
// verlas casi al momento (son unos cientos de bytes).
const SONDEO_MS = 20_000;

export type RutaSeguimientoItem = {
  id: string;
  numero: string;
  vehiculoPlaca: string;
  paradas: number;
  estado: EstadoRuta;
  position: [number, number];
};

type Seleccion = { id: string; position: [number, number] } | null;

function Bateria({ nivel }: { nivel: number | null }) {
  if (nivel == null) return null;
  const Icono = nivel < 0.2 ? BatteryLowIcon : BatteryMediumIcon;
  return (
    <span className={cn("inline-flex items-center gap-0.5", nivel < 0.2 && "text-destructive")}>
      <Icono className="size-3.5" aria-hidden />
      {Math.round(nivel * 100)} %
    </span>
  );
}

/** El mapa general: todas las rutas activas, cada una con su punto. Una ruta
 * en tránsito cuyo repartidor usa la app se dibuja donde está él de verdad;
 * el detalle (por dónde pasó y qué entregó) va en /seguimiento/[id]. */
export function SeguimientoOverview({
  rutas,
  center,
  repartidoresIniciales,
}: {
  rutas: RutaSeguimientoItem[];
  center: [number, number];
  /** null si el seguimiento en vivo no respondió al cargar la página. */
  repartidoresIniciales: RepartidoresEnVivo | null;
}) {
  const [seleccionada, setSeleccionada] = useState<Seleccion>(null);
  const enVivo = useSondeo<RepartidoresEnVivo | null>(
    "/rutas/seguimiento/repartidores",
    repartidoresIniciales,
    SONDEO_MS
  );
  // El repartidor de cada ruta en tránsito, si tiene la jornada abierta.
  const enRuta = new Map<string, RepartidorEnVivo>();
  for (const r of enVivo?.repartidores ?? []) if (r.rutaId) enRuta.set(r.rutaId, r);

  const rutasEnMapa = rutas.map((r) => {
    const rep = enRuta.get(r.id);
    const real = rep?.lat != null && rep.lng != null ? ([rep.lat, rep.lng] as [number, number]) : null;
    return { ...r, position: real ?? r.position, repartidor: rep ?? null, real: real != null };
  });

  return (
    <div className="space-y-4">
      {/* Todos los que dejaron de enviar, tengan ruta en tránsito o no. */}
      <AvisoSinSenal repartidores={enVivo?.repartidores ?? []} minutos={enVivo?.minutosSinSenal ?? 10} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-1">
          <section className="space-y-2">
            <h2 className="text-sm font-medium text-foreground">
              Rutas activas <span className="text-muted-foreground">({rutas.length})</span>
            </h2>
            {rutas.length === 0 ? (
              <p className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
                No hay rutas activas en este momento.
              </p>
            ) : (
              rutasEnMapa.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setSeleccionada({ id: r.id, position: r.position })}
                  className={cn(
                    "w-full rounded-lg border bg-card p-3 text-left text-sm transition-colors hover:border-primary/40",
                    r.repartidor?.sinSenal ? "border-warning/50" : "border-border",
                    seleccionada?.id === r.id && "border-primary ring-1 ring-primary/30"
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-foreground">{r.numero}</span>
                    <StatusBadge {...ESTADO_RUTA_META[r.estado]} />
                  </div>
                  <p className="mt-1 text-muted-foreground">
                    {r.vehiculoPlaca} · {r.paradas} parada(s)
                  </p>
                  {r.repartidor && (
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                      {r.repartidor.sinSenal ? (
                        <span className="inline-flex items-center gap-0.5 font-medium text-warning">
                          <SignalZeroIcon className="size-3.5" aria-hidden />
                          {r.repartidor.tomadaEn
                            ? `Sin señal ${haceCuanto(r.repartidor.minutosDesdeUltimo)}`
                            : "Todavía sin ubicación"}
                        </span>
                      ) : (
                        <span>Ubicación real · vista {haceCuanto(r.repartidor.minutosDesdeUltimo)}</span>
                      )}
                      <Bateria nivel={r.repartidor.bateria} />
                    </p>
                  )}
                  {/* El margen va afuera: en el teléfono el enlace usa el suyo para
                      agrandar su área de toque (ver enlace-tactil en globals.css). */}
                  <span className="mt-1 block">
                    <Link
                      href={`/seguimiento/${r.id}`}
                      className="enlace-tactil inline-block text-xs text-primary hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      Ver seguimiento detallado →
                    </Link>
                  </span>
                </button>
              ))
            )}
          </section>
        </div>

        <div className="lg:col-span-2">
          <LeafletMap center={center} zoom={7} className="h-[28rem]">
            {rutasEnMapa.map((r) => (
              <DespachoMarker
                key={r.id}
                position={r.position}
                tone={r.repartidor?.sinSenal ? "warning" : ESTADO_RUTA_META[r.estado].tone}
              >
                <div className="space-y-0.5 text-sm">
                  <p className="font-medium">{r.numero}</p>
                  <p className="text-muted-foreground">
                    {r.vehiculoPlaca}
                    {r.repartidor && ` · ${r.repartidor.nombre}`}
                  </p>
                  {r.repartidor && (
                    <p className="text-muted-foreground">
                      {r.repartidor.sinSenal ? "Sin señal" : "Ubicación real, vista"}{" "}
                      {haceCuanto(r.repartidor.minutosDesdeUltimo)}
                    </p>
                  )}
                  <Link href={`/seguimiento/${r.id}`} className="text-primary hover:underline">
                    Ver seguimiento detallado →
                  </Link>
                </div>
              </DespachoMarker>
            ))}
            <FlyTo target={seleccionada?.position ?? null} zoom={13} />
          </LeafletMap>
        </div>
      </div>
    </div>
  );
}
