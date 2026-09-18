// Tipos y filtros del módulo de indicadores de venta. Las respuestas son
// las de backend/app/api/indicadores.py; las definiciones de cada
// indicador, las de backend/app/services/indicadores_venta.py.

import type { ColumnaLeida } from "@/components/shared/tabla-columnas";

export type { ColumnaLeida };

export type Empresa = "ISVAN" | "TRALOG";
export const EMPRESAS: Empresa[] = ["ISVAN", "TRALOG"];

export type Indicadores = {
  filas: number;
  ventaNeta: number;
  ventaBruta: number;
  devoluciones: number;
  ventaNetaBs: number;
  litros: number;
  cajas: number;
  unidades: number;
  costo: number;
  ventaSinCosto: number;
  clientes: number;
  cadenas: number;
  /** Tipo + número: cada tipo de documento lleva su propia numeración. */
  documentos: number;
  /** Facturas y notas de entrega: la base del ticket promedio. */
  documentosVenta: number;
  facturas: number;
  notasEntrega: number;
  documentosDevolucion: number;
  /** Fracción 0..1. */
  pctDevolucion: number | null;
  precioLitro: number | null;
  margen: number;
  /** Fracción 0..1. */
  margenPct: number | null;
  ticketPromedio: number | null;
};

/** Cambio contra el período anterior: fracción de cambio para los montos,
 * diferencia en puntos (también como fracción) para los porcentajes. `null`
 * cuando no hay con qué comparar. */
export type Variacion = Partial<Record<keyof Indicadores, number | null>>;

export type TipoComparacion = "mes" | "semana" | "periodo";

export type ResumenIndicadores = {
  actual: Indicadores | null;
  anterior: Indicadores | null;
  variacion: Variacion | null;
  comparacion: { desde: string; hasta: string; tipo: TipoComparacion };
};

export type Granularidad = "mes" | "semana";
export type PuntoSerie = Indicadores & { periodo: string; variacion: Variacion };

export type Dimension = "ruta" | "grupo" | "tipo_cliente" | "producto" | "cliente";
export type FilaDesglose = Indicadores & { clave: string; nombre: string; detalle: string | null };
export type Desglose = { filas: FilaDesglose[]; totalGrupos: number };

export type OpcionesIndicadores = {
  rutas: string[];
  grupos: string[];
  tiposCliente: string[];
  /** Para los filtros de cliente y de producto (SKU), que traen buscador. */
  clientes: { codigo: string; nombre: string; ruta: string }[];
  productos: { codigo: string; nombre: string; grupo: string }[];
  fechaMin: string | null;
  fechaMax: string | null;
  /** Códigos de tipo de documento con ventas (FA, NE, DV, DN). */
  tiposDocumento: string[];
  cargasConfirmadas: number;
  cargasPendientes: number;
};

export type ProductoAlerta = { codigo: string; nombre: string; grupo: string; ventaNeta: number };
export type DesvioMargen = ProductoAlerta & { margenPct: number; margenGrupoPct: number };
export type ProductoDuplicado = { nombre: string; codigos: string[] };

export type AlertasIndicadores = {
  ventaSinCosto: number;
  productosSinCosto: ProductoAlerta[];
  desviosMargen: DesvioMargen[];
  productosDuplicados: ProductoDuplicado[];
};

export type PuntoMapaVenta = {
  codigo: string;
  nombre: string | null;
  ruta: string | null;
  tipo: string | null;
  ventaNeta: number;
  litros: number;
  ultimaCompra: string;
  lat: number;
  lng: number;
  ciudad: string | null;
};
export type DatosMapaVentas = {
  compradores: number;
  enLogistica: number;
  conUbicacion: number;
  puntos: PuntoMapaVenta[];
};

export type BrechasClientes = {
  fueraDeLogistica: {
    total: number;
    ventaNeta: number;
    clientes: {
      codigo: string;
      nombre: string | null;
      ruta: string | null;
      tipo: string | null;
      ventaNeta: number;
      ultimaCompra: string;
    }[];
  };
  sinCompras: {
    total: number;
    clientes: { codigo: string; nombre: string; ciudad: string; rutaComercial: string | null }[];
  };
  rutaDistinta: {
    enAmbos: number;
    sinRutaEnLogistica: number;
    total: number;
    clientes: { codigo: string; nombre: string; rutaVenta: string; rutaLogistica: string | null }[];
  };
};

/** Respuesta de GET /indicadores/tablero: todo lo de la página en una
 * sola llamada. */
export type ClienteActivacion = {
  codigo: string;
  nombre: string;
  ruta: string;
  tipo: string;
  ultimaCompra: string | null;
  diasSinCompra: number | null;
  ventaPeriodo: number;
  ventaAnterior: number;
  documentos: number;
};

/** "atendidos", los grupos por tiempo sin compra ("menos2", "de2a4",
 * "de4a8", "mas8") y "nunca" (solo con filtros de grupo, producto o
 * documento). */
export type ListaActivacion = {
  clave: string;
  etiqueta: string;
  total: number;
  clientes: ClienteActivacion[];
};

export type ActivacionClientes = {
  cartera: number;
  atendidos: number;
  noAtendidos: number;
  /** Fracción 0..1; null si la cartera está vacía. */
  pctActivacion: number | null;
  comparacion: { desde: string; hasta: string };
  listas: ListaActivacion[];
};

/** GET /indicadores/cobertura: días con ventas vigentes y su carga. */
export type CoberturaVentas = {
  dias: { fecha: string; cargaId: string; filas: number; ventaNeta: number; documentos: number }[];
  cargas: { id: string; archivo: string; periodoDesde: string; periodoHasta: string; confirmadaEn: string }[];
};

export type TableroIndicadores = {
  resumen: ResumenIndicadores;
  serie: Record<Granularidad, PuntoSerie[]>;
  desgloses: Record<Dimension, Desglose>;
  alertas: AlertasIndicadores;
  mapa: DatosMapaVentas;
  brechas: BrechasClientes;
  activacion: ActivacionClientes;
  /** Valores con ventas en el período según los demás filtros (ver
   * opciones_disponibles en el backend). */
  opcionesDisponibles: OpcionesDisponibles;
};

export type OpcionesDisponibles = {
  rutas: string[];
  grupos: string[];
  tiposCliente: string[];
  clientes: string[];
  productos: string[];
  tiposDocumento: string[];
};

// ---------- Cargas ----------

export type EstadoCargaVenta = "PENDIENTE" | "CONFIRMADA" | "REVERTIDA";

export type CargaVenta = {
  id: string;
  empresa: Empresa;
  archivo: string;
  periodoDesde: string;
  periodoHasta: string;
  filas: number;
  estado: EstadoCargaVenta;
  subidaEn: string;
  confirmadaEn: string | null;
  revertidaEn: string | null;
  subidaPor: string;
  ventaNeta: number | null;
  filasVigentes: number;
};

/** Validación de un archivo antes de confirmarlo (§6 del documento del
 * cliente). Se guarda con la carga para poder revisarla después. */
/** Detalle del 400 cuando a un archivo sin encabezado le falta una columna. */
export type ColumnasFaltantes = {
  mensaje: string;
  columnasFaltantes: string[];
  columnasReconocidas: ColumnaLeida[];
};

export function esColumnasFaltantes(datos: unknown): datos is ColumnasFaltantes {
  return !!datos && typeof datos === "object" && Array.isArray((datos as ColumnasFaltantes).columnasFaltantes);
}

export type ResumenValidacion = {
  hoja: string;
  /** Opcionales: las cargas anteriores a esta versión no los guardaban. */
  conEncabezado?: boolean;
  columnas?: ColumnaLeida[];
  otrasHojasConFormato: string[];
  fuenteCosto: string | null;
  filasLeidas: number;
  filasVenta: number;
  filasDevolucion: number;
  periodoDesde: string;
  periodoHasta: string;
  totales: {
    ventaNeta: number;
    ventaBruta: number;
    devoluciones: number;
    ventaNetaBs: number;
    litros: number;
    cajas: number;
    unidades: number;
  };
  documentos: number;
  /** Opcionales: las cargas anteriores a esta versión no los guardaban. */
  facturas?: number;
  notasEntrega?: number;
  clientes: number;
  solapes: {
    cargaId: string;
    archivo: string;
    periodoDesde: string;
    periodoHasta: string;
    filasReemplazadas: number;
    ventaReemplazada: number;
    /** Opcional: las cargas viejas no lo guardaban. */
    diasReemplazados?: number;
  }[];
  /** Opcional: las cargas anteriores a esta versión no la guardaban. */
  cobertura?: {
    diasEnArchivo: number;
    diasNuevos: number;
    diasReemplazados: number;
    meses: { mes: string; dias: number; diasNuevos: number; diasReemplazados: number }[];
    /** Días del período del archivo que ya tenían ventas y que el archivo no trae: se conservan. */
    diasConservados: { fecha: string; filas: number; ventaNeta: number; archivo: string }[];
  };
  clientesNuevos: { total: number; muestra: { codigo: string; nombre: string; tipo: string; ruta: string }[] };
  productosNuevos: { total: number; muestra: { codigo: string; nombre: string; grupo: string }[] };
  productosSinCosto: { total: number; ventaNeta: number; productos: ProductoAlerta[] };
  rutas: { enArchivo: string[]; noReconocidas: string[]; primeraCarga: boolean };
  tasa: {
    mediana: number | null;
    filasFueraDeRango: number;
    ventaNeta: number;
    muestra: { fila: number; fecha: string; numDoc: string; montoBs: number; montoUsd: number; tasa: number }[];
  };
  desviosMargen: DesvioMargen[];
  productosDuplicados: ProductoDuplicado[];
  fueraDeLogistica: { total: number; ventaNeta: number };
};

export type ErrorFila = { fila: number; columna?: string | null; motivo: string };

export type PreviewCarga = {
  carga: CargaVenta | null;
  resumen: ResumenValidacion | null;
  errores: ErrorFila[];
  totalErrores: number;
};

// ---------- Fechas ----------
//
// Las fechas de ventas son días sueltos ("2026-08-31"), sin hora. Se
// formatean en UTC de punta a punta: con la zona local de un servidor en
// UTC, la medianoche de Caracas cae el día anterior.

const FECHA_CORTA = new Intl.DateTimeFormat("es-VE", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const MES_LARGO = new Intl.DateTimeFormat("es-VE", { month: "long", year: "numeric", timeZone: "UTC" });
const MES_CORTO = new Intl.DateTimeFormat("es-VE", { month: "short", year: "2-digit", timeZone: "UTC" });

function comoUtc(fecha: string) {
  return new Date(`${fecha.slice(0, 10)}T00:00:00Z`);
}

export function formatFecha(fecha: string) {
  return FECHA_CORTA.format(comoUtc(fecha));
}

export function formatMes(fecha: string) {
  return MES_LARGO.format(comoUtc(fecha));
}

export function formatMesCorto(fecha: string) {
  return MES_CORTO.format(comoUtc(fecha));
}

/** Hoy en Venezuela, como "YYYY-MM-DD". */
export function hoyCaracas() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Caracas" }).format(new Date());
}

export function finDeMes(fecha: string): string {
  const [anio, mes] = fecha.split("-").map(Number);
  const ultimo = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  return `${fecha.slice(0, 7)}-${String(ultimo).padStart(2, "0")}`;
}

export function inicioDeMes(fecha: string): string {
  return `${fecha.slice(0, 7)}-01`;
}

/** Primer día del mes que queda `meses` meses antes o después. */
export function sumarMeses(fecha: string, meses: number): string {
  const [anio, mes] = fecha.split("-").map(Number);
  return new Date(Date.UTC(anio, mes - 1 + meses, 1)).toISOString().slice(0, 10);
}

// ---------- Filtros en la URL ----------

/** Los filtros del módulo (período, ruta, grupo, tipo de cliente, cliente y
 * producto), más la empresa. */
export type FiltrosIndicadores = {
  empresa: Empresa;
  desde: string;
  hasta: string;
  rutas: string[];
  grupos: string[];
  tipos: string[];
  /** Códigos de cliente del sistema de ventas. */
  clientes: string[];
  /** Códigos de producto (SKU). */
  productos: string[];
  /** Códigos de tipo de documento (FA, NE, DV, DN). */
  tiposDocumento: string[];
};

export type SearchParams = Record<string, string | string[] | undefined>;

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

function lista(valor: string | string[] | undefined): string[] {
  if (valor == null) return [];
  return (Array.isArray(valor) ? valor : [valor]).filter(Boolean);
}

function uno(valor: string | string[] | undefined): string | undefined {
  return Array.isArray(valor) ? valor[0] : valor;
}

export function empresaDeParams(params: SearchParams): Empresa {
  const empresa = uno(params.empresa);
  return empresa === "ISVAN" || empresa === "TRALOG" ? empresa : "TRALOG";
}

/** Lee los filtros de la URL. Sin período elegido, el último mes con
 * ventas (o el mes actual, si todavía no hay ninguna carga). */
export function leerFiltros(params: SearchParams, opciones: OpcionesIndicadores, hoy: string): FiltrosIndicadores {
  const referencia = opciones.fechaMax ?? hoy;
  const desdeParam = uno(params.desde);
  const hastaParam = uno(params.hasta);
  const desde = desdeParam && FECHA.test(desdeParam) ? desdeParam : inicioDeMes(referencia);
  const hasta = hastaParam && FECHA.test(hastaParam) ? hastaParam : finDeMes(referencia);
  return {
    empresa: empresaDeParams(params),
    desde,
    hasta: hasta < desde ? desde : hasta,
    rutas: lista(params.ruta),
    grupos: lista(params.grupo),
    tipos: lista(params.tipo),
    clientes: lista(params.cliente),
    productos: lista(params.producto),
    tiposDocumento: lista(params.doc),
  };
}

/** Query string para la API (nombres de parámetro del backend). */
export function queryApi(f: FiltrosIndicadores): string {
  const q = new URLSearchParams({ empresa: f.empresa, desde: f.desde, hasta: f.hasta });
  f.rutas.forEach((r) => q.append("ruta", r));
  f.grupos.forEach((g) => q.append("grupo", g));
  f.tipos.forEach((t) => q.append("tipo_cliente", t));
  f.clientes.forEach((c) => q.append("cliente", c));
  f.productos.forEach((p) => q.append("producto", p));
  f.tiposDocumento.forEach((d) => q.append("tipo_documento", d));
  return q.toString();
}

/** Query string para la URL de la página. */
export function queryPagina(f: FiltrosIndicadores): string {
  const q = new URLSearchParams({ empresa: f.empresa, desde: f.desde, hasta: f.hasta });
  f.rutas.forEach((r) => q.append("ruta", r));
  f.grupos.forEach((g) => q.append("grupo", g));
  f.tipos.forEach((t) => q.append("tipo", t));
  f.clientes.forEach((c) => q.append("cliente", c));
  f.productos.forEach((p) => q.append("producto", p));
  f.tiposDocumento.forEach((d) => q.append("doc", d));
  return q.toString();
}

export const TIPO_DOCUMENTO_META: Record<string, string> = {
  FA: "Factura",
  NE: "Nota de entrega",
  DV: "Devolución (DV)",
  DN: "Devolución (DN)",
};
