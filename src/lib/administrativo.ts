// Tipos y ayudas del sistema administrativo (backend/app/api/administracion.py,
// catalogo.py, ventas.py, inventario.py).

export type EmpresaFiscal = {
  id: string;
  codigo: string;
  rif: string | null;
  razonSocial: string;
  nombreComercial: string | null;
  domicilioFiscal: string | null;
  telefono: string | null;
  correo: string | null;
  contribuyenteEspecial: boolean;
  agenteRetencionIva: boolean;
  porcentajeRetencionIva: number | null;
  agenteRetencionIslr: boolean;
  activa: boolean;
  faltaParaFacturar: string[];
  modulos: { ventas: boolean; inventario: boolean };
};

export type Producto = {
  id: string;
  empresaId: string;
  codigo: number;
  nombre: string;
  grupo: string | null;
  codigoProveedor: string | null;
  unidadesPorCaja: number;
  litrosPorUnidad: number | null;
  pesoCajaKg: number | null;
  impuestoCodigo: string;
  requiereFrio: boolean;
  manejaLote: boolean;
  activo: boolean;
};

export type ListaPrecio = { id: string; codigo: string; nombre: string; activa: boolean; productosConPrecio: number; clientes: number };
export type PrecioProducto = Producto & { precioCajaUsd: number | null };

export type ClienteFiscal = {
  id: string;
  codigo: string;
  nombre: string;
  ciudad: string;
  rifCedula: string | null;
  razonSocial: string | null;
  domicilioFiscal: string | null;
  contribuyenteEspecial: boolean;
  porcentajeRetencionIva: number | null;
  limiteCreditoUsd: number | null;
  diasCredito: number | null;
  rutaVenta: string | null;
  tipoVenta: string | null;
  listaPrecioCodigo: string | null;
};

export type EstadoPedido = "BORRADOR" | "CONFIRMADO" | "FACTURADO" | "ANULADO";
export type PedidoResumen = {
  id: string;
  numero: string;
  estado: EstadoPedido;
  origen: string;
  creadoEn: string;
  clienteCodigo: string;
  cliente: string;
  vendedor: string | null;
  renglones: number;
  subtotalUsd: number;
};

export type EstadoDocumento = "BORRADOR" | "EN_EMISION" | "EMITIDA" | "RECHAZADA";
export type TipoDocumento = "FA" | "NE" | "NC" | "ND";
export type DocumentoResumen = {
  id: string;
  tipo: TipoDocumento;
  numero: string | null;
  numeroControl: string | null;
  estado: EstadoDocumento;
  fechaEmision: string | null;
  totalUsd: number;
  totalBs: number;
  errorEmision: string | null;
  creadoEn: string;
  cliente: string;
  clienteCodigo: string;
  documentoAfectado: string | null;
};

export type DocumentoItem = {
  id: string;
  productoId: string;
  codigoProducto: number;
  descripcion: string;
  cajas: number;
  unidadesPorCaja: number;
  precioCajaUsd: number;
  descuentoPct: number;
  impuestoCodigo: string;
  porcentajeImpuesto: number;
  subtotalUsd: number;
};

export type DocumentoDetalle = DocumentoResumen & {
  empresaId: string;
  motivo: string | null;
  tasa: number | null;
  fechaTasa: string | null;
  vencimiento: string | null;
  pagoEnDivisas: boolean;
  igtfPorcentaje: number;
  baseImponibleUsd: number;
  exentoUsd: number;
  ivaUsd: number;
  igtfUsd: number;
  baseImponibleBs: number;
  exentoBs: number;
  ivaBs: number;
  igtfBs: number;
  clienteRif: string | null;
  clienteRazonSocial: string | null;
  clienteDomicilio: string | null;
  retencionIvaEsperadaBs?: number;
  impuestos: { codigo: string; porcentaje: number; baseUsd: number; ivaUsd: number; baseBs: number; ivaBs: number }[] | null;
  emisorFiscal: string | null;
  items: DocumentoItem[];
  empresa: EmpresaFiscal;
  cliente: { codigo: string; nombre: string; direccion: string; rifCedula: string | null; razonSocial: string | null };
  notas: { id: string; tipo: TipoDocumento; numero: string | null; estado: EstadoDocumento; totalUsd: number }[];
  afectado: { id: string; tipo: TipoDocumento; numero: string | null } | null;
};

export type Existencia = {
  productoId: string;
  codigo: number;
  nombre: string;
  grupo: string | null;
  unidadesPorCaja: number;
  almacenId: string;
  cajas: number;
  reservado: number;
  disponible: number;
  lotes: { loteId: string; lote: string; vencimiento: string | null; cajas: number }[];
};

export type Ajuste = {
  id: string;
  estado: "PROPUESTO" | "APROBADO" | "RECHAZADO";
  motivo: string;
  items: { productoId: string; loteId: string; cajas: string }[];
  creadoEn: string;
  resueltoEn: string | null;
  propuestoPor: string;
  resueltoPor: string | null;
  almacen: string;
};

export type FilaLibro = {
  fecha: string;
  tipo: TipoDocumento;
  numero: string;
  numeroControl: string | null;
  rif: string | null;
  razonSocial: string | null;
  documentoAfectado: string | null;
  totalBs: number;
  exentoBs: number;
  baseGeneral: number;
  ivaGeneral: number;
  baseReducida: number;
  ivaReducida: number;
  baseAdicional: number;
  ivaAdicional: number;
  igtfBs: number;
  retencionIvaBs: number;
};

export type EstadoTasa = { fecha: string | null; tasa: number | null; fuente: string | null; vigente: boolean; diasDesde: number | null };

export const TIPO_DOCUMENTO: Record<TipoDocumento, string> = {
  FA: "Factura",
  NE: "Nota de entrega",
  NC: "Nota de crédito",
  ND: "Nota de débito",
};

export const IMPUESTO: Record<string, string> = {
  IVA_GENERAL: "IVA 16 %",
  IVA_REDUCIDO: "IVA 8 %",
  IVA_ADICIONAL: "IVA 16 % + 15 % adicional",
  EXENTO: "Exento",
};

export const CAMPO_FISCAL: Record<string, string> = {
  rif: "RIF",
  razonSocial: "razón social",
  domicilioFiscal: "domicilio fiscal",
};

export type SearchParams = Record<string, string | string[] | undefined>;

/** La empresa elegida en la URL (?empresa=<id>) o la primera. */
export function empresaElegida(empresas: EmpresaFiscal[], params: SearchParams): EmpresaFiscal | null {
  const pedida = Array.isArray(params.empresa) ? params.empresa[0] : params.empresa;
  return empresas.find((e) => e.id === pedida) ?? empresas[0] ?? null;
}

export function parametro(params: SearchParams, nombre: string): string | undefined {
  const v = params[nombre];
  return Array.isArray(v) ? v[0] : v;
}
