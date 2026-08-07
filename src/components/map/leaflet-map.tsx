"use client";

import type { ReactNode } from "react";
import { MapContainer, TileLayer } from "react-leaflet";
import { cn } from "@/lib/utils";

// Componente base del mapa. Se debe cargar via next/dynamic con ssr:false en
// las paginas que lo usan, porque Leaflet accede a `window`.
export function LeafletMap({
  center,
  zoom = 7,
  className,
  scrollWheelZoom = false,
  children,
}: {
  center: [number, number];
  zoom?: number;
  className?: string;
  scrollWheelZoom?: boolean;
  children?: ReactNode;
}) {
  return (
    <MapContainer
      center={center}
      zoom={zoom}
      scrollWheelZoom={scrollWheelZoom}
      className={cn("z-0 h-64 w-full rounded-lg", className)}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {children}
    </MapContainer>
  );
}
