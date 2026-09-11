"use client";

import { CircleMarker, Popup } from "react-leaflet";
import { formatNumero, formatUsd } from "@/lib/constants";
import { formatFecha, type PuntoMapaVenta } from "@/lib/indicadores";

/** Un cliente en el mapa de ventas: el tamaño del círculo es su venta. */
export function VentaCircle({ punto, radio, color }: { punto: PuntoMapaVenta; radio: number; color: string }) {
  return (
    <CircleMarker
      center={[punto.lat, punto.lng]}
      radius={radio}
      pathOptions={{ color, weight: 1, fillColor: color, fillOpacity: 0.45 }}
    >
      <Popup>
        <div className="space-y-0.5 text-sm">
          <p className="font-medium text-foreground">{punto.nombre ?? punto.codigo}</p>
          <p className="text-muted-foreground">
            Cód. {punto.codigo}
            {punto.ruta && ` · Ruta ${punto.ruta}`}
            {punto.tipo && ` · ${punto.tipo}`}
          </p>
          <p>
            Venta neta <span className="font-semibold">{formatUsd(punto.ventaNeta, 2)}</span> ·{" "}
            {formatNumero(punto.litros, 1)} L
          </p>
          <p className="text-muted-foreground">
            Última compra {formatFecha(punto.ultimaCompra)}
            {punto.ciudad && ` · ${punto.ciudad}`}
          </p>
        </div>
      </Popup>
    </CircleMarker>
  );
}
