"use client";

import L from "leaflet";
import { CircleMarker, Marker, Popup, Tooltip } from "react-leaflet";
import { Button } from "@/components/ui/button";
import { documentoDespacho } from "@/lib/constants";
import type { Almacen, Cliente, Despacho } from "@/lib/mock-data";

type DespachoConCliente = Despacho & { destinoCliente: Cliente };

/** Un cliente en el mapa con sus despachos pendientes (puede tener una
 * factura y una nota de entrega). */
export type PuntoCliente = {
  cliente: Cliente & { lat: number; lng: number };
  despachos: DespachoConCliente[];
  elegidos: number;
};

const COLOR_ELEGIDO = "#e8492c";
const COLOR_PENDIENTE = "#8a7a68";

const ICONO_ALMACEN = L.divIcon({
  className: "",
  html: `<span style="display:flex;width:22px;height:22px;align-items:center;justify-content:center;border-radius:6px;background:#2b2118;border:2px solid #ffffff;box-shadow:0 0 0 1px rgba(0,0,0,0.2);color:#ffffff;font:600 11px/1 system-ui,sans-serif">A</span>`,
  iconSize: [22, 22],
  iconAnchor: [11, 11],
  popupAnchor: [0, -12],
});

/** Las capas del mapa de vista previa (van dentro de LeafletMap). */
export function CapasMapaPrevio({
  almacen,
  puntos,
  onCambiar,
}: {
  almacen?: Almacen | null;
  puntos: PuntoCliente[];
  onCambiar: (despachoIds: string[], incluir: boolean) => void;
}) {
  // Los pendientes primero: así los elegidos quedan dibujados encima.
  const ordenados = [...puntos].sort((a, b) => Math.sign(a.elegidos) - Math.sign(b.elegidos));

  return (
    <>
      {almacen && (
        <Marker position={[almacen.lat, almacen.lng]} icon={ICONO_ALMACEN} zIndexOffset={1000}>
          <Tooltip direction="top" offset={[0, -10]}>
            {almacen.nombre} (salida)
          </Tooltip>
        </Marker>
      )}
      {ordenados.map((p) => {
        const todos = p.elegidos === p.despachos.length;
        const algunos = p.elegidos > 0;
        const ids = p.despachos.map((d) => d.id);
        return (
          <CircleMarker
            key={p.cliente.id}
            center={[p.cliente.lat, p.cliente.lng]}
            radius={algunos ? 8 : 6}
            pathOptions={
              algunos
                ? { color: "#ffffff", weight: 2, fillColor: COLOR_ELEGIDO, fillOpacity: todos ? 1 : 0.55 }
                : { color: COLOR_PENDIENTE, weight: 1.5, fillColor: COLOR_PENDIENTE, fillOpacity: 0.35 }
            }
          >
            <Tooltip direction="top" offset={[0, -6]}>
              {p.cliente.nombre} (cód. {p.cliente.codigo})
            </Tooltip>
            {/* Compacto: el mapa es chico. Sin <p>, que en Leaflet trae márgenes grandes. */}
            <Popup maxWidth={240} minWidth={200} autoPanPadding={[12, 12]}>
              <div className="space-y-1 font-sans text-xs leading-snug">
                <div className="text-sm font-medium text-foreground">{p.cliente.nombre}</div>
                <div className="text-muted-foreground">
                  Cód. {p.cliente.codigo}
                  {p.cliente.rutaComercial && ` · ${p.cliente.rutaComercial}`}
                </div>
                <div className="line-clamp-2 text-muted-foreground" title={p.cliente.direccion}>
                  {p.cliente.direccion}
                </div>
                <div className="text-foreground">{p.despachos.map((d) => documentoDespacho(d)).join(" · ")}</div>
                <Button
                  size="sm"
                  variant={todos ? "outline" : "default"}
                  className="mt-1 w-full"
                  onClick={() => onCambiar(ids, !todos)}
                >
                  {todos
                    ? "Quitar de la ruta"
                    : p.despachos.length > 1
                      ? `Agregar sus ${p.despachos.length} documentos`
                      : "Agregar a la ruta"}
                </Button>
              </div>
            </Popup>
          </CircleMarker>
        );
      })}
    </>
  );
}
