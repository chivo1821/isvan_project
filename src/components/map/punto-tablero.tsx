"use client";

import Link from "next/link";
import type { LatLngExpression, Map as MapaLeaflet } from "leaflet";
import { CircleMarker, Popup, useMap } from "react-leaflet";
import { EncuestaEnPopup } from "@/components/modules/censo/encuesta-popup";
import type { PuntoTablero } from "@/lib/censo";
import type { DefinicionFormulario } from "@/lib/formulario/motor";

// El popup trae la encuesta entera y crece despues de abrirse (se pide en ese
// momento): el ajuste automatico de Leaflet llega antes que el contenido.
// En vez de eso, al tocar el punto se lleva al centro y abajo del mapa, y el
// popup (de alto fijo, ver encuesta-popup.tsx) cabe encima.
const MARGEN_INFERIOR_PX = 24;

function acomodar(mapa: MapaLeaflet, donde: LatLngExpression) {
  const tam = mapa.getSize();
  const punto = mapa.latLngToContainerPoint(donde);
  mapa.panBy([punto.x - tam.x / 2, punto.y - (tam.y - MARGEN_INFERIOR_PX)], { animate: false });
}

// Mismos colores en el mapa y en su leyenda (tablero-censo.tsx).
export const COLOR_COMPETENCIA = { Si: "#E8492C", No: "#2563EB", otro: "#9CA3AF" } as const;

/** Un censo en el mapa del tablero. El color dice si vende helados de la
 * competencia; el popup trae la encuesta completa, con sus fotos (las de la
 * página por la API; las importadas, del servidor de Survey123). */
export function PuntoTableroCenso({ punto, definicion }: { punto: PuntoTablero; definicion: DefinicionFormulario }) {
  const mapa = useMap();
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
      eventHandlers={{ click: () => acomodar(mapa, [punto.lat, punto.lng]) }}
    >
      <Popup maxWidth={340} minWidth={280} autoPan={false}>
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
