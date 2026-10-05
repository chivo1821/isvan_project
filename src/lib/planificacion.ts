import type { AvisoRuta, EstadoRuta, Vehiculo } from "@/lib/mock-data/types";

// Fechas de la planificación de rutas, siempre en hora de Caracas (UTC-4
// fijo, sin horario de verano): la salida programada se elige como fecha y
// hora sueltas en el formulario y viaja a la API como instante con zona.

const ZONA = "America/Caracas";
const DIA_MS = 24 * 3600 * 1000;

/** El día (AAAA-MM-DD) en Caracas de un instante. */
export function diaCaracas(instante: Date | string = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: ZONA }).format(new Date(instante));
}

/** Fecha y hora (HH:MM) en Caracas de un instante, como las piden los campos
 * date y time del formulario. */
export function partesCaracas(instante: Date | string): { fecha: string; hora: string } {
  const partes = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: ZONA,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(instante))
      .map((p) => [p.type, p.value])
  );
  return { fecha: `${partes.year}-${partes.month}-${partes.day}`, hora: `${partes.hour}:${partes.minute}` };
}

/** La próxima hora en punto, la salida por defecto de una ruta nueva. */
export function proximaHoraEnPunto(): { fecha: string; hora: string } {
  const { fecha, hora } = partesCaracas(new Date(Date.now() + 3600 * 1000));
  return { fecha, hora: `${hora.slice(0, 2)}:00` };
}

/** Fecha y hora de Caracas como instante ISO para la API; null si falta algo. */
export function salidaIso(fecha: string, hora: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !/^\d{2}:\d{2}$/.test(hora)) return null;
  return `${fecha}T${hora}:00-04:00`;
}

/** Suma días a una fecha AAAA-MM-DD (al mediodía UTC, para no cruzar de día). */
export function sumarDias(dia: string, dias: number): string {
  return new Date(new Date(`${dia}T12:00:00Z`).getTime() + dias * DIA_MS).toISOString().slice(0, 10);
}

/** El lunes de la semana de una fecha AAAA-MM-DD. */
export function lunesDe(dia: string): string {
  const semana = new Date(`${dia}T12:00:00Z`).getUTCDay(); // 0 = domingo
  return sumarDias(dia, -((semana + 6) % 7));
}

const DIA_LARGO = new Intl.DateTimeFormat("es-VE", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});

const DIA_CORTO = new Intl.DateTimeFormat("es-VE", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

/** Una fecha AAAA-MM-DD como "05 oct 2026". formatDate la tomaría como
 * medianoche de la máquina, y en un servidor en UTC eso ya es el día
 * anterior en Caracas. */
export function formatDia(dia: string): string {
  return DIA_CORTO.format(new Date(`${dia}T12:00:00Z`));
}

/** "Hoy", "Mañana" o "Lunes, 5 de octubre" para una fecha AAAA-MM-DD. */
export function etiquetaDia(dia: string, hoy = diaCaracas()): string {
  if (dia === hoy) return "Hoy";
  if (dia === sumarDias(hoy, 1)) return "Mañana";
  if (dia === sumarDias(hoy, -1)) return "Ayer";
  const texto = DIA_LARGO.format(new Date(`${dia}T12:00:00Z`));
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

// ---------- Respuestas de la API (ver backend/app/api/rutas.py) ----------


export type VehiculoOpcion = Pick<Vehiculo, "id" | "placa" | "tipo" | "capacidadKg" | "tieneRefrigeracion" | "estado"> & {
  conductor?: string | null;
};

export type PedidoAgenda = {
  id: string;
  numero: string;
  estado: string;
  cliente: string;
  ciudad: string | null;
  pesoKg: number;
};

/** Una ruta en GET /rutas/agenda: con sus pedidos, sus avisos y (si está
 * planificada) los vehículos libres en su horario. */
export type RutaAgenda = {
  id: string;
  numero: string;
  estado: EstadoRuta;
  salidaProgramada: string;
  iniciadaEn: string | null;
  completadaEn: string | null;
  tiempoTotalMin: number | null;
  distanciaTotalKm: number | null;
  vehiculoId: string | null;
  pedidos: PedidoAgenda[];
  pesoKg: number;
  avisos: AvisoRuta[];
  vehiculosLibres: string[] | null;
};

export type Agenda = {
  desde: string;
  hasta: string;
  rutas: RutaAgenda[];
  /** Planificadas que debían salir antes de `desde` y siguen sin salir. */
  atrasadas: RutaAgenda[];
  vehiculos: VehiculoOpcion[];
};

/** GET /rutas/configuracion */
export type AjustePlanificacion = {
  clave: string;
  valor: number;
  defecto: number;
  minimo: number;
  maximo: number;
  etiqueta: string;
  descripcion: string;
  unidad: string;
  actualizadoEn: string | null;
  actualizadoPor?: string | null;
};
