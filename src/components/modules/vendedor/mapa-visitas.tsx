"use client";

import dynamic from "next/dynamic";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { ESTATUS_VISITA_META, type ClienteDeLaSemana } from "@/lib/vendedor";

const LeafletMap = dynamic(() => import("@/components/map/leaflet-map").then((m) => m.LeafletMap), {
  ssr: false,
  loading: () => <div className="h-72 w-full animate-pulse rounded-lg bg-muted sm:h-80" />,
});
const DespachoMarker = dynamic(() => import("@/components/map/despacho-marker").then((m) => m.DespachoMarker), {
  ssr: false,
});

type ConUbicacion = ClienteDeLaSemana & { lat: number; lng: number };

/** Clientes de la semana en el mapa, con el color de su estatus. Solo salen
 * los que tienen coordenadas en el maestro de clientes de logística; la
 * lista debajo del mapa los tiene a todos. */
export function MapaVisitas({
  clientes,
  onElegir,
}: {
  clientes: ClienteDeLaSemana[];
  /** Sin esto (hay una visita en curso) el globo no ofrece elegir. */
  onElegir?: (cliente: ClienteDeLaSemana) => void;
}) {
  const conUbicacion = clientes.filter((c): c is ConUbicacion => c.lat != null && c.lng != null);
  if (conUbicacion.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
        Ninguno de tus clientes tiene ubicación en el maestro de clientes: usa la lista de abajo.
      </p>
    );
  }
  const puntos: [number, number][] = conUbicacion.map((c) => [c.lat, c.lng]);

  return (
    <div className="space-y-1">
      <LeafletMap center={puntos[0]} zoom={12} bounds={puntos.length > 1 ? puntos : undefined} className="h-72 sm:h-80">
        {conUbicacion.map((c) => (
          <DespachoMarker key={`${c.empresa}|${c.codigo}`} position={[c.lat, c.lng]} tone={ESTATUS_VISITA_META[c.estatus].tone}>
            <div className="space-y-1 text-sm">
              <p className="font-medium text-foreground">{c.nombre}</p>
              <p className="text-muted-foreground">
                Cód. {c.codigo} · Ruta {c.ruta}
              </p>
              <StatusBadge {...ESTATUS_VISITA_META[c.estatus]} className="font-semibold" />
              {onElegir && c.estatus !== "en_cliente" && (
                <Button size="sm" className="mt-1 w-full" onClick={() => onElegir(c)}>
                  Elegir este cliente
                </Button>
              )}
            </div>
          </DespachoMarker>
        ))}
      </LeafletMap>
      <p className="text-xs text-muted-foreground">
        {conUbicacion.length} de {clientes.length} clientes tienen ubicación en el maestro de clientes.
      </p>
    </div>
  );
}
