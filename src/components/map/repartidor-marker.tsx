"use client";

import L from "leaflet";
import type { ReactNode } from "react";
import { Marker, Popup } from "react-leaflet";

// Un repartidor con la app: más grande que los puntos de las rutas, con su
// nombre al lado y siempre por encima, para que no se pierda entre ellos.
// Azul si está mandando su ubicación; ámbar si lleva rato sin señal.
const AZUL = "#1f8fd6";
const AMBAR = "#f5a623";

function escapar(texto: string) {
  return texto.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function icono(nombre: string, sinSenal: boolean) {
  const color = sinSenal ? AMBAR : AZUL;
  // Solo el primer nombre: «Repartidor de prueba (app)» → «Repartidor».
  const corto = escapar(nombre.trim().split(/\s+/)[0] ?? "");
  return L.divIcon({
    className: "",
    html:
      `<div style="position:relative;width:26px;height:26px">` +
      `<span style="position:absolute;inset:-6px;border-radius:9999px;background:${color};opacity:.25"></span>` +
      `<span style="position:absolute;inset:0;border-radius:9999px;background:${color};border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35)"></span>` +
      `<span style="position:absolute;left:32px;top:50%;transform:translateY(-50%);white-space:nowrap;` +
      `background:#fff;color:#2b211a;font:600 12px/1.2 system-ui,sans-serif;padding:2px 6px;border-radius:6px;` +
      `box-shadow:0 1px 3px rgba(0,0,0,.25);border:1px solid ${color}">${corto}</span>` +
      `</div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
    popupAnchor: [0, -14],
  });
}

export function RepartidorMarker({
  position,
  nombre,
  sinSenal,
  children,
}: {
  position: [number, number];
  nombre: string;
  sinSenal: boolean;
  children?: ReactNode;
}) {
  return (
    <Marker position={position} icon={icono(nombre, sinSenal)} zIndexOffset={1000}>
      {children && <Popup>{children}</Popup>}
    </Marker>
  );
}
