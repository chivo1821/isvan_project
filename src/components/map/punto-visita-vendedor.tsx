"use client";

import { CircleMarker, Popup } from "react-leaflet";
import { formatDateTime, formatHora } from "@/lib/constants";
import type { VisitaEnMapa } from "@/lib/vendedor";

/** Una visita en el mapa del resumen: dónde estaba el teléfono al
 * empezarla, con el color de su vendedor. El anillo blanco separa los
 * puntos que se pisan. */
export function PuntoVisitaVendedor({
  visita,
  vendedor,
  color,
  distanciaMaxM,
}: {
  visita: VisitaEnMapa;
  vendedor: string;
  color: string;
  distanciaMaxM: number;
}) {
  const lejos = visita.distanciaClienteM != null && visita.distanciaClienteM > distanciaMaxM;
  return (
    <CircleMarker
      center={[visita.lat, visita.lng]}
      radius={6}
      pathOptions={{ color: "#ffffff", weight: 2, fillColor: color, fillOpacity: 0.9 }}
    >
      <Popup>
        <div className="space-y-1 text-sm">
          <p className="flex items-center gap-1.5 font-medium text-foreground">
            <span className="inline-block size-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
            {vendedor}
          </p>
          <p className="text-foreground">
            {visita.cliente ? `${visita.cliente} · ` : ""}Cód. {visita.codigoCliente}
          </p>
          <p className="text-xs text-muted-foreground">
            Llegó el {formatDateTime(visita.llegadaEn)}
            {visita.salidaEn ? ` · salió a las ${formatHora(visita.salidaEn)}` : " · visita sin terminar"}
          </p>
          {visita.distanciaClienteM != null && (
            <p className={lejos ? "text-xs text-warning" : "text-xs text-muted-foreground"}>
              A ~{Math.round(visita.distanciaClienteM)} m del cliente{lejos && " (lejos)"}
            </p>
          )}
        </div>
      </Popup>
    </CircleMarker>
  );
}
