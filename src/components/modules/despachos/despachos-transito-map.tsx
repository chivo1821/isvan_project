"use client";

import dynamic from "next/dynamic";
import type { Tone } from "@/lib/constants";

const LeafletMap = dynamic(() => import("@/components/map/leaflet-map").then((m) => m.LeafletMap), {
  ssr: false,
  loading: () => <div className="h-64 w-full animate-pulse rounded-lg bg-muted" />,
});
const DespachoMarker = dynamic(() => import("@/components/map/despacho-marker").then((m) => m.DespachoMarker), {
  ssr: false,
});

export type DespachoMapPoint = {
  id: string;
  numero: string;
  clienteNombre: string;
  position: [number, number];
  tone: Tone;
};

export function DespachosTransitoMap({
  puntos,
  center,
  zoom = 7,
  className,
}: {
  puntos: DespachoMapPoint[];
  center: [number, number];
  zoom?: number;
  className?: string;
}) {
  return (
    <LeafletMap center={center} zoom={zoom} className={className}>
      {puntos.map((punto) => (
        <DespachoMarker key={punto.id} position={punto.position} tone={punto.tone}>
          <div className="text-sm">
            <p className="font-medium">{punto.numero}</p>
            <p className="text-muted-foreground">{punto.clienteNombre}</p>
          </div>
        </DespachoMarker>
      ))}
    </LeafletMap>
  );
}
