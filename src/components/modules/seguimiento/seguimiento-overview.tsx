"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { ESTADO_DESPACHO_META } from "@/lib/constants";
import { StatusBadge } from "@/components/shared/status-badge";
import type { EstadoDespacho } from "@prisma/client";

const LeafletMap = dynamic(() => import("@/components/map/leaflet-map").then((m) => m.LeafletMap), {
  ssr: false,
  loading: () => <div className="h-[28rem] w-full animate-pulse rounded-lg bg-muted" />,
});
const DespachoMarker = dynamic(() => import("@/components/map/despacho-marker").then((m) => m.DespachoMarker), {
  ssr: false,
});
const FlyTo = dynamic(() => import("@/components/map/fly-to").then((m) => m.FlyTo), { ssr: false });

export type DespachoSeguimientoItem = {
  id: string;
  numero: string;
  destinoNombre: string;
  destinoCiudad: string;
  estado: EstadoDespacho;
  position: [number, number];
};

export function SeguimientoOverview({
  despachos,
  center,
}: {
  despachos: DespachoSeguimientoItem[];
  center: [number, number];
}) {
  const [seleccionado, setSeleccionado] = useState<DespachoSeguimientoItem | null>(null);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <div className="space-y-2 lg:col-span-1">
        {despachos.length === 0 ? (
          <p className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
            No hay despachos activos en este momento.
          </p>
        ) : (
          despachos.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => setSeleccionado(d)}
              className={cn(
                "w-full rounded-lg border border-border bg-card p-3 text-left text-sm transition-colors hover:border-primary/40",
                seleccionado?.id === d.id && "border-primary ring-1 ring-primary/30"
              )}
            >
              <div className="flex items-center justify-between">
                <span className="font-medium text-foreground">{d.numero}</span>
                <StatusBadge {...ESTADO_DESPACHO_META[d.estado]} />
              </div>
              <p className="mt-1 text-muted-foreground">
                {d.destinoNombre} · {d.destinoCiudad}
              </p>
              <Link
                href={`/seguimiento/${d.id}`}
                className="mt-1 inline-block text-xs text-primary hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                Ver seguimiento detallado →
              </Link>
            </button>
          ))
        )}
      </div>

      <div className="lg:col-span-2">
        <LeafletMap center={center} zoom={7} className="h-[28rem]">
          {despachos.map((d) => (
            <DespachoMarker
              key={d.id}
              position={d.position}
              tone={ESTADO_DESPACHO_META[d.estado].tone}
            >
              <div className="text-sm">
                <p className="font-medium">{d.numero}</p>
                <p className="text-muted-foreground">{d.destinoNombre}</p>
              </div>
            </DespachoMarker>
          ))}
          <FlyTo target={seleccionado?.position ?? null} zoom={10} />
        </LeafletMap>
      </div>
    </div>
  );
}
