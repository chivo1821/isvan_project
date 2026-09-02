// Tipos de dominio para el frontend. Espejan el modelo de
// prisma/schema.prisma, pero usan `number` en vez de `Prisma.Decimal` /
// tipos anidados donde simplifica el trabajo con la respuesta JSON de la
// API (ver src/lib/api-client.ts y backend/app/schemas.py).

import type {
  AccionRevision,
  Empresa,
  EstadoDespacho,
  EstadoRuta,
  EstadoVehiculo,
  RolUsuario,
  TipoVehiculo,
} from "@prisma/client";

export type { AccionRevision, Empresa, EstadoDespacho, EstadoRuta, EstadoVehiculo, RolUsuario, TipoVehiculo };

export type Usuario = {
  id: string;
  nombre: string;
  email: string;
  rol: RolUsuario;
  avatarUrl?: string | null;
  activo: boolean;
  /**
   * Solo aplica al rol REPARTIDOR: el vehículo que maneja. Determina la
   * única ruta que ese usuario puede ver (ver backend/app/core/permisos.py).
   */
  vehiculoAsignadoId?: string | null;
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
  /** Costo operativo por km (USD) para estimar el costo de una ruta sugerida. */
  costoPorKm?: number | null;
};

// El mismo codigo puede referirse a clientes distintos segun la empresa
// (ISVAN / TRALOG) — la llave de negocio real es (empresa, codigo), no el
// codigo solo. `id` es la llave tecnica usada por el resto del modelo.
export type Cliente = {
  id: string;
  empresa: Empresa;
  codigo: string;
  nombre: string;
  tipo: string;
  direccion: string;
  ciudad: string;
  lat?: number | null;
  lng?: number | null;
  /** Obligatorio: lo usan los despachadores para contactar al cliente. */
  telefono: string;
  email?: string | null;
  /**
   * Ruta comercial (de venta/reparto) que el negocio le asigna al cliente,
   * p.ej. "R-07" — NO es la `Ruta` (viaje) de este sistema. Viene del
   * extracto de ventas y pesa al sugerir cómo agrupar despachos en un viaje.
   */
  rutaComercial?: string | null;
};

// Texto libre (viene del Excel o de carga manual) — ya no hay catalogo de
// productos del que derivarlo.
export type DespachoItem = {
  id: string;
  descripcion: string;
  /** Lo que realmente se va a despachar (ajustable hasta que el despacho sale del almacén). */
  cantidad: number;
  /** Lo que pedía originalmente el documento (factura/nota de entrega) importado. */
  cantidadSolicitada: number;
  pesoUnitarioKg: number;
  requiereFrio: boolean;
};

export type DespachoAprobacion = {
  id: string;
  despachoId: string;
  usuarioId: string;
  accion: AccionRevision;
  comentario?: string | null;
  fecha: string;
};

export type Despacho = {
  id: string;
  numero: string;
  /** Numero de factura/nota de entrega del documento origen — unico, llave de idempotencia de la importación. */
  numeroDocumento: string;
  origenId: string;
  destinoClienteId: string;
  creadoPorId: string;
  estado: EstadoDespacho;
  fechaCreacion: string;
  fechaEstimadaEntrega?: string | null;
  /** Si ya forma parte de una Ruta multi-parada, y en qué posición. */
  rutaId?: string | null;
  ordenEnRuta?: number | null;
  items: DespachoItem[];
};

export type RutaPunto = {
  id: string;
  rutaId: string;
  orden: number;
  lat: number;
  lng: number;
  estado: "salida" | "en_ruta" | "parada" | "entregado";
  timestamp: string;
  descripcion?: string | null;
  /** Si este punto es la llegada/entrega de un despacho puntual dentro del viaje. */
  paradaDespachoId?: string | null;
};

// Un viaje de un vehiculo que agrupa varios despachos (uno por cliente),
// visitados en el orden calculado por el optimizador desde Almacén Catia.
export type Ruta = {
  id: string;
  numero: string;
  vehiculoId: string;
  origenId: string;
  creadoPorId: string;
  estado: EstadoRuta;
  fechaCreacion: string;
  distanciaTotalKm?: number | null;
  tiempoTotalMin?: number | null;
  despachos: Despacho[];
  puntos: RutaPunto[];
};
