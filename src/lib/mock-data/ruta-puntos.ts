// MOCK DATA — reemplazar en Fase 2 por datos reales desde el backend.
import type { RutaPunto } from "./types";

export const rutaPuntos: RutaPunto[] = [
  // D-0002 (ENTREGADO): Almacén Catia (Caracas) -> Abastos La Esperanza (Valencia)
  {
    id: "rp-1",
    despachoId: "desp-2",
    orden: 1,
    lat: 10.512937,
    lng: -66.944611,
    estado: "salida",
    timestamp: "2026-08-01T08:00:00",
    descripcion: "Salida de Almacén Catia",
  },
  {
    id: "rp-2",
    despachoId: "desp-2",
    orden: 2,
    lat: 10.35,
    lng: -67.45,
    estado: "en_ruta",
    timestamp: "2026-08-01T09:20:00",
    descripcion: "Pasando por Los Teques, Autopista Regional del Centro",
  },
  {
    id: "rp-3",
    despachoId: "desp-2",
    orden: 3,
    lat: 10.1751,
    lng: -68.0011,
    estado: "entregado",
    timestamp: "2026-08-01T10:45:00",
    descripcion: "Entregado en Abastos La Esperanza",
  },

  // D-0007 (EN_TRANSITO): Almacén Catia (Caracas) -> Mayorista Los Andes (Barquisimeto)
  {
    id: "rp-4",
    despachoId: "desp-7",
    orden: 1,
    lat: 10.512937,
    lng: -66.944611,
    estado: "salida",
    timestamp: "2026-08-07T06:00:00",
    descripcion: "Salida de Almacén Catia",
  },
  {
    id: "rp-5",
    despachoId: "desp-7",
    orden: 2,
    lat: 10.16,
    lng: -68.0,
    estado: "en_ruta",
    timestamp: "2026-08-07T08:10:00",
    descripcion: "Pasando por Valencia",
  },
  {
    id: "rp-6",
    despachoId: "desp-7",
    orden: 3,
    lat: 10.11,
    lng: -68.75,
    estado: "en_ruta",
    timestamp: "2026-08-07T10:15:00",
    descripcion: "Aproximándose a Barquisimeto (posición actual)",
  },
];
