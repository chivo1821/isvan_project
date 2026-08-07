// MOCK DATA — reemplazar en Fase 2 por datos reales desde el backend.
// Un solo almacén (Almacén Catia), asi que hay una fila de stock por producto.
import type { StockAlmacen } from "./types";

export const stock: StockAlmacen[] = [
  { id: "stk-1", productoId: "prod-1", almacenId: "alm-catia", cantidad: 1400, stockMinimo: 500 },
  { id: "stk-2", productoId: "prod-2", almacenId: "alm-catia", cantidad: 1200, stockMinimo: 500 },
  { id: "stk-3", productoId: "prod-3", almacenId: "alm-catia", cantidad: 380, stockMinimo: 500 },
  { id: "stk-4", productoId: "prod-4", almacenId: "alm-catia", cantidad: 320, stockMinimo: 120 },
  { id: "stk-5", productoId: "prod-5", almacenId: "alm-catia", cantidad: 300, stockMinimo: 120 },
  { id: "stk-6", productoId: "prod-6", almacenId: "alm-catia", cantidad: 90, stockMinimo: 120 },
  { id: "stk-7", productoId: "prod-7", almacenId: "alm-catia", cantidad: 250, stockMinimo: 120 },
  { id: "stk-8", productoId: "prod-8", almacenId: "alm-catia", cantidad: 420, stockMinimo: 150 },
  { id: "stk-9", productoId: "prod-9", almacenId: "alm-catia", cantidad: 110, stockMinimo: 150 },
  { id: "stk-10", productoId: "prod-10", almacenId: "alm-catia", cantidad: 280, stockMinimo: 130 },
  { id: "stk-11", productoId: "prod-11", almacenId: "alm-catia", cantidad: 260, stockMinimo: 90 },
  { id: "stk-12", productoId: "prod-12", almacenId: "alm-catia", cantidad: 230, stockMinimo: 90 },
  { id: "stk-13", productoId: "prod-13", almacenId: "alm-catia", cantidad: 190, stockMinimo: 90 },
  { id: "stk-14", productoId: "prod-14", almacenId: "alm-catia", cantidad: 70, stockMinimo: 90 },
  { id: "stk-15", productoId: "prod-15", almacenId: "alm-catia", cantidad: 110, stockMinimo: 70 },
  { id: "stk-16", productoId: "prod-16", almacenId: "alm-catia", cantidad: 400, stockMinimo: 140 },
  { id: "stk-17", productoId: "prod-17", almacenId: "alm-catia", cantidad: 150, stockMinimo: 180 },
  { id: "stk-18", productoId: "prod-18", almacenId: "alm-catia", cantidad: 140, stockMinimo: 90 },
];
