// Capa de selectores sobre los datos mock. Las paginas/componentes deben
// consumir estas funciones (no los arrays crudos directamente) para que, en
// Fase 2, solo haya que reemplazar esta capa por llamadas reales a la API sin
// tocar el resto del codigo.
import { almacenes } from "./almacenes";
import { clientes } from "./clientes";
import { despachoAprobaciones, despachos } from "./despachos";
import { facturas } from "./facturas";
import { productos } from "./productos";
import { rutaPuntos } from "./ruta-puntos";
import { rutasOptimizadas } from "./rutas-optimizadas";
import { stock } from "./stock";
import { getTasaByFecha, tasasCambio } from "./tasas-cambio";
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
  Vehiculo,
} from "./types";
import { usuarioActual, usuarios } from "./usuarios";
import { ventaRevisiones, ventas } from "./ventas";
import { vehiculos } from "./vehiculos";

export * from "./types";
export {
  almacenes,
  clientes,
  despachoAprobaciones,
  despachos,
  facturas,
  getTasaByFecha,
  productos,
  rutaPuntos,
  rutasOptimizadas,
  stock,
  tasasCambio,
  usuarioActual,
  usuarios,
  ventaRevisiones,
  ventas,
  vehiculos,
};

// ---------- Catalogo ----------

export function getProductoById(id: string): Producto | undefined {
  return productos.find((p) => p.id === id);
}

export function getAlmacenById(id: string): Almacen | undefined {
  return almacenes.find((a) => a.id === id);
}

export function getClienteByCodigo(codigo: string): Cliente | undefined {
  return clientes.find((c) => c.codigo === codigo);
}

export function getUsuarioById(id: string): Usuario | undefined {
  return usuarios.find((u) => u.id === id);
}

export function getVehiculoById(id: string): Vehiculo | undefined {
  return vehiculos.find((v) => v.id === id);
}

// ---------- Inventario ----------

export function getStockByProducto(productoId: string): StockAlmacen[] {
  return stock.filter((s) => s.productoId === productoId);
}

export function getStockTotalByProducto(productoId: string): number {
  return getStockByProducto(productoId).reduce((sum, s) => sum + s.cantidad, 0);
}

export function productoTieneStockBajo(productoId: string): boolean {
  return getStockByProducto(productoId).some((s) => s.cantidad < s.stockMinimo);
}

export function getProductosBajoStock(): Producto[] {
  return productos.filter((p) => productoTieneStockBajo(p.id));
}

// ---------- Clientes / Facturas ----------

export function getFacturasByCliente(clienteId: string): Factura[] {
  return facturas.filter((f) => f.clienteId === clienteId);
}

export function getFacturasPendientesByCliente(clienteId: string): Factura[] {
  return getFacturasByCliente(clienteId).filter((f) => f.estado === "PENDIENTE" || f.estado === "VENCIDA");
}

export function clienteTieneFacturaPendiente(clienteId: string): boolean {
  return getFacturasPendientesByCliente(clienteId).length > 0;
}

// ---------- Ventas ----------

export type VentaConDetalle = Venta & {
  cliente: Cliente;
  vendedor: Usuario;
  itemsConProducto: (VentaItem & { producto: Producto })[];
  revisiones: (typeof ventaRevisiones);
  despacho?: Despacho;
};

export function getVentaConDetalle(id: string): VentaConDetalle | undefined {
  const venta = ventas.find((v) => v.id === id);
  if (!venta) return undefined;
  const cliente = getClienteByCodigo(venta.clienteId)!;
  const vendedor = getUsuarioById(venta.vendedorId)!;
  return {
    ...venta,
    cliente,
    vendedor,
    itemsConProducto: venta.items.map((item) => ({ ...item, producto: getProductoById(item.productoId)! })),
    revisiones: ventaRevisiones.filter((r) => r.ventaId === venta.id),
    despacho: despachos.find((d) => d.ventaId === venta.id),
  };
}

export function getVentasConDetalle(): VentaConDetalle[] {
  return ventas.map((v) => getVentaConDetalle(v.id)!);
}

export function getVentasEnRevision(): VentaConDetalle[] {
  return getVentasConDetalle().filter((v) => v.estado === "EN_REVISION");
}

// Ventas aprobadas que todavia no generaron un despacho — son las elegibles
// para el wizard "Nuevo despacho" (que ya no pide cargar productos a mano,
// los toma directo de la venta seleccionada).
export function getVentasAprobadasSinDespacho(): VentaConDetalle[] {
  return getVentasConDetalle().filter((v) => v.estado === "APROBADA" && !v.despacho);
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

export function getDespachoConDetalle(id: string): DespachoConDetalle | undefined {
  const despacho = despachos.find((d) => d.id === id);
  if (!despacho) return undefined;
  return {
    ...despacho,
    origen: getAlmacenById(despacho.origenId)!,
    destinoCliente: getClienteByCodigo(despacho.destinoClienteId)!,
    creadoPor: getUsuarioById(despacho.creadoPorId)!,
    vehiculo: despacho.vehiculoId ? getVehiculoById(despacho.vehiculoId) : undefined,
    itemsConProducto: despacho.items.map((item) => ({ ...item, producto: getProductoById(item.productoId)! })),
    aprobaciones: despachoAprobaciones.filter((a) => a.despachoId === despacho.id),
    ruta: rutaPuntos.filter((r) => r.despachoId === despacho.id).sort((a, b) => a.orden - b.orden),
    venta: despacho.ventaId ? ventas.find((v) => v.id === despacho.ventaId) : undefined,
  };
}

export function getDespachosConDetalle(): DespachoConDetalle[] {
  return despachos.map((d) => getDespachoConDetalle(d.id)!);
}

export function getDespachosPendientesAprobacion(): DespachoConDetalle[] {
  return getDespachosConDetalle().filter((d) => d.estado === "PENDIENTE_APROBACION");
}

export function getDespachosEnTransito(): DespachoConDetalle[] {
  return getDespachosConDetalle().filter((d) => d.estado === "EN_TRANSITO");
}

export function getRutaByDespachoId(despachoId: string): RutaPunto[] {
  return rutaPuntos.filter((r) => r.despachoId === despachoId).sort((a, b) => a.orden - b.orden);
}

export function getMejorRutaByDespachoId(despachoId: string) {
  return rutasOptimizadas[despachoId];
}

// Despachos que ocupan un vehiculo en este momento (no liberado todavia).
const ESTADOS_DESPACHO_ACTIVOS = ["PENDIENTE_APROBACION", "APROBADO", "EN_PREPARACION", "EN_TRANSITO"] as const;

export function getVehiculosDisponibles(): Vehiculo[] {
  const vehiculosOcupados = new Set(
    despachos
      .filter((d) => (ESTADOS_DESPACHO_ACTIVOS as readonly string[]).includes(d.estado) && d.vehiculoId)
      .map((d) => d.vehiculoId)
  );
  return vehiculos.filter((v) => v.estado === "FUNCIONAL" && !vehiculosOcupados.has(v.id));
}

export function getDespachosByVehiculoId(vehiculoId: string): DespachoConDetalle[] {
  return getDespachosConDetalle().filter((d) => d.vehiculoId === vehiculoId);
}

// ---------- Dashboard ----------

export function getVentasDelDia(fecha: string): VentaConDetalle[] {
  return getVentasConDetalle().filter((v) => v.fecha === fecha);
}
