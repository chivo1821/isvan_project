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
  modulos: { ventas: boolean; inventario: boolean; bancos: boolean };
};

export type ModoPresupuestario = "MANUAL" | "SOBRE_ULTIMO" | "SOBRE_PROMEDIO";
export type BaseCosto = "ULTIMO" | "PROMEDIO" | "PRESUPUESTARIO";
export type MetodoMargen = "SOBRE_COSTO" | "SOBRE_VENTA";

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
  ultimoCostoCajaUsd?: number | null;
  ultimoCostoCajaBs?: number | null;
  costoPromedioCajaUsd?: number | null;
  costoPromedioCajaBs?: number | null;
  costoPresupuestarioCajaUsd?: number | null;
  modoPresupuestario?: ModoPresupuestario;
  porcentajePresupuestario?: number | null;
  costosActualizadosEn?: string | null;
};

export type ListaPrecio = {
  id: string;
  codigo: string;
  nombre: string;
  activa: boolean;
  productosConPrecio: number;
  clientes: number;
  baseCostoPorDefecto?: BaseCosto;
  margenObjetivoPct?: number | null;
  metodoMargen?: MetodoMargen;
};

export type PrecioProducto = Producto & {
  precioCajaUsd: number | null;
  margenPct?: number | null;
  baseCostoUsada?: BaseCosto | "MANUAL" | null;
  precioFijo?: boolean;
  margenUltimoPct?: number | null;
  margenPromedioPct?: number | null;
  margenPresupuestarioPct?: number | null;
  utilidadUltimoUsd?: number | null;
  utilidadPromedioUsd?: number | null;
  utilidadPresupuestarioUsd?: number | null;
  bajoCosto?: boolean;
  bajoMargenObjetivo?: boolean;
};

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
  ultimoCostoCajaUsd?: number | null;
  ultimoCostoCajaBs?: number | null;
  costoPromedioCajaUsd?: number | null;
  costoPromedioCajaBs?: number | null;
  costoPresupuestarioCajaUsd?: number | null;
  modoPresupuestario?: ModoPresupuestario;
  porcentajePresupuestario?: number | null;
  valorUltimoUsd?: number;
  valorPromedioUsd?: number;
  valorPromedioBs?: number;
  valorPresupuestarioUsd?: number;
  lotes: { loteId: string; lote: string; vencimiento: string | null; cajas: number }[];
};

export type KardexMovimiento = {
  id: number;
  fecha: string;
  tipo: string;
  cajas: number;
  costoUnitarioUsd: number | null;
  costoUnitarioBs: number | null;
  tasa: number | null;
  valorTotalUsd: number | null;
  valorTotalBs: number | null;
  saldoCajasEmpresa: number | null;
  costoPromedioResultanteUsd: number | null;
  costoPromedioResultanteBs: number | null;
  proveedor: string | null;
  numeroFacturaCompra: string | null;
  referencia: string | null;
  lote: string;
  almacen: string;
  documento: string | null;
  usuario: string | null;
};

export type FilaArt177 = {
  productoId: string;
  codigo: number;
  nombre: string;
  grupo: string | null;
  unidadesPorCaja: number;
  invInicialCajas: number;
  invInicialBs: number;
  invInicialUsd: number;
  entradasCajas: number;
  entradasBs: number;
  entradasUsd: number;
  salidasVentaCajas: number;
  salidasVentaBs: number;
  salidasVentaUsd: number;
  retirosAutoconsumoCajas: number;
  retirosAutoconsumoBs: number;
  retirosAutoconsumoUsd: number;
  ajustesCajas: number;
  ajustesBs: number;
  ajustesUsd: number;
  invFinalCajas: number;
  costoPromedioFinalBs: number;
  costoPromedioFinalUsd: number;
  invFinalBs: number;
  invFinalUsd: number;
};

export type ReporteArt177 = {
  empresaId: string;
  mes: string;
  filas: FilaArt177[];
  totales: {
    invInicialBs: number;
    invInicialUsd: number;
    entradasBs: number;
    entradasUsd: number;
    salidasVentaBs: number;
    salidasVentaUsd: number;
    retirosAutoconsumoBs: number;
    retirosAutoconsumoUsd: number;
    invFinalBs: number;
    invFinalUsd: number;
  };
};

// ---------- Modulo de Bancos y Flujo de Caja ----------

export type TipoCuentaTesoreria =
  | "BANCO_CORRIENTE"
  | "BANCO_AHORRO"
  | "BANCO_CUSTODIA_USD"
  | "CAJA_EFECTIVO"
  | "BILLETERA_DIGITAL";

export type MonedaCuenta = "VES" | "USD";

export type CuentaTesoreria = {
  id: string;
  empresaId: string;
  nombre: string;
  tipo: TipoCuentaTesoreria;
  moneda: MonedaCuenta;
  bancoCodigo: string | null;
  bancoNombre: string | null;
  numeroCuenta: string | null;
  titular: string | null;
  rif: string | null;
  saldoInicial: number;
  fechaSaldoInicial: string;
  saldoActual: number;
  saldoEquivalenteUsd: number;
  enNegativo: boolean;
  cuentaPortalId: string | null;
  activa: boolean;
  ultimoMovimientoEn: string | null;
};

export type ResumenBancos = {
  tasaBcv: number | null;
  fechaTasa: string | null;
  disponibleUsd: number;
  disponibleBs: number;
  disponibleBsEnUsd: number;
  disponibleConsolidadoUsd: number;
  ingresosMesUsd: number;
  egresosMesUsd: number;
  flujoNetoMesUsd: number;
  cuentasActivas: number;
  cuentasEnNegativo: number;
  cuentas: CuentaTesoreria[];
};

export type MovimientoBancario = {
  id: number;
  empresaId: string;
  cuentaId: string;
  cuentaNombre: string;
  cuentaMoneda: MonedaCuenta;
  fecha: string;
  tipo: "INGRESO" | "EGRESO" | "TRANSFERENCIA_SALIDA" | "TRANSFERENCIA_ENTRADA" | "AJUSTE";
  metodo: string;
  categoria: string;
  concepto: string;
  tercero: string | null;
  referencia: string | null;
  monto: number;
  tasa: number | null;
  montoUsd: number;
  montoBs: number | null;
  saldoResultante: number;
  transferenciaGrupoId: string | null;
  pagoId: string | null;
  gastoId: string | null;
  conciliado: boolean;
  conciliadoEn: string | null;
  anuladoEn: string | null;
  motivoAnulacion: string | null;
  reversoDeId: number | null;
  usuario: string | null;
  creadoEn: string;
};

export type FlujoCajaPeriodo = {
  periodo: string;
  ingresosUsd: number;
  egresosUsd: number;
  netoUsd: number;
  saldoAcumuladoUsd: number;
};

export type FlujoCajaCategoria = {
  categoria: string;
  ingresosUsd: number;
  egresosUsd: number;
  netoUsd: number;
  movimientos: number;
};

export type FlujoCajaReporte = {
  desde: string;
  hasta: string;
  agrupacion: "dia" | "semana" | "mes";
  saldoInicialUsd: number;
  totalIngresosUsd: number;
  totalEgresosUsd: number;
  flujoNetoUsd: number;
  saldoFinalUsd: number;
  series: FlujoCajaPeriodo[];
  porCategoria: FlujoCajaCategoria[];
};

export type LineaConciliacion = {
  indice: number;
  fecha: string;
  referencia: string | null;
  descripcion: string;
  monto: number;
  saldo: number | null;
  estado: "COINCIDE_MOVIMIENTO" | "COINCIDE_GASTO" | "SOLO_EN_BANCO" | "SOLO_EN_SISTEMA";
  movimientoId: number | null;
  gastoId: string | null;
  gastoResumen: {
    id: string;
    fecha: string;
    categoria: string;
    proveedor: string | null;
    referencia: string | null;
    montoUsd: number;
    montoBs: number | null;
  } | null;
};

export type ConciliacionBancaria = {
  id: string;
  empresaId: string;
  cuentaId: string;
  cuentaNombre?: string;
  archivo: string;
  periodoDesde: string;
  periodoHasta: string;
  saldoExtractoFinal: number | null;
  estado: "BORRADOR" | "CONFIRMADA";
  resumen: {
    totalLineasBanco: number;
    coincideMovimiento: number;
    coincideGasto: number;
    soloEnBanco: number;
    soloEnSistema: number;
    totalEgresosBanco: number;
    totalIngresosBanco: number;
  };
  lineas: LineaConciliacion[];
  creadaEn: string;
  confirmadaEn: string | null;
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
