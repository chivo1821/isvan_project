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
  opciones: { encuestador: string[]; tipoCliente: string[]; empresa: string[]; ruta: string[] };
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
  ruta: string[];
  q: string;
  pagina: number;
  /** Pestaña del tablero (no es un filtro de la API). */
  vista: VistaCenso;
};

export const VISTAS_CENSO = ["principal", "mapa", "avance", "registros"] as const;
export type VistaCenso = (typeof VISTAS_CENSO)[number];

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
    ruta: lista(params.ruta),
    q: uno(params.q) ?? "",
    pagina: Math.max(1, Number(uno(params.pagina)) || 1),
    // "imagenes" era la pestaña aparte del mapa de fotos: hoy va en "mapa".
    vista:
      uno(params.vista) === "imagenes"
        ? "mapa"
        : (VISTAS_CENSO as readonly string[]).includes(uno(params.vista) ?? "")
          ? (uno(params.vista) as VistaCenso)
          : "principal",
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
  f.ruta.forEach((v) => q.append("ruta", v));
  if (f.q.trim()) q.set("q", f.q.trim());
  if (conPagina && f.pagina > 1) q.set("pagina", String(f.pagina));
  // La pestaña solo va en la URL de la página (la API la ignora).
  if (conPagina && f.vista !== "principal") q.set("vista", f.vista);
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

// ---------- Tablero (GET /censo/tablero) ----------

export type Conteo = { clave: string; n: number };

export type FotoPunto = { pregunta: string; id?: string; url?: string };

export type PuntoTablero = {
  id: string;
  lat: number;
  lng: number;
  nombre: string | null;
  tipoCliente: string | null;
  empresa: string | null;
  ruta: string | null;
  encuestador: string | null;
  fecha: string;
  vendeCompetencia: string | null;
  marcas: string[];
  poseeActivo: string | null;
  activoCompetencia: string | null;
  posibleCliente: boolean;
  fotos: FotoPunto[];
  origen: "PAGINA" | "SURVEY123";
};

export type CensoBreve = {
  id: string;
  nombre: string | null;
  encuestador: string | null;
  ruta: string | null;
  fecha: string;
  origen: "PAGINA" | "SURVEY123";
};

export type FilaAvance = {
  maestra: number;
  censados: number;
  /** registrados / maestra. */
  avance: number | null;
  /** Ya existen en Clientes (se pueden despachar), vengan o no del censo. */
  registrados: number;
  registradosConUbicacion: number;
  porRegistrar: number;
};

export type ClientePorCensar = {
  empresa: EmpresaMaestra;
  codigo: string;
  razonSocial: string;
  ruta: string;
  diaVisita: string | null;
  direccion: string | null;
  zona: string | null;
  vendedores: string[];
  /** Tiene un censo válido (en la lista por registrar: censado pero aún no en Clientes). */
  censado?: boolean;
};

export type TableroCenso = {
  principal: {
    visitas: number;
    duplicados: number;
    porDia: Conteo[];
    porVendedor: Conteo[];
    porRuta: Conteo[];
    porTipoCliente: Conteo[];
    poseeActivos: Conteo[];
    propiedadActivo: Conteo[];
    tablaVendedores: {
      vendedor: string;
      visitas: number;
      existentes: number;
      nuevos: number;
      conActivo: number;
      conCompetencia: number;
    }[];
  };
  mapa: { vendeCompetencia: Conteo[]; marcas: Conteo[]; otrasMarcas: Conteo[]; activosCompetencia: Conteo[] };
  puntos: PuntoTablero[];
  avance: {
    conMaestra: EmpresaMaestra[];
    porEmpresa: (FilaAvance & { empresa: EmpresaMaestra })[];
    porRuta: (FilaAvance & { empresa: EmpresaMaestra; ruta: string; vendedores: string[] })[];
    porVendedor: (FilaAvance & { vendedor: string; rutas: string[] })[];
    porRegistrarTotal: number;
    porRegistrar: ClientePorCensar[];
    creados: number;
    completados: number;
    pendientesVentasTotal: number;
    pendientesVentas: (CensoBreve & { empresa: EmpresaMaestra; codigo: string; accion: AccionCensoCliente })[];
    posiblesClientesTotal: number;
    posiblesClientes: (CensoBreve & { rif: string | null; telefono: string | null; lat: number | null; lng: number | null })[];
  };
  alertas: {
    duplicadosTotal: number;
    duplicados: (CensoBreve & { claves: string[]; duplicadoDe: Partial<CensoBreve> & { id: string } })[];
    mismoCodigoLejosTotal: number;
    mismoCodigoLejos: { empresa: EmpresaMaestra; codigo: string; metros: number | null; censos: CensoBreve[] }[];
    revisarTotal: number;
    revisar: (CensoBreve & { empresa: EmpresaMaestra; codigo: string; motivo: string })[];
    sinCodigoTotal: number;
    sinCodigo: (CensoBreve & { tipoCliente: string | null })[];
  };
};

/** GET /vendedor/censo/pendientes: lo que le falta al vendedor en sus rutas. */
export type PendientesVendedor = {
  rutas: { empresa: EmpresaMaestra; ruta: string }[];
  conMaestra: EmpresaMaestra[];
  /** Clientes de sus rutas que todavía no existen en el sistema. */
  porRegistrar: ClientePorCensar[];
  pendientesVentas: (CensoBreve & { empresa: EmpresaMaestra; codigo: string })[];
  revisar: (CensoBreve & { empresa: EmpresaMaestra; codigo: string; motivo: string })[];
  /** Clientes existentes (o nuevos que compran) censados sin código. */
  sinCodigo: (CensoBreve & { tipoCliente: string | null; rif: string | null })[];
  /** Devueltos por un ADMIN desde Censos por corregir, hasta que se vuelvan a censar. */
  devueltos: CensoDevuelto[];
};

export type CensoDevuelto = {
  id: string;
  nombre: string | null;
  ruta: string | null;
  fecha: string;
  devueltoEl: string;
  motivo: string;
  codigos: string[];
};

/** POST /clientes/censo-pendientes/devolver */
export type ResultadoDevolucion = { devueltos: number; lote: string; clientesEliminados: number };

// ---------- Censos por corregir (Clientes, GET /clientes/censo-pendientes) ----------

export const CATEGORIAS_CORRECCION = ["revisar", "ambas", "sin_codigo", "no_encontrado"] as const;
export type CategoriaCorreccion = (typeof CATEGORIAS_CORRECCION)[number];

export type SugerenciaMaestra = {
  empresa: EmpresaMaestra;
  codigo: string;
  razonSocial: string;
  ruta: string;
  enSuRuta: boolean;
  yaCensado: boolean;
};

export type CensoPorCorregir = {
  id: string;
  categoria: CategoriaCorreccion;
  nombre: string | null;
  tipoCliente: string | null;
  rif: string | null;
  telefono: string | null;
  ruta: string | null;
  encuestador: string | null;
  fecha: string;
  origen: "PAGINA" | "SURVEY123";
  direccion: string | null;
  empresa: string | null;
  codigoCliente: string | null;
  codigoIsvan: string | null;
  codigoTralog: string | null;
  claves: {
    empresa: EmpresaMaestra;
    codigo: string;
    accion: AccionCensoCliente;
    motivo: string | null;
    enMaestra: boolean;
    enVentas: boolean;
  }[];
  sugerencias: SugerenciaMaestra[];
};

export type ConteoCorreccion = Record<CategoriaCorreccion, number>;

export type CensosPorCorregir = {
  conteo: ConteoCorreccion;
  total: number;
  pagina: number;
  porPagina: number;
  hayMaestra: boolean;
  censos: CensoPorCorregir[];
};

export type ResultadoCorreccion = Omit<ResultadoEnvioCenso, "id"> & {
  categoria: CategoriaCorreccion | null;
  clientesEliminados: number;
};
