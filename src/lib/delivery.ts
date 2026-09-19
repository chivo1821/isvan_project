/** Módulo de delivery: lo que se le paga a cada motorizado por entrega.
 *
 * Las reglas del cálculo viven en backend/app/services/delivery.py; acá solo
 * están los tipos y la lectura de los filtros de la URL. */

export type RangoTabulador = {
  id: string;
  orden: number;
  /** null en el último rango: cubre todo lo que pase del anterior. */
  hastaKm: number | null;
  montoUsd: number;
};

export type ParadaDelivery = {
  rutaId: string;
  rutaNumero: string;
  clienteId: string;
  clienteCodigo: string;
  clienteNombre: string;
  ciudad: string;
  empresa: string;
  vehiculoId: string;
  placa: string;
  conductor: string | null;
  repartidorId: string | null;
  /** Día de la entrega, en hora de Venezuela. */
  fecha: string;
  entregadoEn: string;
  /** Cuántos documentos se entregaron en esa parada (se paga una vez). */
  despachos: number;
  numeros: string;
  km: number | null;
  /** "iserver" (red vial) o "estimada" (línea recta por un factor). */
  fuenteKm: string | null;
  montoUsd: number | null;
  rango: string | null;
  liquidada: boolean;
  liquidacionId: string | null;
  liquidadaEn: string | null;
};

export type MotorizadoDelivery = {
  repartidorId: string | null;
  conductor: string | null;
  placas: string[];
  entregas: number;
  despachos: number;
  km: number;
  totalUsd: number;
  pendienteUsd: number;
  liquidadoUsd: number;
  /** Entregas cuya distancia todavía no se pudo calcular: no tienen monto. */
  sinDistancia: number;
};

export type TotalesDelivery = {
  entregas: number;
  despachos: number;
  km: number;
  totalUsd: number;
  pendienteUsd: number;
  liquidadoUsd: number;
  promedioUsd: number | null;
  sinDistancia: number;
};

export type ResumenDelivery = {
  desde: string;
  hasta: string;
  totales: TotalesDelivery;
  porMotorizado: MotorizadoDelivery[];
  paradas: ParadaDelivery[];
  tabulador: RangoTabulador[];
  motorizados: { id: string; nombre: string; placa: string }[];
};

export type LiquidacionDelivery = {
  id: string;
  repartidorId: string;
  repartidor: string;
  desde: string;
  hasta: string;
  entregas: number;
  totalUsd: number;
  creadoEn: string;
  creadoPor: string;
  nota: string | null;
};

// ---------- Filtros en la URL ----------

export type FiltrosDelivery = {
  desde: string;
  hasta: string;
  /** Id del motorizado; vacío = todos. */
  repartidor: string;
};

export type SearchParams = Record<string, string | string[] | undefined>;

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

function uno(valor: string | string[] | undefined): string | undefined {
  return Array.isArray(valor) ? valor[0] : valor;
}

/** Hoy en Venezuela, como "YYYY-MM-DD" (las entregas se cuentan por su día
 * local, ver _FECHA_ENTREGA en el backend). */
export function hoyCaracas() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Caracas" }).format(new Date());
}

export function sumarDias(fecha: string, dias: number) {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

export function inicioDeMes(fecha: string) {
  return `${fecha.slice(0, 7)}-01`;
}

/** Sin período elegido, la quincena en curso: es como se paga. */
export function leerFiltros(params: SearchParams, hoy: string): FiltrosDelivery {
  const desdeParam = uno(params.desde);
  const hastaParam = uno(params.hasta);
  const dia = Number(hoy.slice(8));
  const desde = desdeParam && FECHA.test(desdeParam) ? desdeParam : dia <= 15 ? inicioDeMes(hoy) : `${hoy.slice(0, 7)}-16`;
  const hasta = hastaParam && FECHA.test(hastaParam) ? hastaParam : hoy;
  return {
    desde,
    hasta: hasta < desde ? desde : hasta,
    repartidor: uno(params.repartidor) ?? "",
  };
}

export function queryDelivery(f: FiltrosDelivery): string {
  const q = new URLSearchParams({ desde: f.desde, hasta: f.hasta });
  if (f.repartidor) q.set("repartidor", f.repartidor);
  return q.toString();
}

/** Cómo se lee un rango del tabulador: "0 a 10 km", "más de 35 km". */
export function textoRango(tabulador: RangoTabulador[], indice: number) {
  const desde = indice > 0 ? tabulador[indice - 1].hastaKm : 0;
  const hasta = tabulador[indice].hastaKm;
  const km = (v: number | null) => (v == null ? "—" : String(v).replace(".", ","));
  return hasta == null ? `más de ${km(desde)} km` : `${km(desde)} a ${km(hasta)} km`;
}
