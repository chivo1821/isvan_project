// Helpers portados de network_analysis/page_1 (public/js/analyses/common.js),
// donde buildAnalystParameter()/addGeoJSONToLayer()/fitToLayerBounds() preparan
// y dibujan el resultado de L.supermap.FindPathService contra un SuperMap
// iServer real. Aqui se mantiene la misma forma (mismos nombres, misma idea de
// "punto -> geometria de ruta dibujable") pero operando sobre datos mock, para
// que en Fase 2 solo haya que reemplazar la implementacion interna de
// find-path.ts por la llamada real al servicio.

export type LatLng = { lat: number; lng: number };

/** [lng, lat][], igual que una geometria GeoJSON LineString. */
export type GeoJsonLineString = [number, number][];

/** Convierte una geometria GeoJSON ([lng,lat]) al orden que espera Leaflet ([lat,lng]). */
export function geoJsonToLatLngPath(geometry: GeoJsonLineString): [number, number][] {
  return geometry.map(([lng, lat]) => [lat, lng]);
}

const EARTH_RADIUS_KM = 6371;

/** Distancia en linea recta entre dos puntos (formula de Haversine). */
export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Peso "factor de vialidad": una carretera real casi nunca es la linea recta
 * entre dos puntos. Se usa para estimar distancia/tiempo de forma mock a
 * partir de la distancia en linea recta, hasta que Fase 2 conecte un
 * NETWORK_ANALYST_URL real (ver find-path.ts).
 */
export const FACTOR_VIALIDAD = 1.3;
export const VELOCIDAD_PROMEDIO_KMH = 45;
