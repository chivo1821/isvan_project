// Motorizados autogestionados: se registran solos y entran con placa + PIN
// (ver backend/app/services/motorizados.py y backend/app/api/motorizados.py).

/** GET /motorizados */
export type Motorizado = {
  id: string;
  nombre: string;
  telefono: string | null;
  activo: boolean;
  vehiculoId: string | null;
  placa: string | null;
  estadoVehiculo: string | null;
  capacidadKg: number | null;
  registradoEn: string;
  /** Bloqueado por PIN fallidos hasta este momento; null si no hay bloqueo vigente. */
  bloqueadoHasta: string | null;
  rutas: number;
  ultimaRuta: string | null;
};

/** GET /motorizados/codigo-registro */
export type CodigoRegistro = {
  codigo: string | null;
  actualizadoEn?: string | null;
  actualizadoPor?: string | null;
};
