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
import { getRutaConRelacionesRaw, getRutaRaw, getRutasActivasConRelacionesRaw, getRutasRaw } from "./rutas";
import type {
  Almacen,
  Cliente,
  Despacho,
  DespachoAprobacion,
  Ruta,
  RutaPunto,
  RutasConRelaciones,
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
  getRutaConRelacionesRaw,
  getRutaPuntosRaw,
  getRutaRaw,
  getRutasActivasConRelacionesRaw,
  getRutasRaw,
  getUsuariosRaw,
  getVehiculosRaw,
};

// Trae en paralelo lo que hace falta para armar las relaciones. Ojo: NO se
// pide /ruta-puntos aquí — devuelve todos los vértices de todas las rutas
// (miles por ruta desde que se guarda la geometría completa) y ningún
// selector lo usa; la geometría viene anidada en cada ruta.
async function cargarTodo() {
  const [almacenes, clientes, usuarios, vehiculos, despachos, despachoAprobaciones, rutas] = await Promise.all([
    getAlmacenesRaw(),
    getClientesRaw(),
    getUsuariosRaw(),
    getVehiculosRaw(),
    getDespachosRaw(),
    getDespachoAprobacionesRaw(),
    getRutasRaw(),
  ]);
  return { almacenes, clientes, usuarios, vehiculos, despachos, despachoAprobaciones, rutas };
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

// Disponible ahora = funcional y sin una ruta en la calle. Las planificadas
// no lo ocupan: un vehículo puede tener varias, en horarios distintos (ver
// backend/app/services/planificacion.py).
export async function getVehiculosDisponibles(): Promise<Vehiculo[]> {
  const [vehiculos, rutas] = await Promise.all([getVehiculosRaw(), getRutasRaw()]);
  const ocupados = new Set(rutas.filter((r) => r.estado === "EN_TRANSITO").map((r) => r.vehiculoId));
  return vehiculos.filter((v) => v.estado === "FUNCIONAL" && !ocupados.has(v.id));
}

// ---------- Despachos ----------

export type RutaResumen = {
  id: string;
  numero: string;
  estado: Ruta["estado"];
  vehiculo: Vehiculo | null;
  salidaProgramada: string;
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
          vehiculo: vehiculos.find((v) => v.id === rutaRaw.vehiculoId) ?? null,
          salidaProgramada: rutaRaw.salidaProgramada,
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
  /** null mientras la ruta se planifica sin vehículo. */
  vehiculo: Vehiculo | null;
  /** Morocho: la segunda moto y quién la maneja. */
  vehiculoApoyo: Vehiculo | null;
  conductorApoyo: string | null;
  origen: Almacen;
  creadoPor: Usuario;
  /** Quién la reversó, si fue reversada (ver RutaConDetalle.canceladaEn). */
  canceladaPor?: Usuario | null;
  /**
   * Quién maneja: el usuario REPARTIDOR que tiene ese vehículo asignado. Si
   * no hay ninguno, se cae al nombre suelto que trae la ficha del vehículo.
   */
  conductor?: string | null;
  despachos: (Despacho & { destinoCliente: Cliente })[];
  puntos: RutaPunto[];
};

function armarRutaConDetalle(ruta: Ruta, datos: Awaited<ReturnType<typeof cargarTodo>>): RutaConDetalle {
  const { almacenes, clientes, usuarios, vehiculos } = datos;
  const vehiculo = vehiculos.find((v) => v.id === ruta.vehiculoId) ?? null;
  // Sin vehículo no hay conductor: comparar dos null le asignaría la ruta a
  // cualquier repartidor que tampoco tenga vehículo.
  const repartidor = ruta.vehiculoId
    ? usuarios.find((u) => u.rol === "REPARTIDOR" && u.vehiculoAsignadoId === ruta.vehiculoId)
    : undefined;
  const vehiculoApoyo = vehiculos.find((v) => v.id === ruta.vehiculoApoyoId) ?? null;
  const repartidorApoyo = ruta.vehiculoApoyoId
    ? usuarios.find((u) => u.rol === "REPARTIDOR" && u.vehiculoAsignadoId === ruta.vehiculoApoyoId)
    : undefined;
  return {
    ...ruta,
    vehiculo,
    conductor: repartidor?.nombre ?? vehiculo?.conductorNombre ?? null,
    vehiculoApoyo,
    conductorApoyo: repartidorApoyo?.nombre ?? vehiculoApoyo?.conductorNombre ?? null,
    origen: almacenes.find((a) => a.id === ruta.origenId)!,
    creadoPor: usuarios.find((u) => u.id === ruta.creadoPorId)!,
    canceladaPor: ruta.canceladaPorId ? (usuarios.find((u) => u.id === ruta.canceladaPorId) ?? null) : null,
    despachos: [...ruta.despachos]
      .sort((a, b) => (a.ordenEnRuta ?? 0) - (b.ordenEnRuta ?? 0))
      .map((d) => ({ ...d, destinoCliente: clientes.find((c) => c.id === d.destinoClienteId)! })),
    puntos: [...ruta.puntos].sort((a, b) => a.orden - b.orden),
  };
}

/** La respuesta de un endpoint con-relaciones ya trae exactamente lo que
 * armarRutaConDetalle necesita: se usa tal cual, sin pedir nada más. Antes
 * esto eran 4-5 llamadas con las listas COMPLETAS de almacenes, clientes,
 * usuarios y vehículos solo para quedarse con las pocas filas que la ruta
 * usa (ver backend/app/api/rutas.py, sección «con-relaciones»). */
function datosDeRelaciones(rel: RutasConRelaciones) {
  const { rutas: _rutas, ...relaciones } = rel;
  return { ...relaciones, despachos: [], despachoAprobaciones: [], rutas: [] };
}

export async function getRutaConDetalle(id: string): Promise<RutaConDetalle | undefined> {
  // Una sola llamada: la ruta puntual (única con el trazado completo) con
  // solo sus relaciones.
  const rel = await getRutaConRelacionesRaw(id).catch(() => undefined);
  const ruta = rel?.rutas[0];
  if (!rel || !ruta) return undefined;
  return armarRutaConDetalle(ruta, datosDeRelaciones(rel));
}

export async function getRutasConDetalle(): Promise<RutaConDetalle[]> {
  const datos = await cargarTodo();
  return datos.rutas.map((r) => armarRutaConDetalle(r, datos));
}

// Las rutas activas ya las filtra la API (PLANIFICADA y EN_TRANSITO, y por
// rol): una sola llamada con solo las relaciones que usan, en vez de
// cargarTodo() completo para después descartar casi todo.
export async function getRutasActivas(): Promise<RutaConDetalle[]> {
  const rel = await getRutasActivasConRelacionesRaw();
  const datos = datosDeRelaciones(rel);
  return rel.rutas.map((r) => armarRutaConDetalle(r, datos));
}

export async function getRutasByVehiculoId(vehiculoId: string): Promise<RutaConDetalle[]> {
  // Con los Morochos en que fue la segunda moto.
  return (await getRutasConDetalle()).filter((r) => r.vehiculoId === vehiculoId || r.vehiculoApoyoId === vehiculoId);
}
