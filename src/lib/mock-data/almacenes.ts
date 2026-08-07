// MOCK DATA — reemplazar en Fase 2 por datos reales desde el backend.
import type { Almacen } from "./types";

// La empresa opera con un unico almacen/centro de acopio.
export const almacenes: Almacen[] = [
  {
    id: "alm-catia",
    nombre: "Almacén Catia",
    tipo: "Centro de Distribución",
    direccion: "Catia",
    ciudad: "Caracas",
    lat: 10.512937,
    lng: -66.944611,
    esFrigorifico: true,
  },
];
