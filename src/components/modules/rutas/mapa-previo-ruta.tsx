"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { MapPinOffIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Almacen, Cliente, Despacho } from "@/lib/mock-data";
import type { PuntoCliente } from "./mapa-previo-ruta-capas";

const LeafletMap = dynamic(() => import("@/components/map/leaflet-map").then((m) => m.LeafletMap), {
  ssr: false,
  loading: () => <div className="h-64 w-full animate-pulse rounded-lg bg-muted" />,
});
const CapasMapaPrevio = dynamic(() => import("./mapa-previo-ruta-capas").then((m) => m.CapasMapaPrevio), {
  ssr: false,
});

type DespachoConCliente = Despacho & { destinoCliente: Cliente };

// Caracas, por si no hay ni almacén ni clientes con ubicación.
const CENTRO_POR_DEFECTO: [number, number] = [10.4806, -66.9036];

/** Vista previa de dónde quedan los clientes de la ruta que se está
 * armando: los elegidos resaltados y los demás pendientes en gris, para
 * despejar dudas de ubicación y sumar o quitar clientes desde el mapa. El
 * orden de las paradas no se muestra: se calcula al crear la ruta. */
export function MapaPrevioRuta({
  despachos,
  seleccionados,
  almacen,
  onCambiar,
}: {
  despachos: DespachoConCliente[];
  seleccionados: Set<string>;
  almacen?: Almacen | null;
  onCambiar: (despachoIds: string[], incluir: boolean) => void;
}) {
  // "elegidos": encuadra lo elegido (y el almacén); "todos": todos los pendientes.
  const [vista, setVista] = useState<"elegidos" | "todos">("elegidos");

  const porCliente = new Map<string, PuntoCliente>();
  const sinUbicacion = new Map<string, Cliente>();
  for (const d of despachos) {
    const c = d.destinoCliente;
    if (c.lat == null || c.lng == null) {
      if (seleccionados.has(d.id)) sinUbicacion.set(c.id, c);
      continue;
    }
    const punto = porCliente.get(c.id) ?? { cliente: { ...c, lat: c.lat, lng: c.lng }, despachos: [], elegidos: 0 };
    punto.despachos.push(d);
    if (seleccionados.has(d.id)) punto.elegidos += 1;
    porCliente.set(c.id, punto);
  }
  const puntos = [...porCliente.values()];
  const elegidos = puntos.filter((p) => p.elegidos > 0);

  const base = vista === "elegidos" && elegidos.length > 0 ? elegidos : puntos;
  const encuadre: [number, number][] = base.map((p) => [p.cliente.lat, p.cliente.lng]);
  if (almacen) encuadre.push([almacen.lat, almacen.lng]);
  const centro = encuadre[0] ?? CENTRO_POR_DEFECTO;

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="text-base">Dónde quedan</CardTitle>
        <div className="flex gap-1" role="group" aria-label="Qué encuadrar en el mapa">
          <Button
            size="sm"
            variant={vista === "elegidos" ? "secondary" : "ghost"}
            aria-pressed={vista === "elegidos"}
            onClick={() => setVista("elegidos")}
          >
            Lo elegido
          </Button>
          <Button
            size="sm"
            variant={vista === "todos" ? "secondary" : "ghost"}
            aria-pressed={vista === "todos"}
            onClick={() => setVista("todos")}
          >
            Todos los pendientes
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        <LeafletMap
          center={centro}
          zoom={12}
          bounds={encuadre.length > 1 ? encuadre : undefined}
          className="h-64"
          arrastreConUnDedo={false}
        >
          <CapasMapaPrevio almacen={almacen} puntos={puntos} onCambiar={onCambiar} />
        </LeafletMap>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <li className="flex items-center gap-1.5">
            <span className="inline-flex size-3.5 items-center justify-center rounded-[4px] bg-foreground text-[8px] font-semibold text-background">
              A
            </span>
            Almacén (salida)
          </li>
          <li className="flex items-center gap-1.5">
            <span className="size-3 rounded-full border-2 border-white bg-primary shadow-[0_0_0_1px_rgba(0,0,0,0.15)]" />
            En esta ruta
          </li>
          <li className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-full border border-muted-foreground bg-muted-foreground/35" />
            Pendiente, sin ruta
          </li>
        </ul>
        <p className="text-xs text-muted-foreground">
          Toca un punto para agregarlo o quitarlo. El orden de las paradas se calcula al crear la ruta.
        </p>
        {sinUbicacion.size > 0 && (
          <p className="flex items-start gap-1.5 text-xs text-warning">
            <MapPinOffIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>
              Sin ubicación en el maestro, no salen en el mapa:{" "}
              {[...sinUbicacion.values()].map((c) => `${c.nombre} (cód. ${c.codigo})`).join(", ")}
            </span>
          </p>
        )}
      </CardContent>
    </Card>
  );
}
