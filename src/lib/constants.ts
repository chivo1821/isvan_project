import type {
  CategoriaProducto,
  EstadoDespacho,
  EstadoFactura,
  EstadoVehiculo,
  EstadoVenta,
  RolUsuario,
  TipoVehiculo,
} from "@prisma/client";

export type Tone = "success" | "warning" | "destructive" | "info" | "neutral" | "primary";

type StatusMeta = { label: string; tone: Tone };

export const ESTADO_VENTA_META: Record<EstadoVenta, StatusMeta> = {
  PENDIENTE: { label: "Pendiente", tone: "neutral" },
  EN_REVISION: { label: "En revisión", tone: "warning" },
  APROBADA: { label: "Aprobada", tone: "success" },
  RECHAZADA: { label: "Rechazada", tone: "destructive" },
  DESPACHADA: { label: "Despachada", tone: "info" },
  ANULADA: { label: "Anulada", tone: "destructive" },
};

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

export const ESTADO_FACTURA_META: Record<EstadoFactura, StatusMeta> = {
  PENDIENTE: { label: "Pendiente", tone: "warning" },
  PAGADA: { label: "Pagada", tone: "success" },
  VENCIDA: { label: "Vencida", tone: "destructive" },
};

export const ESTADO_VEHICULO_META: Record<EstadoVehiculo, StatusMeta> = {
  FUNCIONAL: { label: "Funcional", tone: "success" },
  EN_MANTENIMIENTO: { label: "En mantenimiento", tone: "warning" },
  FUERA_DE_SERVICIO: { label: "Fuera de servicio", tone: "destructive" },
};

export const ROL_USUARIO_META: Record<RolUsuario, StatusMeta> = {
  ADMIN: { label: "Administrador", tone: "primary" },
  VENTAS: { label: "Ventas", tone: "info" },
  INVENTARIO: { label: "Inventario", tone: "neutral" },
  DESPACHOS: { label: "Despachos", tone: "neutral" },
  APROBADOR: { label: "Aprobador", tone: "warning" },
  REPARTIDOR: { label: "Repartidor", tone: "success" },
};

export const CATEGORIA_PRODUCTO_META: Record<CategoriaProducto, StatusMeta> = {
  HELADO: { label: "Helado", tone: "info" },
  PIZZA: { label: "Pizza", tone: "warning" },
};

export const TIPO_VEHICULO_META: Record<TipoVehiculo, { label: string }> = {
  CAMION_REFRIGERADO: { label: "Camión refrigerado" },
  CAMIONETA: { label: "Camioneta" },
  MOTO: { label: "Moto" },
};

export function formatCurrency(value: number | string) {
  const numeric = typeof value === "string" ? Number(value) : value;
  return new Intl.NumberFormat("es-VE", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(numeric);
}

// Tasa de cambio oficial del BCV (Banco Central de Venezuela) VIGENTE HOY,
// Bs por USD. MOCK para esta fase de solo-UI — Fase 2 debe consultar el feed
// real del BCV. Se usa como valor por defecto cuando no aplica una tasa
// historica (ej. precio de catalogo, que no esta atado a una fecha pasada).
//
// Para montos ya registrados (Venta.tasaBcv, Factura.tasaBcv) SIEMPRE se debe
// pasar esa tasa "congelada" explicitamente, para que el equivalente en Bs de
// un registro pasado no cambie con la fluctuacion del bolivar — ver
// docs/MODELO_DATOS.md.
export const TASA_BCV_VES_POR_USD = 196.85;

export function convertirUsdABs(usdValue: number | string, tasa: number = TASA_BCV_VES_POR_USD) {
  const numeric = typeof usdValue === "string" ? Number(usdValue) : usdValue;
  return numeric * tasa;
}

/** Formatea un monto que YA esta en Bs (sin convertir), ej. al sumar varios montos ya convertidos cada uno con su propia tasa. */
export function formatBsAmount(bsValue: number) {
  return new Intl.NumberFormat("es-VE", {
    style: "currency",
    currency: "VES",
    minimumFractionDigits: 2,
  }).format(bsValue);
}

export function formatBs(usdValue: number | string, tasa: number = TASA_BCV_VES_POR_USD) {
  return formatBsAmount(convertirUsdABs(usdValue, tasa));
}

/** Muestra un monto (guardado en USD) en ambas monedas, ej. "$4,50 · Bs 885,83". */
export function formatDualCurrency(usdValue: number | string, tasa: number = TASA_BCV_VES_POR_USD) {
  return `${formatCurrency(usdValue)} · ${formatBs(usdValue, tasa)}`;
}

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
