/** Tipos de la API del censo (backend/app/api/censo.py). */

import type { Respuestas } from "@/lib/formulario/motor";

export type MiCenso = {
  id: string;
  recibidoEn: string;
  nombreComercio: string | null;
  tipoCliente: string | null;
  empresa: string | null;
  fotos: number;
};

export type CensoResumen = {
  id: string;
  recibidoEn: string;
  iniciadoEn: string;
  terminadoEn: string;
  encuestador: string | null;
  nombreComercio: string | null;
  tipoCliente: string | null;
  empresa: string | null;
  ruta: string | null;
  lat: number | null;
  lng: number | null;
  version: string;
  usuario: string;
  rif: string | null;
  telefono: string | null;
  fotos: number;
};

export type ListaCensos = {
  total: number;
  pagina: number;
  porPagina: number;
  censos: CensoResumen[];
  puntos: { id: string; lat: number; lng: number; nombreComercio: string | null; tipoCliente: string | null }[];
  opciones: { encuestador: string[]; tipoCliente: string[]; empresa: string[] };
};

export type DetalleCenso = Omit<CensoResumen, "fotos"> & {
  usuarioId: string;
  respuestas: Respuestas;
  fotos: { id: string; pregunta: string; tipo: string; bytes: number }[];
  versionVigente: boolean;
};

export type FiltrosCenso = {
  desde: string | null;
  hasta: string | null;
  encuestador: string[];
  tipoCliente: string[];
  empresa: string[];
  q: string;
  pagina: number;
};

type Params = Record<string, string | string[] | undefined>;
const lista = (v: string | string[] | undefined) => (v == null ? [] : (Array.isArray(v) ? v : [v]).filter(Boolean));
const uno = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

export function leerFiltrosCenso(params: Params): FiltrosCenso {
  const desde = uno(params.desde);
  const hasta = uno(params.hasta);
  return {
    desde: desde && FECHA.test(desde) ? desde : null,
    hasta: hasta && FECHA.test(hasta) ? hasta : null,
    encuestador: lista(params.encuestador),
    tipoCliente: lista(params.tipo_cliente),
    empresa: lista(params.empresa),
    q: uno(params.q) ?? "",
    pagina: Math.max(1, Number(uno(params.pagina)) || 1),
  };
}

/** Sirve igual para la URL de la página y para la API: mismos nombres. */
export function queryCenso(f: FiltrosCenso, conPagina = true): string {
  const q = new URLSearchParams();
  if (f.desde) q.set("desde", f.desde);
  if (f.hasta) q.set("hasta", f.hasta);
  f.encuestador.forEach((v) => q.append("encuestador", v));
  f.tipoCliente.forEach((v) => q.append("tipo_cliente", v));
  f.empresa.forEach((v) => q.append("empresa", v));
  if (f.q.trim()) q.set("q", f.q.trim());
  if (conPagina && f.pagina > 1) q.set("pagina", String(f.pagina));
  return q.toString();
}

// ---------- Maestra de clientes (por empresa) ----------

export type EmpresaMaestra = "ISVAN" | "TRALOG";

export type ResumenMaestra = {
  hoja: string;
  filaEncabezado: number;
  clientes: number;
  /** En la ruta 77 (dados de baja): fuera de "por censar". */
  deBaja: number;
  activos: number;
  repetidasIdenticas: number;
  conVariosActivos: number;
  repetidosDistintos: number;
  porRuta: Record<string, number>;
  porTipo: Record<string, number>;
  avisos: string[];
};

export type ContrasteMaestra = {
  clientesConVentas: number;
  codigosEnComun: number;
  mismoCliente: number;
  nombreDistinto: { codigo: string; nombreVentas: string; nombreMaestra: string }[];
  nombreDistintoTotal: number;
  rutaDistintaTotal: number;
  conVentasSinMaestra: { codigo: string; nombre: string; ruta: string }[];
  conVentasSinMaestraTotal: number;
  soloEnLaMaestra: number;
};

export type MaestraCarga = {
  id: string;
  archivo: string;
  filas: number;
  resumen: ResumenMaestra & { contraste?: ContrasteMaestra };
  subidaEn: string;
  subidaPor: string | null;
};

export type MaestrasVigentes = Record<EmpresaMaestra, MaestraCarga | null>;

export type PreviewMaestra = {
  resumen: ResumenMaestra;
  contraste: ContrasteMaestra;
  vigente: MaestraCarga | null;
};

/** Lo que responde POST /censo: que hizo el censo con los clientes que
 * nombra (ver backend/app/services/censo_clientes.py). */
export type AccionCensoCliente = "CREADO" | "COMPLETADO" | "EXISTENTE" | "REVISAR";

export type ResultadoEnvioCenso = {
  id: string;
  duplicadoDe: string | null;
  posibleCliente: boolean;
  clientes: {
    empresa: EmpresaMaestra;
    codigo: string;
    accion: AccionCensoCliente;
    motivo: string | null;
    enMaestra: boolean;
    enVentas: boolean;
  }[];
};

/** Una línea para el vendedor sobre lo que pasó con su censo. */
export function avisoDeEnvio(r: ResultadoEnvioCenso): { titulo: string; detalle?: string; revisar: boolean } {
  const revisar = r.clientes.find((c) => c.accion === "REVISAR");
  if (revisar) return { titulo: "Censo enviado, con un código para revisar", detalle: revisar.motivo ?? undefined, revisar: true };
  if (r.duplicadoDe)
    return { titulo: "Censo enviado", detalle: "Este cliente ya estaba censado en este lugar: no se cuenta dos veces.", revisar: false };
  if (r.posibleCliente) return { titulo: "Censo enviado", detalle: "Quedó registrado como posible cliente.", revisar: false };
  if (r.clientes.some((c) => c.accion === "CREADO"))
    return { titulo: "Censo enviado", detalle: "El cliente quedó creado en el sistema.", revisar: false };
  return { titulo: "Censo enviado", revisar: false };
}
