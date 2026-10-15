"use client";

import Link from "next/link";
import { CircleMarker, Popup } from "react-leaflet";
import { EncuestaEnPopup } from "@/components/modules/censo/encuesta-popup";
import type { PuntoTablero } from "@/lib/censo";
import type { DefinicionFormulario } from "@/lib/formulario/motor";

// Mismos colores en el mapa y en su leyenda (tablero-censo.tsx).
export const COLOR_COMPETENCIA = { Si: "#E8492C", No: "#2563EB", otro: "#9CA3AF" } as const;

/** Un censo en el mapa del tablero. El color dice si vende helados de la
 * competencia; el popup trae la encuesta completa, con sus fotos (las de la
 * página por la API; las importadas, del servidor de Survey123). */
export function PuntoTableroCenso({ punto, definicion }: { punto: PuntoTablero; definicion: DefinicionFormulario }) {
  const color =
    punto.vendeCompetencia === "Si"
      ? COLOR_COMPETENCIA.Si
      : punto.vendeCompetencia === "No"
        ? COLOR_COMPETENCIA.No
        : COLOR_COMPETENCIA.otro;
  return (
    <CircleMarker
      center={[punto.lat, punto.lng]}
      radius={6}
      pathOptions={{ color, weight: 1.5, fillColor: color, fillOpacity: 0.5 }}
    >
      <Popup maxWidth={340} minWidth={280}>
        <div className="space-y-1 text-sm">
          <Link href={`/censo/${punto.id}`} className="font-medium">
            {punto.nombre ?? "Sin nombre"}
          </Link>
          <p className="text-xs text-muted-foreground">
            {[punto.encuestador, punto.fecha, punto.origen === "SURVEY123" ? "Survey123" : null]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <EncuestaEnPopup id={punto.id} definicion={definicion} />
        </div>
      </Popup>
    </CircleMarker>
  );
}
