"use client";

import dynamic from "next/dynamic";
import { estadoDeParada, formatHora, type Tone } from "@/lib/constants";
import { StatusBadge } from "@/components/shared/status-badge";
import type { Cliente, Despacho, RutaPunto } from "@/lib/mock-data";

const LeafletMap = dynamic(() => import("@/components/map/leaflet-map").then((m) => m.LeafletMap), {
  ssr: false,
  loading: () => <div className="h-[26rem] w-full animate-pulse rounded-lg bg-muted" />,
});
const DespachoMarker = dynamic(() => import("@/components/map/despacho-marker").then((m) => m.DespachoMarker), {
  ssr: false,
});
const RoutePolyline = dynamic(() => import("@/components/map/route-polyline").then((m) => m.RoutePolyline), {
  ssr: false,
});

// Color del punto de salida (el almacén). Las paradas se colorean con el
// estado de SU despacho, no con el del RutaPunto: así el mapa cambia de
// color en cuanto el repartidor marca la entrega, sin esperar a que la
// página vuelva a pedir el trazado completo (miles de puntos).
const TONE_POR_ESTADO: Record<RutaPunto["estado"], Tone> = {
  salida: "primary",
  en_ruta: "info",
  parada: "warning",
  entregado: "success",
};

type ParadaConCliente = Despacho & { destinoCliente: Cliente };

export function SeguimientoDetalleMap({
  ruta,
  paradas = [],
  className = "h-[26rem]",
}: {
  ruta: RutaPunto[];
  /** Despachos de la ruta, para poder decir en el globo del mapa a qué
   * cliente corresponde cada punto y cómo va su entrega. */
  paradas?: ParadaConCliente[];
  className?: string;
}) {
  const path: [number, number][] = ruta.map((p) => [p.lat, p.lng]);
  const center = path[Math.floor(path.length / 2)] ?? [10.16, -68.0077];
  const porDespachoId = new Map(paradas.map((d) => [d.id, d]));

  // `ruta` es el trazado completo (puede traer miles de vertices del camino
  // real por la red vial, no solo unos pocos puntos de ejemplo) — solo se
  // marcan la salida y las paradas reales (llegada/entrega a un despacho),
  // el resto de los puntos solo forma la linea de la ruta.
  const puntosDestacados = ruta.filter((p, index) => index === 0 || p.paradaDespachoId != null);

  return (
    <LeafletMap center={center} zoom={9} bounds={path.length > 1 ? path : undefined} className={className}>
      {path.length > 1 && <RoutePolyline positions={path} />}
      {puntosDestacados.map((punto) => {
        const despacho = punto.paradaDespachoId ? porDespachoId.get(punto.paradaDespachoId) : undefined;
        return (
          <DespachoMarker
            key={punto.id}
            position={[punto.lat, punto.lng]}
            tone={despacho ? estadoDeParada(despacho).tone : TONE_POR_ESTADO[punto.estado]}
          >
            <div className="space-y-0.5 text-sm">
              {despacho ? (
                <>
                  <p className="font-medium text-foreground">
                    {despacho.ordenEnRuta != null && `${despacho.ordenEnRuta}. `}
                    {despacho.destinoCliente.nombre}
                  </p>
                  <p className="flex items-center gap-1.5 text-muted-foreground">
                    {despacho.numero}
                    <StatusBadge {...estadoDeParada(despacho)} className="font-semibold" />
                  </p>
                  <p className="text-muted-foreground">
                    {despacho.destinoCliente.direccion}, {despacho.destinoCliente.ciudad}
                  </p>
                  {(despacho.llegadaEn || despacho.entregadoEn) && (
                    <p className="text-muted-foreground">
                      {despacho.llegadaEn && `Llegada ${formatHora(despacho.llegadaEn)}`}
                      {despacho.llegadaEn && despacho.entregadoEn && " · "}
                      {despacho.entregadoEn && `Entrega ${formatHora(despacho.entregadoEn)}`}
                    </p>
                  )}
                </>
              ) : (
                <p className="font-medium capitalize">{punto.estado.replace("_", " ")}</p>
              )}
              {punto.descripcion && <p className="text-muted-foreground">{punto.descripcion}</p>}
            </div>
          </DespachoMarker>
        );
      })}
    </LeafletMap>
  );
}
