"use client";

import Link from "next/link";
import { CircleMarker, Popup } from "react-leaflet";
import { API_URL } from "@/lib/api-client";
import type { PuntoTablero } from "@/lib/censo";

// Mismos colores en el mapa y en su leyenda (tablero-censo.tsx).
export const COLOR_COMPETENCIA = { Si: "#E8492C", No: "#2563EB", otro: "#9CA3AF" } as const;

const NOMBRE_FOTO: Record<string, string> = {
  foto_fachada: "Fachada",
  foto_activo: "Activo",
  foto_activo2: "Activo",
  foto_serial_activo: "Serial del activo",
};

/** Un censo en los mapas del tablero. En "competencia" el color dice si
 * vende helados de la competencia; en "imagenes" el popup trae las fotos
 * (las de la página por la API; las importadas, del servidor de Survey123). */
export function PuntoTableroCenso({ punto, modo }: { punto: PuntoTablero; modo: "competencia" | "imagenes" }) {
  const color =
    modo === "competencia"
      ? punto.vendeCompetencia === "Si"
        ? COLOR_COMPETENCIA.Si
        : punto.vendeCompetencia === "No"
          ? COLOR_COMPETENCIA.No
          : COLOR_COMPETENCIA.otro
      : punto.fotos.length
        ? "#7C3AED"
        : COLOR_COMPETENCIA.otro;
  return (
    <CircleMarker
      center={[punto.lat, punto.lng]}
      radius={6}
      pathOptions={{ color, weight: 1.5, fillColor: color, fillOpacity: 0.5 }}
    >
      <Popup maxWidth={modo === "imagenes" ? 320 : 260}>
        <div className="space-y-1 text-sm">
          <Link href={`/censo/${punto.id}`} className="font-medium">
            {punto.nombre ?? "Sin nombre"}
          </Link>
          <p className="text-xs text-muted-foreground">
            {[punto.tipoCliente, punto.empresa, punto.ruta, punto.encuestador, punto.fecha].filter(Boolean).join(" · ")}
          </p>
          {modo === "competencia" ? (
            <p className="text-xs">
              Competencia: {punto.vendeCompetencia ?? "sin dato"}
              {punto.marcas.length ? ` (${punto.marcas.join(", ")})` : ""}
              {punto.activoCompetencia === "Si" ? " · con activo de la competencia" : ""}
            </p>
          ) : punto.fotos.length === 0 ? (
            <p className="text-xs text-muted-foreground">Sin fotos</p>
          ) : (
            <div className="grid grid-cols-2 gap-1.5 pt-1">
              {punto.fotos.map((f) => {
                const url = f.id ? `${API_URL}/censo/fotos/${f.id}` : f.url!;
                return (
                  <a key={f.pregunta} href={url} target="_blank" rel="noreferrer" className="block text-xs">
                    {/* eslint-disable-next-line @next/next/no-img-element -- fotos de la API (con sesión) o de Survey123 */}
                    <img
                      src={url}
                      alt={NOMBRE_FOTO[f.pregunta] ?? f.pregunta}
                      loading="lazy"
                      className="h-24 w-full rounded border object-cover"
                    />
                    <span className="text-muted-foreground">{NOMBRE_FOTO[f.pregunta] ?? f.pregunta}</span>
                  </a>
                );
              })}
            </div>
          )}
        </div>
      </Popup>
    </CircleMarker>
  );
}
