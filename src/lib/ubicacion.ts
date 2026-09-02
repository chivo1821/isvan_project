// Criterio único de "cliente sin ubicación" en el frontend — espejo de
// backend/app/core/ubicacion.py. Un cliente no tiene ubicación usable si le
// faltan las coordenadas O si están en (0, 0): ese punto cae en el golfo de
// Guinea, a miles de km de Venezuela, así que cuando aparece es porque el
// dato venía vacío en el origen y se cargó como cero.

/** ~0,11 m en el ecuador: cualquier cliente real está muy lejos del (0, 0). */
const TOLERANCIA_GRADOS = 1e-6;

type ConCoordenadas = { lat?: number | null; lng?: number | null };

export function sinUbicacion({ lat, lng }: ConCoordenadas): boolean {
  if (lat == null || lng == null) return true;
  return Math.abs(lat) < TOLERANCIA_GRADOS && Math.abs(lng) < TOLERANCIA_GRADOS;
}

/** Etiqueta para mostrar por qué no se puede ubicar al cliente, o `null` si
 * sus coordenadas sirven. Distingue el dato que falta del dato erróneo, que
 * es lo que hay que ir a corregir al sistema de origen. */
export function motivoSinUbicacion(cliente: ConCoordenadas): string | null {
  if (cliente.lat == null || cliente.lng == null) return "Sin coordenadas";
  if (sinUbicacion(cliente)) return "Ubicación en 0,0";
  return null;
}
