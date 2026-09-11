// Tipos y reglas del módulo del vendedor. Las respuestas son las de
// backend/app/api/vendedor.py.

import type { Tone } from "@/lib/constants";
import type { Empresa, EstadoDespacho, EstadoRuta } from "@/lib/mock-data";

/** Ruta del sistema de ventas (R1..R8, 10, 11...) dentro de su empresa. */
export type RutaVenta = { empresa: Empresa; ruta: string };

export type DespachoVendedor = {
  id: string;
  numero: string;
  numeroDocumento: string;
  estado: EstadoDespacho;
  fechaCreacion: string;
  llegadaEn?: string | null;
  entregadoEn?: string | null;
  rutaNumero?: string | null;
  rutaEstado?: EstadoRuta | null;
  empresa: Empresa;
  clienteCodigo: string;
  clienteNombre: string;
  rutaVenta: string;
};

export type DespachosVendedor = { rutas: RutaVenta[]; despachos: DespachoVendedor[] };

/** Cómo va un despacho, en las palabras del vendedor: ¿ya se cargó?, ¿ya
 * salió?, ¿ya llegó? */
export type CategoriaDespacho = "pendiente" | "cargado" | "en_camino" | "entregado" | "otro";

export const CATEGORIA_DESPACHO_META: Record<CategoriaDespacho, { label: string; tone: Tone }> = {
  pendiente: { label: "Pendiente", tone: "warning" },
  cargado: { label: "Cargado en ruta", tone: "info" },
  en_camino: { label: "En camino", tone: "primary" },
  entregado: { label: "Entregado", tone: "success" },
  otro: { label: "Rechazado o cancelado", tone: "destructive" },
};

export function categoriaDespacho(d: DespachoVendedor): CategoriaDespacho {
  if (d.estado === "ENTREGADO") return "entregado";
  if (d.estado === "EN_TRANSITO") return "en_camino";
  if (d.estado === "RECHAZADO" || d.estado === "CANCELADO") return "otro";
  if (d.rutaNumero && d.rutaEstado === "PLANIFICADA") return "cargado";
  return "pendiente";
}

export type EstatusVisita = "por_visitar" | "en_cliente" | "atendido";

// Mismos colores que las paradas del despachador: gris lo pendiente, azul
// "en el cliente", verde lo terminado.
export const ESTATUS_VISITA_META: Record<EstatusVisita, { label: string; tone: Tone }> = {
  por_visitar: { label: "Por visitar", tone: "neutral" },
  en_cliente: { label: "En el cliente", tone: "info" },
  atendido: { label: "Atendido", tone: "success" },
};

export type Visita = {
  id: string;
  empresa: Empresa;
  codigoCliente: string;
  semana: string;
  llegadaEn: string;
  llegadaLat?: number | null;
  llegadaLng?: number | null;
  llegadaPrecisionM?: number | null;
  distanciaClienteM?: number | null;
  salidaEn?: string | null;
  observaciones?: string | null;
};

export type ClienteDeLaSemana = {
  empresa: Empresa;
  codigo: string;
  nombre: string;
  ruta: string;
  lat?: number | null;
  lng?: number | null;
  estatus: EstatusVisita;
  visitas: Visita[];
};

export type VisitasSemana = {
  semana: string;
  rutas: RutaVenta[];
  clientes: ClienteDeLaSemana[];
  visitaAbierta?: Visita | null;
};

export type RendimientoVendedor = {
  vendedorId: string;
  nombre: string;
  rutas: string[];
  clientesAsignados: number;
  clientesAtendidos: number;
  coberturaPct?: number | null;
  visitas: number;
  promedioMinEnCliente?: number | null;
  visitasLejos: number;
  ultimaVisita?: string | null;
  ventaNetaMes?: number | null;
};

export type RendimientoVendedores = {
  semana: string;
  mesVenta?: string | null;
  distanciaMaxM: number;
  porVendedor: RendimientoVendedor[];
};

export function rutasComoTexto(rutas: RutaVenta[]) {
  const variasEmpresas = new Set(rutas.map((r) => r.empresa)).size > 1;
  return rutas.map((r) => (variasEmpresas ? `${r.ruta} (${r.empresa})` : r.ruta)).join(", ");
}
