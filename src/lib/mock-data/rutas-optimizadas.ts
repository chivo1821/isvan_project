// MOCK DATA — reemplazar en Fase 2 por la respuesta real de
// src/lib/route-analysis/find-path.ts contra un SuperMap iServer.
//
// Rutas ya calculadas (uno o dos despachos "de ejemplo" para que sus paginas
// de detalle y el mapa de seguimiento muestren algo sin necesidad de pulsar
// el boton "Calcular ruta optima"). El resto de despachos usan la funcion
// calcularMejorRuta() de lib/route-analysis/find-path.ts, que genera una ruta
// sintetica cuando no hay una entrada aqui. Ambas parten del unico almacen
// de la empresa (Almacén Catia, Caracas).

export type RutaOptimizada = {
  /** [lng, lat][], coincide con el orden de RutaPunto de ese despacho */
  geometry: [number, number][];
  distanciaKm: number;
  tiempoMin: number;
};

export const rutasOptimizadas: Record<string, RutaOptimizada> = {
  "desp-2": {
    geometry: [
      [-66.944611, 10.512937],
      [-67.45, 10.35],
      [-68.0011, 10.1751],
    ],
    distanciaKm: 165,
    tiempoMin: 150,
  },
  "desp-7": {
    geometry: [
      [-66.944611, 10.512937],
      [-68.0, 10.16],
      [-68.75, 10.11],
      [-69.347, 10.0747],
    ],
    distanciaKm: 355,
    tiempoMin: 260,
  },
};
