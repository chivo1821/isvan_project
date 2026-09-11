"use client";

import dynamic from "next/dynamic";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatNumero } from "@/lib/constants";
import type { DatosMapaVentas } from "@/lib/indicadores";

const LeafletMap = dynamic(() => import("@/components/map/leaflet-map").then((m) => m.LeafletMap), {
  ssr: false,
  loading: () => <div className="h-[28rem] w-full animate-pulse rounded-lg bg-muted" />,
});
const VentaCircle = dynamic(() => import("@/components/map/venta-circle").then((m) => m.VentaCircle), {
  ssr: false,
});

// Los mismos colores de la interfaz (ver despacho-marker.tsx).
const COLOR_POR_TIPO: Record<string, string> = {
  TRADICIONAL: "#e8492c",
  MODERNO: "#1f8fd6",
  DISTRIBUIDORES: "#2e9e5b",
};
const COLOR_SIN_TIPO = "#8a7a68";
const RADIO_MINIMO = 4;
const RADIO_EXTRA_MAXIMO = 16;

/** Cruce con logística: los clientes que compraron, en el mapa, con las
 * coordenadas del maestro de clientes (el extracto de ventas no las trae). */
export function MapaVentas({ mapa }: { mapa: DatosMapaVentas }) {
  const maximo = Math.max(1, ...mapa.puntos.map((p) => p.ventaNeta));
  const posiciones = mapa.puntos.map((p) => [p.lat, p.lng] as [number, number]);
  const tipos = [...new Set(mapa.puntos.map((p) => p.tipo ?? ""))].filter(Boolean).sort();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Mapa de ventas</CardTitle>
        <p className="text-sm text-muted-foreground">
          {formatNumero(mapa.conUbicacion)} de {formatNumero(mapa.compradores)} clientes que compraron: los que están
          en el maestro de clientes de logística con coordenadas. El tamaño del círculo es la venta neta.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {mapa.puntos.length > 0 ? (
          <LeafletMap
            center={posiciones[0]}
            zoom={11}
            bounds={posiciones.length > 1 ? posiciones : undefined}
            className="h-[28rem]"
          >
            {mapa.puntos.map((p) => (
              <VentaCircle
                key={p.codigo}
                punto={p}
                // Raíz cuadrada: el área del círculo (no el radio) queda
                // proporcional a la venta.
                radio={RADIO_MINIMO + RADIO_EXTRA_MAXIMO * Math.sqrt(Math.max(p.ventaNeta, 0) / maximo)}
                color={COLOR_POR_TIPO[p.tipo ?? ""] ?? COLOR_SIN_TIPO}
              />
            ))}
          </LeafletMap>
        ) : (
          <p className="flex h-40 items-center justify-center text-center text-sm text-muted-foreground">
            Ningún cliente con compras en el período tiene ubicación en el maestro de clientes de logística.
          </p>
        )}
        {tipos.length > 0 && (
          <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
            {tipos.map((tipo) => (
              <span key={tipo} className="flex items-center gap-1.5">
                <span
                  className="size-2.5 rounded-full"
                  style={{ background: COLOR_POR_TIPO[tipo] ?? COLOR_SIN_TIPO }}
                />
                {tipo}
              </span>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
