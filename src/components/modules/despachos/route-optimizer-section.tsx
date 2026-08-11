"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { RouteIcon } from "lucide-react";
import { toast } from "sonner";
import { apiPost } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { geoJsonToLatLngPath, type GeoJsonLineString } from "@/lib/route-analysis/common";
import type { DespachoConDetalle } from "@/lib/mock-data";

type RutaResultado = {
  geometry: GeoJsonLineString;
  distanciaKm: number;
  tiempoMin: number;
};

type RutaCalculadaApi = {
  distanciaEstimadaKm: number;
  tiempoEstimadoMin: number;
  ruta: { lat: number; lng: number }[];
};

function rutaDesdeApi(resultado: RutaCalculadaApi): RutaResultado {
  return {
    geometry: resultado.ruta.map((p) => [p.lng, p.lat]),
    distanciaKm: resultado.distanciaEstimadaKm,
    tiempoMin: resultado.tiempoEstimadoMin,
  };
}

// Reconstruye el resultado a partir de los RutaPunto ya persistidos, para
// que un despacho con ruta confirmada la restaure al recargar la pagina.
function rutaDesdeDespachoPersistido(despacho: DespachoConDetalle): RutaResultado | null {
  if (!despacho.rutaCalculada || despacho.ruta.length === 0) return null;
  return {
    geometry: despacho.ruta.map((p) => [p.lng, p.lat]),
    distanciaKm: despacho.distanciaEstimadaKm ?? 0,
    tiempoMin: despacho.tiempoEstimadoMin ?? 0,
  };
}

const LeafletMap = dynamic(() => import("@/components/map/leaflet-map").then((m) => m.LeafletMap), {
  ssr: false,
  loading: () => <div className="h-72 w-full animate-pulse rounded-lg bg-muted" />,
});
const DespachoMarker = dynamic(() => import("@/components/map/despacho-marker").then((m) => m.DespachoMarker), {
  ssr: false,
});
const RoutePolyline = dynamic(() => import("@/components/map/route-polyline").then((m) => m.RoutePolyline), {
  ssr: false,
});

export function RouteOptimizerSection({ despacho }: { despacho: DespachoConDetalle }) {
  const [calculando, setCalculando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [confirmada, setConfirmada] = useState(despacho.rutaCalculada);
  const [ruta, setRuta] = useState<RutaResultado | null>(() => rutaDesdeDespachoPersistido(despacho));

  const destino = despacho.destinoCliente;
  const tieneCoordenadas = destino.lat != null && destino.lng != null;

  async function calcular() {
    if (!tieneCoordenadas) return;
    setCalculando(true);
    try {
      const resultado = await apiPost<RutaCalculadaApi>(`/despachos/${despacho.id}/ruta/preview`);
      setRuta(rutaDesdeApi(resultado));
    } catch (err) {
      toast.error("No se pudo calcular la ruta", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setCalculando(false);
    }
  }

  async function confirmar() {
    setConfirmando(true);
    try {
      const resultado = await apiPost<RutaCalculadaApi>(`/despachos/${despacho.id}/ruta`);
      setRuta(rutaDesdeApi(resultado));
      setConfirmada(true);
      toast.success("Ruta confirmada", {
        description: `Distancia estimada: ${resultado.distanciaEstimadaKm} km · Tiempo estimado: ${resultado.tiempoEstimadoMin} min.`,
      });
    } catch (err) {
      toast.error("No se pudo confirmar la ruta", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setConfirmando(false);
    }
  }

  const path = ruta ? geoJsonToLatLngPath(ruta.geometry) : null;
  const center: [number, number] = path ? path[Math.floor(path.length / 2)] : [despacho.origen.lat, despacho.origen.lng];
  const bounds: [number, number][] | undefined = path
    ? [[despacho.origen.lat, despacho.origen.lng], [destino.lat!, destino.lng!], ...path]
    : undefined;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Mejor ruta</CardTitle>
        {ruta && (
          <span className="text-sm text-muted-foreground">
            {ruta.distanciaKm.toLocaleString("es-VE")} km · ~{ruta.tiempoMin} min
          </span>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {!tieneCoordenadas ? (
          <p className="text-sm text-muted-foreground">
            El cliente destino no tiene coordenadas registradas; no se puede calcular una ruta.
          </p>
        ) : !ruta ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <RouteIcon className="size-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Calcula la mejor ruta entre {despacho.origen.nombre} y {destino.nombre}.
            </p>
            <Button onClick={calcular} disabled={calculando}>
              {calculando ? "Calculando..." : "Calcular ruta óptima"}
            </Button>
          </div>
        ) : (
          <>
            <LeafletMap center={center} zoom={12} bounds={bounds} className="h-72">
              <DespachoMarker position={[despacho.origen.lat, despacho.origen.lng]} tone="primary">
                {despacho.origen.nombre}
              </DespachoMarker>
              <DespachoMarker position={[destino.lat!, destino.lng!]} tone="info">
                {destino.nombre}
              </DespachoMarker>
              {path && <RoutePolyline positions={path} />}
            </LeafletMap>
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                Ruta calculada contra el servicio de análisis de redes (con respaldo automático si no responde).
              </p>
              {!confirmada ? (
                <Button size="sm" onClick={confirmar} disabled={confirmando}>
                  {confirmando ? "Confirmando..." : "Confirmar ruta"}
                </Button>
              ) : (
                <span className="text-xs font-medium text-success">Ruta confirmada</span>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
