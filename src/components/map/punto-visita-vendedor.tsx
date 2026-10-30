"use client";

import L from "leaflet";
import { Marker, Popup } from "react-leaflet";
import { formatDateTime, formatHora } from "@/lib/constants";
import { estiloMarca, estiloMarcaHtml, type MarcaVendedor } from "@/lib/marcas-vendedor";
import type { VisitaEnMapa } from "@/lib/vendedor";

// Un ícono por marca, compartido por todos los puntos del mismo vendedor.
const iconos = new Map<string, L.DivIcon>();
function icono(m: MarcaVendedor) {
  const clave = `${m.forma}-${m.color}`;
  let i = iconos.get(clave);
  if (!i) {
    i = L.divIcon({
      className: "",
      html: `<span style="${estiloMarcaHtml(m, 14)}"></span>`,
      iconSize: [14, 14],
      iconAnchor: [7, 7],
      popupAnchor: [0, -8],
    });
    iconos.set(clave, i);
  }
  return i;
}

/** Una visita en el mapa del resumen: dónde estaba el teléfono al
 * empezarla, con la marca (color y forma) de su vendedor. El anillo blanco
 * separa los puntos que se pisan. */
export function PuntoVisitaVendedor({
  visita,
  vendedor,
  marca,
  distanciaMaxM,
}: {
  visita: VisitaEnMapa;
  vendedor: string;
  marca: MarcaVendedor;
  distanciaMaxM: number;
}) {
  const lejos = visita.distanciaClienteM != null && visita.distanciaClienteM > distanciaMaxM;
  return (
    <Marker position={[visita.lat, visita.lng]} icon={icono(marca)}>
      <Popup>
        <div className="space-y-1 text-sm">
          <p className="flex items-center gap-1.5 font-medium text-foreground">
            <span style={estiloMarca(marca, 10)} aria-hidden />
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
    </Marker>
  );
}
