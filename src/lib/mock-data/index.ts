// Capa de selectores sobre la API real (ver src/lib/api-client.ts y
// backend/app/api/). Hace fetch y arma las relaciones que la API devuelve
// como IDs sueltos (join en el cliente, mismo patrón que antes).
import { getAlmacenesRaw } from "./almacenes";
import { getClientesRaw } from "./clientes";
import {
  getDespachoAprobacionesRaw,
  getDespachosDisponiblesParaRutaRaw,
  getDespachosRaw,
} from "./despachos";
import { getRutaPuntosRaw } from "./ruta-puntos";
import { getRutasRaw } from "./rutas";
import type {
  Almacen,
  Cliente,
  Despacho,
  DespachoAprobacion,
  Ruta,
  RutaPunto,
  Usuario,
  Vehiculo,
} from "./types";
import { getUsuariosRaw } from "./usuarios";
import { getVehiculosRaw } from "./vehiculos";

export * from "./types";
export {
  getAlmacenesRaw,
  getClientesRaw,
  getDespachoAprobacionesRaw,
  getDespachosDisponiblesParaRutaRaw,
  getDespachosRaw,
  getRutaPuntosRaw,
  getRutasRaw,
  getUsuariosRaw,
  getVehiculosRaw,
};

// Trae todo lo necesario en paralelo, una sola vez por selector — el
// dataset es chico (es una demo), no hace falta cache/memoizacion.
async function cargarTodo() {
  const [almacenes, clientes, usuarios, vehiculos, despachos, despachoAprobaciones, rutas, rutaPuntos] =
    await Promise.all([
      getAlmacenesRaw(),
      getClientesRaw(),
      getUsuariosRaw(),
      getVehiculosRaw(),
      getDespachosRaw(),
      getDespachoAprobacionesRaw(),
      getRutasRaw(),
      getRutaPuntosRaw(),
    ]);
  return { almacenes, clientes, usuarios, vehiculos, despachos, despachoAprobaciones, rutas, rutaPuntos };
}

// ---------- Catalogo ----------

export async function getAlmacenById(id: string): Promise<Almacen | undefined> {
  const almacenes = await getAlmacenesRaw();
  return almacenes.find((a) => a.id === id);
}

export async function getClienteById(id: string): Promise<Cliente | undefined> {
  const clientes = await getClientesRaw();
  return clientes.find((c) => c.id === id);
}

export async function getUsuarioById(id: string): Promise<Usuario | undefined> {
  const usuarios = await getUsuariosRaw();
  return usuarios.find((u) => u.id === id);
}

export async function getVehiculoById(id: string): Promise<Vehiculo | undefined> {
  const vehiculos = await getVehiculosRaw();
  return vehiculos.find((v) => v.id === id);
}

// Un vehiculo esta ocupado si ya esta asignado a una Ruta todavia activa
// (planificada o en tránsito) — antes se miraba por despacho, ahora por ruta.
export async function getVehiculosDisponibles(): Promise<Vehiculo[]> {
  const [vehiculos, rutas] = await Promise.all([getVehiculosRaw(), getRutasRaw()]);
  const ocupados = new Set(
    rutas.filter((r) => r.estado === "PLANIFICADA" || r.estado === "EN_TRANSITO").map((r) => r.vehiculoId)
  );
  return vehiculos.filter((v) => v.estado === "FUNCIONAL" && !ocupados.has(v.id));
}

// ---------- Despachos ----------

export type RutaResumen = {
  id: string;
  numero: string;
  estado: Ruta["estado"];
  vehiculo: Vehiculo;
  distanciaTotalKm?: number | null;
  tiempoTotalMin?: number | null;
};

export type DespachoConDetalle = Despacho & {
  origen: Almacen;
  destinoCliente: Cliente;
  creadoPor: Usuario;
  aprobaciones: DespachoAprobacion[];
  ruta?: RutaResumen;
};

function armarDespachoConDetalle(despacho: Despacho, datos: Awaited<ReturnType<typeof cargarTodo>>): DespachoConDetalle {
  const { almacenes, clientes, usuarios, vehiculos, despachoAprobaciones, rutas } = datos;
  const rutaRaw = despacho.rutaId ? rutas.find((r) => r.id === despacho.rutaId) : undefined;
  return {
    ...despacho,
    origen: almacenes.find((a) => a.id === despacho.origenId)!,
    destinoCliente: clientes.find((c) => c.id === despacho.destinoClienteId)!,
    creadoPor: usuarios.find((u) => u.id === despacho.creadoPorId)!,
    aprobaciones: despachoAprobaciones.filter((a) => a.despachoId === despacho.id),
    ruta: rutaRaw
      ? {
          id: rutaRaw.id,
          numero: rutaRaw.numero,
          estado: rutaRaw.estado,
          vehiculo: vehiculos.find((v) => v.id === rutaRaw.vehiculoId)!,
          distanciaTotalKm: rutaRaw.distanciaTotalKm,
          tiempoTotalMin: rutaRaw.tiempoTotalMin,
        }
      : undefined,
  };
}

export async function getDespachoConDetalle(id: string): Promise<DespachoConDetalle | undefined> {
  const datos = await cargarTodo();
  const despacho = datos.despachos.find((d) => d.id === id);
  if (!despacho) return undefined;
  return armarDespachoConDetalle(despacho, datos);
}

export async function getDespachosConDetalle(): Promise<DespachoConDetalle[]> {
  const datos = await cargarTodo();
  return datos.despachos.map((d) => armarDespachoConDetalle(d, datos));
}

export async function getDespachosPendientesAprobacion(): Promise<DespachoConDetalle[]> {
  return (await getDespachosConDetalle()).filter((d) => d.estado === "PENDIENTE_APROBACION");
}

// ---------- Rutas ----------

export type RutaConDetalle = Omit<Ruta, "despachos"> & {
  vehiculo: Vehiculo;
  origen: Almacen;
  creadoPor: Usuario;
  despachos: (Despacho & { destinoCliente: Cliente })[];
  puntos: RutaPunto[];
};

function armarRutaConDetalle(ruta: Ruta, datos: Awaited<ReturnType<typeof cargarTodo>>): RutaConDetalle {
  const { almacenes, clientes, usuarios, vehiculos } = datos;
  return {
    ...ruta,
    vehiculo: vehiculos.find((v) => v.id === ruta.vehiculoId)!,
    origen: almacenes.find((a) => a.id === ruta.origenId)!,
    creadoPor: usuarios.find((u) => u.id === ruta.creadoPorId)!,
    despachos: [...ruta.despachos]
      .sort((a, b) => (a.ordenEnRuta ?? 0) - (b.ordenEnRuta ?? 0))
      .map((d) => ({ ...d, destinoCliente: clientes.find((c) => c.id === d.destinoClienteId)! })),
    puntos: [...ruta.puntos].sort((a, b) => a.orden - b.orden),
  };
}

export async function getRutaConDetalle(id: string): Promise<RutaConDetalle | undefined> {
  const datos = await cargarTodo();
  const ruta = datos.rutas.find((r) => r.id === id);
  if (!ruta) return undefined;
  return armarRutaConDetalle(ruta, datos);
}

export async function getRutasConDetalle(): Promise<RutaConDetalle[]> {
  const datos = await cargarTodo();
  return datos.rutas.map((r) => armarRutaConDetalle(r, datos));
}

const ESTADOS_RUTA_ACTIVOS = ["PLANIFICADA", "EN_TRANSITO"] as const;

export async function getRutasActivas(): Promise<RutaConDetalle[]> {
  return (await getRutasConDetalle()).filter((r) =>
    (ESTADOS_RUTA_ACTIVOS as readonly string[]).includes(r.estado)
  );
}

export async function getRutasByVehiculoId(vehiculoId: string): Promise<RutaConDetalle[]> {
  return (await getRutasConDetalle()).filter((r) => r.vehiculoId === vehiculoId);
}
