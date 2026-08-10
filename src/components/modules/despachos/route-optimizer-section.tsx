"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { RouteIcon } from "lucide-react";
import { toast } from "sonner";
import { apiPost } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { geoJsonToLatLngPath } from "@/lib/route-analysis/common";
import { calcularMejorRuta, type RutaResultado } from "@/lib/route-analysis/find-path";
import { getMejorRutaByDespachoId, type DespachoConDetalle } from "@/lib/mock-data";

type RutaCalculadaApi = {
  distanciaEstimadaKm: number;
  tiempoEstimadoMin: number;
  ruta: { lat: number; lng: number }[];
};

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
  const [ruta, setRuta] = useState<RutaResultado | null>(() =>
    despacho.rutaCalculada ? getMejorRutaByDespachoId(despacho.id) ?? null : null
  );

  const destino = despacho.destinoCliente;
  const tieneCoordenadas = destino.lat != null && destino.lng != null;

  function calcular() {
    if (!tieneCoordenadas) return;
    setCalculando(true);
    // Simula la latencia de una llamada real a un servicio de analisis de redes.
    setTimeout(() => {
      const resultado = calcularMejorRuta(
        despacho.id,
        { lat: despacho.origen.lat, lng: despacho.origen.lng },
        { lat: destino.lat!, lng: destino.lng! }
      );
      setRuta(resultado);
      setCalculando(false);
    }, 600);
  }

  async function confirmar() {
    setConfirmando(true);
    try {
      const resultado = await apiPost<RutaCalculadaApi>(`/despachos/${despacho.id}/ruta`);
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
            <LeafletMap center={center} zoom={path && path.length > 2 && ruta.distanciaKm > 100 ? 7 : 12} className="h-72">
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
                Ruta estimada (simulada) — en Fase 2 se calculará contra un servicio real de análisis de redes.
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
