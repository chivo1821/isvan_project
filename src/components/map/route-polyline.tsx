"use client";

import { Polyline } from "react-leaflet";

export function RoutePolyline({
  positions,
  color = "#e8492c",
}: {
  positions: [number, number][];
  color?: string;
}) {
  return <Polyline positions={positions} pathOptions={{ color, weight: 4, opacity: 0.85 }} />;
}
