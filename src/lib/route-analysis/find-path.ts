// Equivalente mock de network_analysis/page_1/public/js/analyses/findPath.js
// (FindPathAnalysis), que alla usa L.supermap.FindPathService contra un
// servicio de Transportation Analyst en SuperMap iServer (NETWORK_ANALYST_URL)
// para calcular la ruta optima entre un origen y un destino.
//
// Aqui, sin iServer conectado a este proyecto todavia, calcularMejorRuta()
// devuelve: (a) la ruta ya "calculada" en lib/mock-data/rutas-optimizadas.ts
// si el despacho es uno de los de ejemplo, o (b) una ruta sintetica generada
// a partir de la distancia en linea recta origen->destino. La firma de la
// funcion (recibe origen/destino, devuelve geometria + distancia + tiempo) es
// la que tendria la version real, para que sustituirla en Fase 2 no requiera
// tocar los componentes que la consumen.

import { FACTOR_VIALIDAD, VELOCIDAD_PROMEDIO_KMH, haversineKm, type LatLng } from "./common";
import { rutasOptimizadas, type RutaOptimizada } from "@/lib/mock-data/rutas-optimizadas";

export type RutaResultado = RutaOptimizada;

/**
 * Genera una ruta "de ejemplo" cuando no hay una entrada precalculada:
 * traza un punto intermedio desplazado perpendicularmente a la linea recta
 * origen->destino, para que se vea como una ruta y no como una linea recta.
 */
function generarRutaSintetica(origen: LatLng, destino: LatLng): RutaResultado {
  const distanciaRectaKm = haversineKm(origen, destino);

  const midLat = (origen.lat + destino.lat) / 2;
  const midLng = (origen.lng + destino.lng) / 2;
  // Vector perpendicular a la linea origen->destino, escalado segun la distancia,
  // para simular una curva de carretera en vez de una linea recta.
  const dx = destino.lng - origen.lng;
  const dy = destino.lat - origen.lat;
  const offset = 0.08 * Math.min(1, distanciaRectaKm / 50);
  const perpLat = midLat + dx * offset;
  const perpLng = midLng - dy * offset;

  const distanciaKm = Math.round(distanciaRectaKm * FACTOR_VIALIDAD * 10) / 10;
  const tiempoMin = Math.max(5, Math.round((distanciaKm / VELOCIDAD_PROMEDIO_KMH) * 60));

  return {
    geometry: [
      [origen.lng, origen.lat],
      [perpLng, perpLat],
      [destino.lng, destino.lat],
    ],
    distanciaKm,
    tiempoMin,
  };
}

/**
 * Calcula (mock) la mejor ruta origen -> destino para un despacho.
 * Si el despacho ya tiene una ruta de ejemplo precalculada, la reutiliza;
 * si no, genera una ruta sintetica basada en la distancia real entre los
 * puntos.
 */
export function calcularMejorRuta(despachoId: string, origen: LatLng, destino: LatLng): RutaResultado {
  const existente = rutasOptimizadas[despachoId];
  if (existente) return existente;
  return generarRutaSintetica(origen, destino);
}
