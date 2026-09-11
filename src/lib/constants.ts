import type { EstadoDespacho, EstadoRuta, EstadoVehiculo, RolUsuario, TipoVehiculo } from "@prisma/client";

export type Tone = "success" | "warning" | "destructive" | "info" | "neutral" | "primary";

type StatusMeta = { label: string; tone: Tone };

// Cada estado con un color propio: "Aprobado" y "Entregado" compartían el
// verde y en el histórico no se distinguía lo que ya salió de lo que sigue
// esperando ruta. Ahora el verde es solo para lo entregado (lo terminado).
export const ESTADO_DESPACHO_META: Record<EstadoDespacho, StatusMeta> = {
  BORRADOR: { label: "Borrador", tone: "neutral" },
  PENDIENTE_APROBACION: { label: "Pendiente de aprobación", tone: "warning" },
  APROBADO: { label: "Aprobado", tone: "info" },
  RECHAZADO: { label: "Rechazado", tone: "destructive" },
  EN_PREPARACION: { label: "En preparación", tone: "warning" },
  EN_TRANSITO: { label: "En tránsito", tone: "primary" },
  ENTREGADO: { label: "Entregado", tone: "success" },
  CANCELADO: { label: "Cancelado", tone: "destructive" },
};

/** Estado de una parada tal como se muestra en el viaje.
 *
 * `EstadoDespacho` no distingue "va en camino" de "ya está en el cliente":
 * entre la marca de llegada y la de entrega el despacho sigue en
 * `EN_TRANSITO`. Para el mapa y la lista del despachador esa diferencia es
 * justo lo que interesa —saber dónde está parado el conductor ahora—, así
 * que se deriva de las marcas. */
export function estadoDeParada(parada: {
  estado: EstadoDespacho;
  llegadaEn?: string | null;
  entregadoEn?: string | null;
}): StatusMeta {
  if (parada.entregadoEn || parada.estado === "ENTREGADO") return ESTADO_DESPACHO_META.ENTREGADO;
  if (parada.llegadaEn && parada.estado === "EN_TRANSITO") {
    // Azul: no choca con el naranja de "en tránsito" ni con el verde de
    // "entregado". El azul de "Aprobado" no compite, porque una parada solo
    // puede estar "en el cliente" con el viaje ya en marcha.
    return { label: "En el cliente", tone: "info" };
  }
  return ESTADO_DESPACHO_META[parada.estado];
}

export const ESTADO_RUTA_META: Record<EstadoRuta, StatusMeta> = {
  PLANIFICADA: { label: "Planificada", tone: "warning" },
  EN_TRANSITO: { label: "En tránsito", tone: "info" },
  COMPLETADA: { label: "Completada", tone: "success" },
  CANCELADA: { label: "Cancelada", tone: "destructive" },
};

export const ESTADO_VEHICULO_META: Record<EstadoVehiculo, StatusMeta> = {
  FUNCIONAL: { label: "Funcional", tone: "success" },
  EN_MANTENIMIENTO: { label: "En mantenimiento", tone: "warning" },
  FUERA_DE_SERVICIO: { label: "Fuera de servicio", tone: "destructive" },
};

// A dónde entra cada rol. El dashboard tiene la foto completa de la
// operación (KPIs, rendimiento por conductor), así que queda reservado a
// ADMIN; los demás roles arrancan en su propio módulo. La regla se aplica
// en (dashboard)/layout.tsx, no solo escondiendo el enlace.
export const INICIO_POR_ROL: Record<RolUsuario, string> = {
  ADMIN: "/",
  DESPACHOS: "/despachos",
  APROBADOR: "/despachos/aprobacion",
  REPARTIDOR: "/despachador",
  VENDEDOR: "/vendedor",
};

export const ROL_USUARIO_META: Record<RolUsuario, StatusMeta> = {
  ADMIN: { label: "Administrador", tone: "primary" },
  DESPACHOS: { label: "Despachos", tone: "neutral" },
  APROBADOR: { label: "Aprobador", tone: "warning" },
  REPARTIDOR: { label: "Repartidor", tone: "success" },
  VENDEDOR: { label: "Vendedor", tone: "info" },
};

export const TIPO_VEHICULO_META: Record<TipoVehiculo, { label: string }> = {
  CAMION_REFRIGERADO: { label: "Camión refrigerado" },
  CAMIONETA: { label: "Camioneta" },
  MOTO: { label: "Moto" },
};

// Los strings tipo "YYYY-MM-DD" (sin hora) se interpretan como UTC medianoche
// por el constructor de Date; forzamos hora local para que no se corran un
// dia hacia atras al formatear en zonas horarias negativas (ej. Venezuela).
function toLocalDate(value: Date | string) {
  if (value instanceof Date) return value;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value);
}

// Zona horaria fija (no la del servidor/navegador): sin esto, el render del
// servidor (Node, timezone de la maquina) y el del navegador (timezone local
// del usuario) pueden formatear la misma fecha distinto y romper la
// hidratacion de React. Ademas es lo correcto para una empresa venezolana,
// sin importar donde corra el servidor.
const TIMEZONE = "America/Caracas";

export function formatDate(value: Date | string) {
  return new Intl.DateTimeFormat("es-VE", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: TIMEZONE,
  }).format(toLocalDate(value));
}

/** Solo la hora (HH:mm) — para las marcas de llegada y entrega en la calle.
 * Con la misma zona horaria fija que el resto, para no romper la hidratación. */
export function formatHora(value: Date | string) {
  return new Intl.DateTimeFormat("es-VE", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: TIMEZONE,
  }).format(toLocalDate(value));
}

// Cifras de los indicadores de venta. Locale fijo (no el del navegador) por
// la misma razón que TIMEZONE: el servidor y el navegador deben formatear
// igual para no romper la hidratación.
function numeroEsVe(valor: number, decimales: number) {
  return valor.toLocaleString("es-VE", { minimumFractionDigits: decimales, maximumFractionDigits: decimales });
}

export function formatUsd(valor: number | null | undefined, decimales = 0) {
  if (valor == null) return "—";
  return `${valor < 0 ? "-" : ""}$${numeroEsVe(Math.abs(valor), decimales)}`;
}

export function formatNumero(valor: number | null | undefined, decimales = 0) {
  return valor == null ? "—" : numeroEsVe(valor, decimales);
}

/** `valor` es una fracción (0.4270 → "42,7 %"). */
export function formatPct(valor: number | null | undefined, decimales = 1) {
  return valor == null ? "—" : `${numeroEsVe(valor * 100, decimales)} %`;
}

export function formatDateTime(value: Date | string) {
  return new Intl.DateTimeFormat("es-VE", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: TIMEZONE,
  }).format(toLocalDate(value));
}
