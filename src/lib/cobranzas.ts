// Tipos y etiquetas del módulo de cobranzas, compartidos por el portal de
// clientes (/portal) y el panel interno (/cobranzas). Las reglas de saldo y
// bloqueo viven en el backend (backend/app/services/cartera.py).

import type { Tone } from "@/lib/constants";

export type Empresa = "ISVAN" | "TRALOG";
export type EstadoDocumento = "PENDIENTE" | "VENCIDO" | "PAGADO";
export type EstadoPago = "REPORTADO" | "VERIFICADO" | "RECHAZADO";
export type MetodoPago = "PAGO_MOVIL" | "TRANSFERENCIA" | "EFECTIVO" | "DIVISAS" | "RETENCION" | "AJUSTE";
export type EstadoCuentaPortal = "PENDIENTE_CORREO" | "POR_VALIDAR" | "ACTIVA" | "SUSPENDIDA";

export type Documento = {
  id: string;
  empresa: Empresa;
  codigoCliente: string;
  tipoDoc: string;
  numero: string;
  fecha: string;
  vence: string;
  montoUsd: number;
  montoBs: number;
  abonadoUsd: number;
  saldoUsd: number;
  estado: EstadoDocumento;
  diasAtraso: number;
};

export type ResumenCliente = {
  empresa: Empresa;
  codigoCliente: string;
  nombre: string;
  saldoUsd: number;
  vencidoUsd: number;
  aFavorUsd: number;
  documentosPendientes: number;
  documentosVencidos: number;
  diasAtraso: number;
  proximoVencimiento: string | null;
  bloqueado: boolean;
};

export type AplicacionPago = {
  documentoId: string;
  tipoDoc: string;
  numero: string;
  fecha: string;
  /** Lo que este pago le abona al documento. */
  montoUsd: number;
  /** El total del documento. */
  montoDocumentoUsd: number;
  vigente: boolean;
  // Solo en el panel de cobranzas (null si el documento quedó fuera de la cartera):
  vence?: string | null;
  saldoUsd?: number | null;
  estadoDocumento?: EstadoDocumento | null;
};

export type Pago = {
  id: string;
  numero: string;
  empresa: Empresa;
  codigoCliente: string;
  cliente: string | null;
  metodo: MetodoPago;
  bancoCodigo: string | null;
  banco: string | null;
  telefono: string | null;
  cedulaRif: string | null;
  cuenta: string | null;
  referencia: string | null;
  fechaPago: string;
  montoBs: number | null;
  tasa: number | null;
  montoUsd: number;
  tieneComprobante: boolean;
  comprobanteTipo: string | null;
  nota: string | null;
  estado: EstadoPago;
  reportadoEn: string;
  revisadoEn: string | null;
  motivoRechazo: string | null;
  aplicaciones: AplicacionPago[];
  // Solo en el panel de cobranzas:
  revisadoPor?: string | null;
  registradoPor?: string | null;
  reportadoPor?: string | null;
  reportadoPorEmail?: string | null;
  pendientes?: Documento[];
};

export type Movimiento = {
  fecha: string;
  empresa: Empresa;
  codigoCliente: string;
  tipo: string;
  referencia: string;
  metodo?: MetodoPago;
  cargoUsd: number;
  abonoUsd: number;
  montoBs: number | null;
  saldoUsd: number;
};

export type EstadoDeCuenta = { saldoInicialUsd: number; movimientos: Movimiento[]; saldoFinalUsd: number };

export type CuentaEmpresa = {
  id: string;
  empresa: Empresa;
  bancoCodigo: string;
  banco: string | null;
  tipo: "PAGO_MOVIL" | "TRANSFERENCIA";
  numero: string;
  rif: string;
  titular: string;
  activa?: boolean;
};

export const ESTADO_DOCUMENTO_META: Record<EstadoDocumento, { label: string; tone: Tone }> = {
  PENDIENTE: { label: "Pendiente", tone: "warning" },
  VENCIDO: { label: "Vencido", tone: "destructive" },
  PAGADO: { label: "Pagado", tone: "success" },
};

export const ESTADO_PAGO_META: Record<EstadoPago, { label: string; tone: Tone }> = {
  REPORTADO: { label: "En revisión", tone: "warning" },
  VERIFICADO: { label: "Verificado", tone: "success" },
  RECHAZADO: { label: "Rechazado", tone: "destructive" },
};

export const ESTADO_CUENTA_META: Record<EstadoCuentaPortal, { label: string; tone: Tone }> = {
  PENDIENTE_CORREO: { label: "Sin confirmar correo", tone: "neutral" },
  POR_VALIDAR: { label: "Por validar", tone: "warning" },
  ACTIVA: { label: "Activa", tone: "success" },
  SUSPENDIDA: { label: "Suspendida", tone: "destructive" },
};

export const METODO_PAGO_LABEL: Record<MetodoPago, string> = {
  PAGO_MOVIL: "Pago móvil",
  TRANSFERENCIA: "Transferencia",
  EFECTIVO: "Efectivo (Bs)",
  DIVISAS: "Divisas",
  RETENCION: "Retención",
  AJUSTE: "Ajuste",
};

export const TIPO_DOCUMENTO_LABEL: Record<string, string> = {
  FA: "Factura",
  NE: "Nota de entrega",
  DV: "Devolución",
  DN: "Nota de crédito",
  PAGO: "Pago",
};

/** "Factura 1234" / "Nota de entrega 88". */
export function nombreDocumento(d: { tipoDoc: string; numero: string }): string {
  return `${TIPO_DOCUMENTO_LABEL[d.tipoDoc] ?? d.tipoDoc} ${d.numero}`;
}

/** "ISVAN:123", como lo espera el parámetro `cliente` del portal. */
export function claveCliente(c: { empresa: Empresa; codigoCliente: string }): string {
  return `${c.empresa}:${c.codigoCliente}`;
}

/** Fecha de hoy en Caracas (AAAA-MM-DD), para los campos de fecha. */
export function hoyCaracas(): string {
  return new Date(Date.now() - 4 * 3600 * 1000).toISOString().slice(0, 10);
}

// ---------- Panel interno de cobranzas ----------

/** GET /cobranzas/resumen */
export type ResumenCobranzas = {
  carteraUsd: number;
  vencidoUsd: number;
  clientesConSaldo: number;
  clientesBloqueados: number;
  pagosPorVerificar: number;
  cuentasPorValidar: number;
  inicioCartera: string | null;
  diasTolerancia: number;
  bloqueoActivo: boolean;
  tasa: { fecha: string; tasa: number; fuente: string } | null;
};

/** GET /cobranzas/clientes */
export type ClienteCartera = ResumenCliente & {
  ruta: string | null;
  tipo: string | null;
  pagosPorVerificar: number;
  cuentasPortal: number;
};

/** GET /cobranzas/clientes/{empresa}/{codigo} */
export type DetalleClienteCartera = ResumenCliente & {
  datos: { nombre: string; ruta: string | null; tipo: string | null; telefono: string | null; email: string | null; ciudad: string | null } | null;
  documentos: Documento[];
  pagos: Pago[];
  cuentasPortal: { id: string; email: string; nombre: string; estado: EstadoCuentaPortal; origen: string; vinculadoEn: string }[];
};

/** GET /cobranzas/cuentas */
export type CuentaPortalAdmin = {
  id: string;
  email: string;
  nombre: string;
  rif: string;
  telefono: string | null;
  estado: EstadoCuentaPortal;
  empresaDeclarada: Empresa | null;
  codigoDeclarado: string | null;
  nombreDeclarado: string | null;
  createdAt: string;
  correoVerificadoEn: string | null;
  clientes: { empresa: Empresa; codigoCliente: string; origen: string; nombre: string | null }[];
};

/** GET /cobranzas/ajustes */
export type AjustesCobranza = {
  diasTolerancia: number;
  inicioCartera: string | null;
  bloqueoActivo: boolean;
};

/** GET /cobranzas/tasas */
export type TasaBcv = { fecha: string; tasa: number; fuente: string; registradoEn: string; registradoPor: string | null };

/** GET /cobranzas/tablero */
export type TableroCobranzas = {
  parametros: { inicioCartera: string | null; diasTolerancia: number; bloqueoActivo: boolean; desde: string; hasta: string };
  kpis: {
    carteraUsd: number;
    vencidoUsd: number;
    pctVencido: number;
    clientesConSaldo: number;
    clientesBloqueados: number;
    clientesDisponibles: number;
    vendidoUsd: number;
    cobradoUsd: number;
    pctCobrado: number | null;
    pagosCobrados: number;
    pagosPorVerificar: number;
    porVerificarUsd: number;
    diasCobro: number | null;
  };
  antiguedad: { clave: string; etiqueta: string; usd: number; documentos: number }[];
  serie: { mes: string; vendidoUsd: number; cobradoUsd: number }[];
  rutas: { ruta: string; saldoUsd: number; vencidoUsd: number; vendidoUsd: number; cobradoUsd: number; clientes: number; bloqueados: number }[];
  deudores: (ResumenCliente & { ruta: string })[];
  rutasDisponibles: string[];
};

/** Cartera de un despacho (GET /despachos/aprobacion/cartera). */
export type CarteraDespacho = ResumenCliente;
export type CarteraCola = {
  bloqueoActivo: boolean;
  diasTolerancia: number;
  puedeAutorizarExcepciones: boolean;
  despachos: Record<string, Omit<ResumenCliente, "nombre">>;
};
