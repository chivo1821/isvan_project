// Tipos de dominio para los datos mock de la Fase 1 (solo UI).
// Espejan el modelo de prisma/schema.prisma, pero usan `number` en vez de
// `Prisma.Decimal` para los montos, para simplificar el trabajo con datos
// estaticos en memoria. Cuando se conecte Prisma/FastAPI en Fase 2, estos
// tipos se reemplazan por los tipos generados de @prisma/client.

import type {
  AccionRevision,
  CategoriaProducto,
  EstadoDespacho,
  EstadoFactura,
  EstadoVehiculo,
  EstadoVenta,
  RolUsuario,
  TipoVehiculo,
} from "@prisma/client";

export type Usuario = {
  id: string;
  nombre: string;
  email: string;
  rol: RolUsuario;
  avatarUrl?: string | null;
  activo: boolean;
};

export type Almacen = {
  id: string;
  nombre: string;
  tipo: string;
  direccion: string;
  ciudad: string;
  lat: number;
  lng: number;
  esFrigorifico: boolean;
};

export type Vehiculo = {
  id: string;
  placa: string;
  tipo: TipoVehiculo;
  capacidadKg: number;
  tieneRefrigeracion: boolean;
  estado: EstadoVehiculo;
  almacenBaseId: string;
  conductorNombre?: string | null;
  ultimaRevision?: string | null;
};

export type Producto = {
  id: string;
  sku: string;
  nombre: string;
  categoria: CategoriaProducto;
  subcategoria?: string | null;
  unidadMedida: string;
  requiereCadenaFrio: boolean;
  temperaturaMinC?: number | null;
  temperaturaMaxC?: number | null;
  precioUnitario: number;
  activo: boolean;
};

export type StockAlmacen = {
  id: string;
  productoId: string;
  almacenId: string;
  cantidad: number;
  stockMinimo: number;
};

export type Cliente = {
  codigo: string;
  nombre: string;
  tipo: string;
  direccion: string;
  ciudad: string;
  lat?: number | null;
  lng?: number | null;
  telefono?: string | null;
  email?: string | null;
};

export type Factura = {
  id: string;
  numero: string;
  clienteId: string;
  monto: number;
  fechaEmision: string;
  fechaVencimiento: string;
  estado: EstadoFactura;
  /** Tasa BCV (Bs por USD) vigente en fechaEmision — ver TasaCambio. */
  tasaBcv: number;
  /** Datos de pago opcionales; lo relevante operativamente es pagoAprobado. */
  fechaPago?: string | null;
  montoPagado?: number | null;
  metodoPago?: string | null;
  pagoAprobado: boolean;
};

export type TasaCambio = {
  id: string;
  fecha: string;
  tasa: number;
};

export type VentaItem = {
  id: string;
  productoId: string;
  cantidad: number;
  precioUnitario: number;
  subtotal: number;
};

export type VentaRevision = {
  id: string;
  ventaId: string;
  usuarioId: string;
  accion: AccionRevision;
  comentario?: string | null;
  fecha: string;
};

export type Venta = {
  id: string;
  numero: string;
  clienteId: string;
  vendedorId: string;
  fecha: string;
  estado: EstadoVenta;
  /** Total en USD — valor canonico para reportes/analisis. */
  total: number;
  /** Tasa BCV (Bs por USD) vigente el dia de "fecha" — ver TasaCambio. */
  tasaBcv: number;
  items: VentaItem[];
};

export type DespachoItem = {
  id: string;
  productoId: string;
  cantidad: number;
};

export type DespachoAprobacion = {
  id: string;
  despachoId: string;
  usuarioId: string;
  accion: AccionRevision;
  comentario?: string | null;
  fecha: string;
};

export type RutaPunto = {
  id: string;
  despachoId: string;
  orden: number;
  lat: number;
  lng: number;
  estado: "salida" | "en_ruta" | "parada" | "entregado";
  timestamp: string;
  descripcion?: string | null;
};

export type Despacho = {
  id: string;
  numero: string;
  ventaId?: string | null;
  origenId: string;
  destinoClienteId: string;
  creadoPorId: string;
  estado: EstadoDespacho;
  fechaCreacion: string;
  fechaEstimadaEntrega?: string | null;
  vehiculoId?: string | null;
  distanciaEstimadaKm?: number | null;
  tiempoEstimadoMin?: number | null;
  rutaCalculada: boolean;
  items: DespachoItem[];
};
