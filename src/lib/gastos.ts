import { hoyCaracas, type Empresa, type SearchParams } from "@/lib/indicadores";

export type EmpresaGastos = Empresa | "TODAS";
export const EMPRESAS_GASTOS: { valor: EmpresaGastos; label: string }[] = [
  { valor: "TODAS", label: "Ambas" },
  { valor: "ISVAN", label: "ISVAN" },
  { valor: "TRALOG", label: "TRALOG" },
];

export type Vista = "resultados" | "gastos" | "cargas";
export const VISTAS: { valor: Vista; label: string }[] = [
  { valor: "resultados", label: "Estado de resultados" },
  { valor: "gastos", label: "Gastos" },
  { valor: "cargas", label: "Cargas" },
];

export type MesResultado = {
  ventaBruta: number;
  devoluciones: number;
  ventaNeta: number;
  costo: number;
  ventaSinCosto: number;
  totalGastos: number;
  gastos: Record<string, number>;
  margenBruto: number;
  resultado: number;
  margenBrutoPct: number | null;
  resultadoPct: number | null;
};

export type Resultados = {
  empresas: Empresa[];
  desde: string;
  hasta: string;
  categorias: string[];
  meses: (MesResultado & { mes: string })[];
  total: MesResultado;
};

export type Gasto = {
  id: string;
  empresa: Empresa;
  fecha: string;
  categoria: string;
  descripcion: string | null;
  proveedor: string | null;
  referencia: string | null;
  montoUsd: number;
  montoBs: number | null;
  moneda: "USD" | "BS";
  tasa: number | null;
  cargaId: string;
};

export type ListaGastos = {
  total: number;
  totalUsd: number;
  gastos: Gasto[];
  categorias: string[];
  limite: number;
};

export type CargaGasto = {
  id: string;
  empresa: Empresa;
  archivo: string;
  periodoDesde: string;
  periodoHasta: string;
  filas: number;
  totalUsd: number;
  estado: "CONFIRMADA" | "REVERTIDA";
  subidaEn: string;
  revertidaEn: string | null;
  subidaPor: string | null;
};

export type PreviewGastos = {
  columnas: Record<string, string>;
  empresas: {
    empresa: Empresa;
    filas: number;
    totalUsd: number;
    desde: string;
    hasta: string;
    porCategoria: { categoria: string; totalUsd: number }[];
    porMes: { mes: string; totalUsd: number }[];
  }[];
  problemas: { fila: number; motivo: string }[];
  duplicados: number[];
  enBs: number;
};

export type GastosCargados = { cargas: CargaGasto[]; omitidos: number; problemas: number };

export type FiltrosGastos = {
  vista: Vista;
  empresa: EmpresaGastos;
  desde: string;
  hasta: string;
  categoria?: string;
};

function uno(valor: string | string[] | undefined): string | undefined {
  return Array.isArray(valor) ? valor[0] : valor;
}

const MES = /^\d{4}-\d{2}$/;

/** "2026-11" -> primer y último día del mes. */
export function primerDia(mes: string) {
  return `${mes}-01`;
}

export function ultimoDia(mes: string) {
  const [a, m] = mes.split("-").map(Number);
  const dia = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return `${mes}-${String(dia).padStart(2, "0")}`;
}

function sumarMeses(mes: string, n: number) {
  const [a, m] = mes.split("-").map(Number);
  const fecha = new Date(Date.UTC(a, m - 1 + n, 1));
  return `${fecha.getUTCFullYear()}-${String(fecha.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Sin período elegido: los últimos 6 meses, con el actual. */
export function leerFiltrosGastos(params: SearchParams): FiltrosGastos {
  const actual = hoyCaracas().slice(0, 7);
  const vista = uno(params.vista);
  const empresa = uno(params.empresa);
  const desdeParam = uno(params.desde);
  const hastaParam = uno(params.hasta);
  const hasta = hastaParam && MES.test(hastaParam) ? hastaParam : actual;
  const desde = desdeParam && MES.test(desdeParam) ? desdeParam : sumarMeses(hasta, -5);
  return {
    vista: VISTAS.some((v) => v.valor === vista) ? (vista as Vista) : "resultados",
    empresa: EMPRESAS_GASTOS.some((e) => e.valor === empresa) ? (empresa as EmpresaGastos) : "TODAS",
    desde: desde > hasta ? hasta : desde,
    hasta,
    categoria: uno(params.categoria) || undefined,
  };
}

export function enlaceGastos(f: FiltrosGastos, cambios: Partial<FiltrosGastos> = {}) {
  const n = { ...f, ...cambios };
  const q = new URLSearchParams({ vista: n.vista, empresa: n.empresa, desde: n.desde, hasta: n.hasta });
  if (n.categoria) q.set("categoria", n.categoria);
  return `/gastos?${q}`;
}

export function queryApiGastos(f: FiltrosGastos, conCategoria = false) {
  const q = new URLSearchParams({ empresa: f.empresa, desde: primerDia(f.desde), hasta: ultimoDia(f.hasta) });
  if (conCategoria && f.categoria) q.set("categoria", f.categoria);
  return q.toString();
}
