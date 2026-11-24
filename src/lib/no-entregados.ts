import type { NoEntregado } from "@/lib/mock-data";

/** Quién la sacó de la ruta, en palabras de la oficina. */
export const ETIQUETA_NO_ENTREGADO: Record<NoEntregado["alcance"], string> = {
  REPARTIDOR: "No se pudo entregar",
  DESPACHO: "Sacado de la ruta",
  RUTA: "Ruta reversada",
};

/** Mezcla las paradas de la ruta con las que salieron sin entregarse, cada
 * una en el lugar que tenía (las de antes, sin lugar guardado, al final). */
export function conNoEntregadas<T extends { ordenEnRuta?: number | null }>(
  paradas: T[],
  noEntregados: NoEntregado[] = []
): ({ tipo: "parada"; parada: T } | { tipo: "no"; parada: NoEntregado })[] {
  const todas = [
    ...paradas.map((p, i) => ({ tipo: "parada" as const, parada: p, orden: p.ordenEnRuta ?? i + 1, i })),
    ...noEntregados.map((n, i) => ({
      tipo: "no" as const,
      parada: n,
      orden: n.ordenEnRuta ?? Number.MAX_SAFE_INTEGER,
      i: paradas.length + i,
    })),
  ];
  todas.sort((a, b) => a.orden - b.orden || a.i - b.i);
  return todas.map(({ tipo, parada }) => (tipo === "parada" ? { tipo, parada: parada as T } : { tipo, parada: parada as NoEntregado }));
}
