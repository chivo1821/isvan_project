"use client";

import { CircleMarker, useMapEvents } from "react-leaflet";

/** El punto de una pregunta de ubicación: un toque en el mapa lo mueve ahí. */
export function PuntoElegible({
  punto,
  onElegir,
  color = "#E8492C",
}: {
  punto: { lat: number; lng: number } | null;
  onElegir: (lat: number, lng: number) => void;
  color?: string;
}) {
  useMapEvents({
    click(e) {
      onElegir(e.latlng.lat, e.latlng.lng);
    },
  });
  if (!punto) return null;
  return (
    <CircleMarker
      center={[punto.lat, punto.lng]}
      radius={9}
      pathOptions={{ color, weight: 3, fillColor: color, fillOpacity: 0.35 }}
    />
  );
}
