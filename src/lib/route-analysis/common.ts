// Helpers geometricos compartidos por los componentes de mapa. Portado de
// network_analysis/page_1 (public/js/analyses/common.js) — la parte de
// calculo de ruta en si vive ahora en el backend
// (backend/app/services/route_analysis.py), que llama al servicio real de
// SuperMap iServer con fallback a una sintesis mock.

/** [lng, lat][], igual que una geometria GeoJSON LineString. */
export type GeoJsonLineString = [number, number][];

/** Convierte una geometria GeoJSON ([lng,lat]) al orden que espera Leaflet ([lat,lng]). */
export function geoJsonToLatLngPath(geometry: GeoJsonLineString): [number, number][] {
  return geometry.map(([lng, lat]) => [lat, lng]);
}
