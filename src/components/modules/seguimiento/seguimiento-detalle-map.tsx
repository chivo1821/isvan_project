"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { BatteryLowIcon, BatteryMediumIcon, MapPinIcon, SignalZeroIcon } from "lucide-react";
import { estadoDeParada, formatHora, type Tone } from "@/lib/constants";
import { StatusBadge } from "@/components/shared/status-badge";
import { haceCuanto, useSondeo, type RecorridoReal, type UltimaSenal } from "@/lib/seguimiento";
import { cn } from "@/lib/utils";
import type { Cliente, Despacho, NoEntregado, RutaPunto } from "@/lib/mock-data";

const LeafletMap = dynamic(() => import("@/components/map/leaflet-map").then((m) => m.LeafletMap), {
  ssr: false,
  loading: () => <div className="h-[26rem] w-full animate-pulse rounded-lg bg-muted" />,
});
const DespachoMarker = dynamic(() => import("@/components/map/despacho-marker").then((m) => m.DespachoMarker), {
  ssr: false,
});
const RepartidorMarker = dynamic(
  () => import("@/components/map/repartidor-marker").then((m) => m.RepartidorMarker),
  { ssr: false }
);
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

// El recorrido real (los puntos de la app) en azul, distinto del trazado
// calculado (naranja). En tránsito se vuelve a pedir solo, sin recargar.
const COLOR_RECORRIDO = "#1f8fd6";
const SONDEO_RECORRIDO_MS = 30_000;

export function SeguimientoDetalleMap({
  ruta,
  paradas = [],
  className = "h-[26rem]",
  arrastreConUnDedo = true,
  rutaId,
  recorridoInicial = null,
  enTransito = false,
  noEntregados = [],
}: {
  ruta: RutaPunto[];
  /** Despachos de la ruta, para poder decir en el globo del mapa a qué
   * cliente corresponde cada punto y cómo va su entrega. */
  paradas?: ParadaConCliente[];
  className?: string;
  /** Ver LeafletMap: false para que en el teléfono el mapa no atrape el dedo al bajar. */
  arrastreConUnDedo?: boolean;
  /** Con la ruta, se dibuja por dónde pasó de verdad (GET /rutas/{id}/recorrido). */
  rutaId?: string;
  recorridoInicial?: RecorridoReal | null;
  enTransito?: boolean;
  /** Las que salieron sin entregarse: en rojo, en la ubicación del cliente. */
  noEntregados?: NoEntregado[];
}) {
  const recorrido = useSondeo<RecorridoReal | null>(
    `/rutas/${encodeURIComponent(rutaId ?? "")}/recorrido`,
    recorridoInicial,
    SONDEO_RECORRIDO_MS,
    Boolean(rutaId) && enTransito
  );
  const real: [number, number][] = (recorrido?.puntos ?? []).map((p) => [p.lat, p.lng]);
  const ultima = recorrido?.ultima ?? null;
  const path: [number, number][] = ruta.map((p) => [p.lat, p.lng]);
  // El encuadre incluye por donde paso de verdad y donde esta ahora, pero se
  // fija al abrir: si siguiera cada punto nuevo, el mapa saltaria cada 30 s.
  const [encuadre] = useState<[number, number][]>(() => [
    ...path,
    ...(recorridoInicial?.puntos ?? []).map((p): [number, number] => [p.lat, p.lng]),
    ...(recorridoInicial?.ultima ? [[recorridoInicial.ultima.lat, recorridoInicial.ultima.lng] as [number, number]] : []),
  ]);
  const center = path[Math.floor(path.length / 2)] ?? [10.16, -68.0077];
  const porDespachoId = new Map(paradas.map((d) => [d.id, d]));

  // `ruta` es el trazado completo (puede traer miles de vertices del camino
  // real por la red vial, no solo unos pocos puntos de ejemplo) — solo se
  // marcan la salida y las paradas reales (llegada/entrega a un despacho),
  // el resto de los puntos solo forma la linea de la ruta.
  const puntosDestacados = ruta.filter((p, index) => index === 0 || p.paradaDespachoId != null);

  return (
    <div className="space-y-2">
      {ultima && <Ahora ultima={ultima} enTransito={enTransito} />}
      <LeafletMap
        center={center}
        zoom={9}
        bounds={encuadre.length > 1 ? encuadre : undefined}
        className={className}
        arrastreConUnDedo={arrastreConUnDedo}
      >
        {path.length > 1 && <RoutePolyline positions={path} />}
        {real.length > 1 && <RoutePolyline positions={real} color={COLOR_RECORRIDO} />}
        {noEntregados
          .filter((n) => n.cliente.lat != null && n.cliente.lng != null)
          .map((n) => (
            <DespachoMarker key={`no-${n.despachoId}`} position={[n.cliente.lat!, n.cliente.lng!]} tone="destructive">
              <div className="space-y-0.5 text-sm">
                <p className="font-medium text-foreground">{n.cliente.nombre}</p>
                <p className="font-medium text-destructive">No se entregó · {n.numero}</p>
                <p className="text-muted-foreground">Motivo: {n.motivo}</p>
                <p className="text-xs text-muted-foreground">
                  {n.usuario} · {formatHora(n.fecha)}
                </p>
              </div>
            </DespachoMarker>
          ))}
        {ultima && (
          <RepartidorMarker
            position={[ultima.lat, ultima.lng]}
            nombre={ultima.repartidor}
            sinSenal={enTransito && ultima.sinSenal}
          >
            <div className="space-y-0.5 text-sm">
              <p className="font-medium">{ultima.repartidor}</p>
              <p className="text-muted-foreground">
                {enTransito ? "Aquí estaba" : "Última ubicación"} a las {formatHora(ultima.tomadaEn)}
                {ultima.precisionM != null && ` · ±${Math.round(ultima.precisionM)} m`}
              </p>
            </div>
          </RepartidorMarker>
        )}
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
    </div>
  );
}

/** Dónde y cuándo se vio por última vez al repartidor en esta ruta. */
function Ahora({ ultima, enTransito }: { ultima: UltimaSenal; enTransito: boolean }) {
  const sinSenal = enTransito && ultima.sinSenal;
  const bateriaBaja = ultima.bateria != null && ultima.bateria < 0.2;
  const IconoBateria = bateriaBaja ? BatteryLowIcon : BatteryMediumIcon;
  const hora = formatHora(ultima.tomadaEn);
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border bg-card px-3 py-2 text-sm",
        sinSenal ? "border-warning/60" : "border-border"
      )}
    >
      <span className="font-medium text-foreground">{ultima.repartidor}</span>
      {sinSenal ? (
        <span className="inline-flex items-center gap-1 font-medium text-warning">
          <SignalZeroIcon className="size-4" aria-hidden />
          {`Sin señal ${haceCuanto(ultima.minutosDesdeUltimo)} (a las ${hora})`}
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          <MapPinIcon className="size-4" aria-hidden />
          {`${enTransito ? "Ubicación vista" : "Última ubicación"} ${haceCuanto(ultima.minutosDesdeUltimo)} (a las ${hora})`}
        </span>
      )}
      {ultima.bateria != null && (
        <span className={cn("inline-flex items-center gap-1", bateriaBaja ? "text-destructive" : "text-muted-foreground")}>
          <IconoBateria className="size-4" aria-hidden />
          {`Batería ${Math.round(ultima.bateria * 100)} %`}
        </span>
      )}
    </div>
  );
}
