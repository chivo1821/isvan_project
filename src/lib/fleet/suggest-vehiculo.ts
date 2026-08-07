// Sugerencia (mock) del mejor vehiculo disponible para un despacho pendiente,
// segun disponibilidad, capacidad y si requiere cadena de frio. En Fase 2 esto
// se reemplaza por un algoritmo real (o una llamada al backend) que considere
// tambien la ruta calculada en lib/route-analysis/find-path.ts. Como la
// empresa opera con un unico almacen, la cercania al origen ya no es un
// criterio (todos los vehiculos parten del mismo lugar) — se prioriza el
// mejor ajuste de capacidad (evitar usar un camion grande para un pedido chico).

import { getDespachoConDetalle, getVehiculosDisponibles, type Vehiculo } from "@/lib/mock-data";

// Peso promedio por unidad, ya que el catalogo de productos no registra peso
// individual. Es una aproximacion solo para esta fase mock.
const PESO_PROMEDIO_KG: Record<string, number> = {
  HELADO: 0.4,
  PIZZA: 0.6,
};

export type SugerenciaVehiculo = {
  vehiculo: Vehiculo;
  holguraKg: number;
  motivos: string[];
};

function estimarPesoKgDespacho(itemsConProducto: { cantidad: number; producto: { categoria: string } }[]): number {
  return itemsConProducto.reduce(
    (sum, item) => sum + item.cantidad * (PESO_PROMEDIO_KG[item.producto.categoria] ?? 0.5),
    0
  );
}

/**
 * Devuelve hasta 3 vehiculos sugeridos para el despacho, priorizando el
 * mejor ajuste de capacidad (el que sobra menos, sin quedar corto). Solo
 * considera vehiculos FUNCIONAL, no asignados a otro despacho activo, con
 * capacidad suficiente y refrigeracion si el despacho lo requiere.
 */
export function sugerirVehiculos(despachoId: string): SugerenciaVehiculo[] {
  const despacho = getDespachoConDetalle(despachoId);
  if (!despacho) return [];

  const pesoEstimadoKg = Math.round(estimarPesoKgDespacho(despacho.itemsConProducto));
  const requiereCadenaFrio = despacho.itemsConProducto.some((item) => item.producto.requiereCadenaFrio);

  const candidatos = getVehiculosDisponibles()
    .filter((v) => v.capacidadKg >= pesoEstimadoKg)
    .filter((v) => !requiereCadenaFrio || v.tieneRefrigeracion);

  const conHolgura = candidatos.map((vehiculo) => {
    const holguraKg = vehiculo.capacidadKg - pesoEstimadoKg;

    const motivos: string[] = [
      `Capacidad suficiente (${vehiculo.capacidadKg.toLocaleString("es-VE")} kg / ~${pesoEstimadoKg} kg estimados)`,
    ];
    if (requiereCadenaFrio) motivos.push("Con refrigeración");

    return { vehiculo, holguraKg, motivos };
  });

  return conHolgura.sort((a, b) => a.holguraKg - b.holguraKg).slice(0, 3);
}
