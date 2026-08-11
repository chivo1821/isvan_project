// Capa de selectores sobre la API real (ver src/lib/api-client.ts y
// backend/app/api/). Antes leian arrays estaticos en memoria; ahora hacen
// fetch, por eso todo es async — pero la logica de union/filtro es
// exactamente la misma que tenia en Fase 1 (solo UI).
import { getAlmacenesRaw } from "./almacenes";
import { getClientesRaw } from "./clientes";
import { getDespachoAprobacionesRaw, getDespachosRaw } from "./despachos";
import { getFacturasRaw } from "./facturas";
import { getProductosRaw } from "./productos";
import { getRutaPuntosRaw } from "./ruta-puntos";
import { getStockRaw } from "./stock";
import type {
  Almacen,
  Cliente,
  Despacho,
  DespachoAprobacion,
  DespachoItem,
  Factura,
  Producto,
  RutaPunto,
  StockAlmacen,
  Usuario,
  Venta,
  VentaItem,
  VentaRevision,
  Vehiculo,
} from "./types";
import { getUsuarioActualRaw, getUsuariosRaw } from "./usuarios";
import { getVentaRevisionesRaw, getVentasRaw } from "./ventas";
import { getVehiculosRaw } from "./vehiculos";

export * from "./types";
export {
  getAlmacenesRaw,
  getClientesRaw,
  getDespachoAprobacionesRaw,
  getDespachosRaw,
  getFacturasRaw,
  getProductosRaw,
  getRutaPuntosRaw,
  getStockRaw,
  getUsuarioActualRaw,
  getUsuariosRaw,
  getVehiculosRaw,
  getVentaRevisionesRaw,
  getVentasRaw,
};

// Trae todo lo necesario en paralelo, una sola vez por selector — el
// dataset es chico (es una demo), no hace falta cache/memoizacion.
async function cargarTodo() {
  const [
    productos,
    almacenes,
    clientes,
    facturas,
    usuarios,
    vehiculos,
    ventas,
    ventaRevisiones,
    despachos,
    despachoAprobaciones,
    stock,
    rutaPuntos,
  ] = await Promise.all([
    getProductosRaw(),
    getAlmacenesRaw(),
    getClientesRaw(),
    getFacturasRaw(),
    getUsuariosRaw(),
    getVehiculosRaw(),
    getVentasRaw(),
    getVentaRevisionesRaw(),
    getDespachosRaw(),
    getDespachoAprobacionesRaw(),
    getStockRaw(),
    getRutaPuntosRaw(),
  ]);
  return {
    productos,
    almacenes,
    clientes,
    facturas,
    usuarios,
    vehiculos,
    ventas,
    ventaRevisiones,
    despachos,
    despachoAprobaciones,
    stock,
    rutaPuntos,
  };
}

// ---------- Catalogo ----------

export async function getProductoById(id: string): Promise<Producto | undefined> {
  const productos = await getProductosRaw();
  return productos.find((p) => p.id === id);
}

export async function getAlmacenById(id: string): Promise<Almacen | undefined> {
  const almacenes = await getAlmacenesRaw();
  return almacenes.find((a) => a.id === id);
}

export async function getClienteByCodigo(codigo: string): Promise<Cliente | undefined> {
  const clientes = await getClientesRaw();
  return clientes.find((c) => c.codigo === codigo);
}

export async function getUsuarioById(id: string): Promise<Usuario | undefined> {
  const usuarios = await getUsuariosRaw();
  return usuarios.find((u) => u.id === id);
}

export async function getVehiculoById(id: string): Promise<Vehiculo | undefined> {
  const vehiculos = await getVehiculosRaw();
  return vehiculos.find((v) => v.id === id);
}

// ---------- Inventario ----------

export async function getStockByProducto(productoId: string): Promise<StockAlmacen[]> {
  const stock = await getStockRaw();
  return stock.filter((s) => s.productoId === productoId);
}

export async function getStockTotalByProducto(productoId: string): Promise<number> {
  return (await getStockByProducto(productoId)).reduce((sum, s) => sum + s.cantidad, 0);
}

export async function productoTieneStockBajo(productoId: string): Promise<boolean> {
  return (await getStockByProducto(productoId)).some((s) => s.cantidad < s.stockMinimo);
}

export async function getProductosBajoStock(): Promise<Producto[]> {
  const [productos, stock] = await Promise.all([getProductosRaw(), getStockRaw()]);
  return productos.filter((p) => stock.some((s) => s.productoId === p.id && s.cantidad < s.stockMinimo));
}

// ---------- Clientes / Facturas ----------

export async function getFacturasByCliente(clienteId: string): Promise<Factura[]> {
  const facturas = await getFacturasRaw();
  return facturas.filter((f) => f.clienteId === clienteId);
}

export async function getFacturasPendientesByCliente(clienteId: string): Promise<Factura[]> {
  return (await getFacturasByCliente(clienteId)).filter((f) => f.estado === "PENDIENTE" || f.estado === "VENCIDA");
}

export async function clienteTieneFacturaPendiente(clienteId: string): Promise<boolean> {
  return (await getFacturasPendientesByCliente(clienteId)).length > 0;
}

// ---------- Ventas ----------

export type VentaConDetalle = Venta & {
  cliente: Cliente;
  vendedor: Usuario;
  itemsConProducto: (VentaItem & { producto: Producto })[];
  revisiones: VentaRevision[];
  despacho?: Despacho;
};

export async function getVentaConDetalle(id: string): Promise<VentaConDetalle | undefined> {
  const { productos, clientes, usuarios, ventas, ventaRevisiones, despachos } = await cargarTodo();
  const venta = ventas.find((v) => v.id === id);
  if (!venta) return undefined;
  const cliente = clientes.find((c) => c.codigo === venta.clienteId)!;
  const vendedor = usuarios.find((u) => u.id === venta.vendedorId)!;
  return {
    ...venta,
    cliente,
    vendedor,
    itemsConProducto: venta.items.map((item) => ({
      ...item,
      producto: productos.find((p) => p.id === item.productoId)!,
    })),
    revisiones: ventaRevisiones.filter((r) => r.ventaId === venta.id),
    despacho: despachos.find((d) => d.ventaId === venta.id),
  };
}

export async function getVentasConDetalle(): Promise<VentaConDetalle[]> {
  const { productos, clientes, usuarios, ventas, ventaRevisiones, despachos } = await cargarTodo();
  return ventas.map((venta) => {
    const cliente = clientes.find((c) => c.codigo === venta.clienteId)!;
    const vendedor = usuarios.find((u) => u.id === venta.vendedorId)!;
    return {
      ...venta,
      cliente,
      vendedor,
      itemsConProducto: venta.items.map((item) => ({
        ...item,
        producto: productos.find((p) => p.id === item.productoId)!,
      })),
      revisiones: ventaRevisiones.filter((r) => r.ventaId === venta.id),
      despacho: despachos.find((d) => d.ventaId === venta.id),
    };
  });
}

export async function getVentasEnRevision(): Promise<VentaConDetalle[]> {
  return (await getVentasConDetalle()).filter((v) => v.estado === "EN_REVISION");
}

// Ventas aprobadas que todavia no generaron un despacho — son las elegibles
// para el wizard "Nuevo despacho" (que ya no pide cargar productos a mano,
// los toma directo de la venta seleccionada).
export async function getVentasAprobadasSinDespacho(): Promise<VentaConDetalle[]> {
  return (await getVentasConDetalle()).filter((v) => v.estado === "APROBADA" && !v.despacho);
}

// ---------- Despachos ----------

export type DespachoConDetalle = Despacho & {
  origen: Almacen;
  destinoCliente: Cliente;
  creadoPor: Usuario;
  vehiculo?: Vehiculo;
  itemsConProducto: (DespachoItem & { producto: Producto })[];
  aprobaciones: DespachoAprobacion[];
  ruta: RutaPunto[];
  venta?: Venta;
};

function armarDespachoConDetalle(
  despacho: Despacho,
  datos: Awaited<ReturnType<typeof cargarTodo>>
): DespachoConDetalle {
  const { productos, almacenes, clientes, usuarios, vehiculos, despachoAprobaciones, rutaPuntos, ventas } = datos;
  return {
    ...despacho,
    origen: almacenes.find((a) => a.id === despacho.origenId)!,
    destinoCliente: clientes.find((c) => c.codigo === despacho.destinoClienteId)!,
    creadoPor: usuarios.find((u) => u.id === despacho.creadoPorId)!,
    vehiculo: despacho.vehiculoId ? vehiculos.find((v) => v.id === despacho.vehiculoId) : undefined,
    itemsConProducto: despacho.items.map((item) => ({
      ...item,
      producto: productos.find((p) => p.id === item.productoId)!,
    })),
    aprobaciones: despachoAprobaciones.filter((a) => a.despachoId === despacho.id),
    ruta: rutaPuntos.filter((r) => r.despachoId === despacho.id).sort((a, b) => a.orden - b.orden),
    venta: despacho.ventaId ? ventas.find((v) => v.id === despacho.ventaId) : undefined,
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

export async function getDespachosEnTransito(): Promise<DespachoConDetalle[]> {
  return (await getDespachosConDetalle()).filter((d) => d.estado === "EN_TRANSITO");
}

export async function getRutaByDespachoId(despachoId: string): Promise<RutaPunto[]> {
  const rutaPuntos = await getRutaPuntosRaw();
  return rutaPuntos.filter((r) => r.despachoId === despachoId).sort((a, b) => a.orden - b.orden);
}

// Despachos que ocupan un vehiculo en este momento (no liberado todavia).
const ESTADOS_DESPACHO_ACTIVOS = ["PENDIENTE_APROBACION", "APROBADO", "EN_PREPARACION", "EN_TRANSITO"] as const;

export async function getVehiculosDisponibles(): Promise<Vehiculo[]> {
  const [vehiculos, despachos] = await Promise.all([getVehiculosRaw(), getDespachosRaw()]);
  const vehiculosOcupados = new Set(
    despachos
      .filter((d) => (ESTADOS_DESPACHO_ACTIVOS as readonly string[]).includes(d.estado) && d.vehiculoId)
      .map((d) => d.vehiculoId)
  );
  return vehiculos.filter((v) => v.estado === "FUNCIONAL" && !vehiculosOcupados.has(v.id));
}

export async function getDespachosByVehiculoId(vehiculoId: string): Promise<DespachoConDetalle[]> {
  return (await getDespachosConDetalle()).filter((d) => d.vehiculoId === vehiculoId);
}

// ---------- Dashboard ----------

// La API devuelve "fecha" como timestamp ISO completo (viene de Postgres);
// se compara solo la parte de fecha (YYYY-MM-DD).
export async function getVentasDelDia(fecha: string): Promise<VentaConDetalle[]> {
  return (await getVentasConDetalle()).filter((v) => v.fecha.slice(0, 10) === fecha);
}
