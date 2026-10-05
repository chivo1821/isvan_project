"use client";

import Link from "next/link";
import { CircleMarker, Popup } from "react-leaflet";

/** Un censo en el mapa de la revisión. Nuevo y existente con colores
 * distintos para ver de un vistazo dónde están los clientes nuevos. */
export function PuntoCenso({
  punto,
}: {
  punto: { id: string; lat: number; lng: number; nombreComercio: string | null; tipoCliente: string | null };
}) {
  const color = punto.tipoCliente === "Nuevo" ? "#E8492C" : "#2563EB";
  return (
    <CircleMarker
      center={[punto.lat, punto.lng]}
      radius={7}
      pathOptions={{ color, weight: 2, fillColor: color, fillOpacity: 0.45 }}
    >
      <Popup>
        <div className="space-y-0.5 text-sm">
          <Link href={`/censo/${punto.id}`} className="font-medium">
            {punto.nombreComercio ?? "Sin nombre"}
          </Link>
          {punto.tipoCliente && <p className="text-muted-foreground">{punto.tipoCliente}</p>}
        </div>
      </Popup>
    </CircleMarker>
  );
}
