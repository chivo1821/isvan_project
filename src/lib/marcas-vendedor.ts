import type { CSSProperties } from "react";

// Marca de cada vendedor en el mapa de visitas: color + forma. Más de ocho
// colores ya no se distinguen en un mapa (los puntos se mezclan y el rojo y
// el naranja se confunden), así que los 8 de la paleta categórica se repiten
// con otra forma: círculos, después rombos y después cuadrados (24 marcas).
// Desde el vendedor 25, gris.
const COLORES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"];
const FORMAS = ["circulo", "rombo", "cuadrado"] as const;

export type MarcaVendedor = { color: string; forma: (typeof FORMAS)[number] };

export const MARCA_OTROS: MarcaVendedor = { color: "#8a8a86", forma: "circulo" };

/** La marca del vendedor en la posición `indice` de la tabla. */
export function marcaVendedor(indice: number): MarcaVendedor {
  const forma = FORMAS[Math.floor(indice / COLORES.length)];
  return forma ? { color: COLORES[indice % COLORES.length], forma } : MARCA_OTROS;
}

/** Estilo de la marca en `px` de lado. El rombo es un cuadrado girado y algo
 * más chico, para que ocupe lo mismo que las otras formas. */
export function estiloMarca(m: MarcaVendedor, px: number, anillo = false): CSSProperties {
  return {
    display: "inline-block",
    flexShrink: "0",
    boxSizing: "border-box",
    width: `${px}px`,
    height: `${px}px`,
    background: m.color,
    borderRadius: m.forma === "circulo" ? "9999px" : "2px",
    transform: m.forma === "rombo" ? "rotate(45deg) scale(0.82)" : undefined,
    border: anillo ? "2px solid #ffffff" : undefined,
    boxShadow: anillo ? "0 0 0 1px rgba(0,0,0,0.15)" : undefined,
  };
}

/** Lo mismo como atributo style de HTML, para los íconos de Leaflet. */
export function estiloMarcaHtml(m: MarcaVendedor, px: number) {
  return Object.entries(estiloMarca(m, px, true))
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k.replace(/[A-Z]/g, (l) => `-${l.toLowerCase()}`)}:${v}`)
    .join(";");
}
