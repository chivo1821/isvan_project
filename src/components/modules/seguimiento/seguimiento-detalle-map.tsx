"use client";

import dynamic from "next/dynamic";
import type { Tone } from "@/lib/constants";
import type { RutaPunto } from "@/lib/mock-data";

const LeafletMap = dynamic(() => import("@/components/map/leaflet-map").then((m) => m.LeafletMap), {
  ssr: false,
  loading: () => <div className="h-[26rem] w-full animate-pulse rounded-lg bg-muted" />,
});
const DespachoMarker = dynamic(() => import("@/components/map/despacho-marker").then((m) => m.DespachoMarker), {
  ssr: false,
});
const RoutePolyline = dynamic(() => import("@/components/map/route-polyline").then((m) => m.RoutePolyline), {
  ssr: false,
});

const TONE_POR_ESTADO: Record<RutaPunto["estado"], Tone> = {
  salida: "primary",
  en_ruta: "info",
  parada: "warning",
  entregado: "success",
};

export function SeguimientoDetalleMap({
  ruta,
  className = "h-[26rem]",
}: {
  ruta: RutaPunto[];
  className?: string;
}) {
  const path: [number, number][] = ruta.map((p) => [p.lat, p.lng]);
  const center = path[Math.floor(path.length / 2)] ?? [10.16, -68.0077];

  return (
    <LeafletMap center={center} zoom={9} bounds={path.length > 1 ? path : undefined} className={className}>
      {path.length > 1 && <RoutePolyline positions={path} />}
      {ruta.map((punto) => (
        <DespachoMarker key={punto.id} position={[punto.lat, punto.lng]} tone={TONE_POR_ESTADO[punto.estado]}>
          <div className="text-sm">
            <p className="font-medium capitalize">{punto.estado.replace("_", " ")}</p>
            {punto.descripcion && <p className="text-muted-foreground">{punto.descripcion}</p>}
          </div>
        </DespachoMarker>
      ))}
    </LeafletMap>
  );
}
