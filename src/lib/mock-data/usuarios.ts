// MOCK DATA — reemplazar en Fase 2 por datos reales desde el backend.
import type { Usuario } from "./types";

export const usuarios: Usuario[] = [
  {
    id: "usr-1",
    nombre: "Gustavo Marquina",
    email: "gustavo.marquina@heladosypizzas.com",
    rol: "ADMIN",
    avatarUrl: null,
    activo: true,
  },
  {
    id: "usr-2",
    nombre: "Carla Pérez",
    email: "carla.perez@heladosypizzas.com",
    rol: "VENTAS",
    avatarUrl: null,
    activo: true,
  },
  {
    id: "usr-3",
    nombre: "Miguel Ángel Torres",
    email: "miguel.torres@heladosypizzas.com",
    rol: "DESPACHOS",
    avatarUrl: null,
    activo: true,
  },
  {
    id: "usr-4",
    nombre: "Rosa Delgado",
    email: "rosa.delgado@heladosypizzas.com",
    rol: "APROBADOR",
    avatarUrl: null,
    activo: true,
  },
  {
    id: "usr-5",
    nombre: "José Ramírez",
    email: "jose.ramirez@heladosypizzas.com",
    rol: "INVENTARIO",
    avatarUrl: null,
    activo: true,
  },
  {
    id: "usr-6",
    nombre: "Andrea Silva",
    email: "andrea.silva@heladosypizzas.com",
    rol: "REPARTIDOR",
    avatarUrl: null,
    activo: true,
  },
];

// Usuario que se muestra como sesion activa en el topbar durante esta fase de UI.
export const usuarioActual = usuarios[0];
