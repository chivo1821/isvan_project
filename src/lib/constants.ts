import type { EstadoDespacho, EstadoRuta, EstadoVehiculo, RolUsuario, TipoVehiculo } from "@prisma/client";

export type Tone = "success" | "warning" | "destructive" | "info" | "neutral" | "primary";

type StatusMeta = { label: string; tone: Tone };

export const ESTADO_DESPACHO_META: Record<EstadoDespacho, StatusMeta> = {
  BORRADOR: { label: "Borrador", tone: "neutral" },
  PENDIENTE_APROBACION: { label: "Pendiente de aprobación", tone: "warning" },
  APROBADO: { label: "Aprobado", tone: "success" },
  RECHAZADO: { label: "Rechazado", tone: "destructive" },
  EN_PREPARACION: { label: "En preparación", tone: "warning" },
  EN_TRANSITO: { label: "En tránsito", tone: "info" },
  ENTREGADO: { label: "Entregado", tone: "success" },
  CANCELADO: { label: "Cancelado", tone: "destructive" },
};

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

export const ROL_USUARIO_META: Record<RolUsuario, StatusMeta> = {
  ADMIN: { label: "Administrador", tone: "primary" },
  DESPACHOS: { label: "Despachos", tone: "neutral" },
  APROBADOR: { label: "Aprobador", tone: "warning" },
  REPARTIDOR: { label: "Repartidor", tone: "success" },
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
