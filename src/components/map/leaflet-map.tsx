"use client";

import { useEffect, type ReactNode } from "react";
import type { LatLngBoundsExpression } from "leaflet";
import { MapContainer, TileLayer, useMap } from "react-leaflet";
import { cn } from "@/lib/utils";

// Ajusta el mapa para que todos los puntos de `bounds` queden visibles, en
// vez de depender de un `zoom` fijo adivinado a ojo (eso es lo que hacia que
// rutas largas o medianas se dibujaran fuera del contenedor visible).
function FitBounds({ bounds }: { bounds: LatLngBoundsExpression }) {
  const map = useMap();
  // Se recalcula por contenido (boundsKey), no por identidad del array —
  // los llamadores suelen construir `bounds` inline en cada render.
  const boundsKey = JSON.stringify(bounds);
  useEffect(() => {
    // El contenedor puede no tener su tamano final todavia justo al montar
    // (el div viene de un next/dynamic con loading skeleton, el layout de
    // grid/flex se esta asentando) — invalidateSize() antes de fitBounds
    // evita que Leaflet encuadre contra un tamano viejo o en cero. Se usa
    // setTimeout (no requestAnimationFrame, que no dispara en pestanas sin
    // compositing activo) y se reintenta si el contenedor todavia mide 0.
    let id: ReturnType<typeof setTimeout>;
    let intentos = 0;
    function intentar() {
      map.invalidateSize();
      const size = map.getSize();
      if ((size.x === 0 || size.y === 0) && intentos < 10) {
        intentos += 1;
        id = setTimeout(intentar, 50);
        return;
      }
      map.fitBounds(bounds, { padding: [32, 32], maxZoom: 14 });
    }
    id = setTimeout(intentar, 0);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, boundsKey]);
  return null;
}

// Leaflet 1.9 termina cada zoom animado (fitBounds, los botones + y -) con
// un temporizador de 250 ms. Si el mapa se desmonta antes (cambiar de
// empresa en el mapa de visitas, un filtro que deja el mapa vacio, irse a
// otra pantalla), map.remove() ya borro el panel y ese temporizador falla con
// "Cannot read properties of undefined (reading '_leaflet_pos')". Al
// desmontar se marca la animacion como terminada y el temporizador no hace
// nada.
function CortarZoomAlDesmontar() {
  const map = useMap();
  useEffect(
    () => () => {
      (map as unknown as { _animatingZoom?: boolean })._animatingZoom = false;
    },
    [map]
  );
  return null;
}

// Componente base del mapa. Se debe cargar via next/dynamic con ssr:false en
// las paginas que lo usan, porque Leaflet accede a `window`.
export function LeafletMap({
  center,
  zoom = 7,
  bounds,
  className,
  scrollWheelZoom = true,
  arrastreConUnDedo = true,
  children,
}: {
  center: [number, number];
  zoom?: number;
  /** Si se pasa, el mapa encuadra estos puntos en vez de usar `zoom` fijo. */
  bounds?: LatLngBoundsExpression;
  className?: string;
  scrollWheelZoom?: boolean;
  /** false: en pantallas táctiles el mapa se mueve con dos dedos y un dedo
   * sigue bajando la página (si no, al bajar se termina moviendo el mapa).
   * Con el mouse se arrastra igual. */
  arrastreConUnDedo?: boolean;
  children?: ReactNode;
}) {
  // Este componente solo corre en el navegador (next/dynamic con ssr:false).
  const tactil = window.matchMedia("(pointer: coarse)").matches;
  return (
    <MapContainer
      center={center}
      zoom={zoom}
      // Zoom snapping por defecto (1) redondea al entero mas cercano, lo que
      // puede empujar puntos de fitBounds justo fuera del padding calculado.
      // Un paso mas fino evita ese redondeo visible sin perder nitidez de tiles.
      zoomSnap={0.25}
      scrollWheelZoom={scrollWheelZoom}
      // Sin arrastre con un dedo, el pellizco de dos dedos acerca, aleja y
      // mueve el mapa (Leaflet sigue el punto medio de los dedos).
      dragging={arrastreConUnDedo || !tactil}
      className={cn("z-0 h-64 w-full rounded-lg", className)}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <CortarZoomAlDesmontar />
      {bounds && <FitBounds bounds={bounds} />}
      {children}
    </MapContainer>
  );
}
