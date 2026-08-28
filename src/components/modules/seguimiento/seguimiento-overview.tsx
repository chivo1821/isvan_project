"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { ESTADO_RUTA_META } from "@/lib/constants";
import { StatusBadge } from "@/components/shared/status-badge";
import type { EstadoRuta } from "@prisma/client";

const LeafletMap = dynamic(() => import("@/components/map/leaflet-map").then((m) => m.LeafletMap), {
  ssr: false,
  loading: () => <div className="h-[28rem] w-full animate-pulse rounded-lg bg-muted" />,
});
const DespachoMarker = dynamic(() => import("@/components/map/despacho-marker").then((m) => m.DespachoMarker), {
  ssr: false,
});
const FlyTo = dynamic(() => import("@/components/map/fly-to").then((m) => m.FlyTo), { ssr: false });

export type RutaSeguimientoItem = {
  id: string;
  numero: string;
  vehiculoPlaca: string;
  paradas: number;
  estado: EstadoRuta;
  position: [number, number];
};

export function SeguimientoOverview({
  rutas,
  center,
}: {
  rutas: RutaSeguimientoItem[];
  center: [number, number];
}) {
  const [seleccionada, setSeleccionada] = useState<RutaSeguimientoItem | null>(null);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <div className="space-y-2 lg:col-span-1">
        {rutas.length === 0 ? (
          <p className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
            No hay rutas activas en este momento.
          </p>
        ) : (
          rutas.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setSeleccionada(r)}
              className={cn(
                "w-full rounded-lg border border-border bg-card p-3 text-left text-sm transition-colors hover:border-primary/40",
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
              <Link
                href={`/seguimiento/${r.id}`}
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
          {rutas.map((r) => (
            <DespachoMarker key={r.id} position={r.position} tone={ESTADO_RUTA_META[r.estado].tone}>
              <div className="text-sm">
                <p className="font-medium">{r.numero}</p>
                <p className="text-muted-foreground">{r.vehiculoPlaca}</p>
              </div>
            </DespachoMarker>
          ))}
          <FlyTo target={seleccionada?.position ?? null} zoom={10} />
        </LeafletMap>
      </div>
    </div>
  );
}
