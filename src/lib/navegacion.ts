// La distribución del menú en un solo lugar: el menú lateral muestra un
// enlace por área, las pestañas de arriba de cada pantalla muestran las
// secciones de su área y el buscador (Ctrl+K) las lista todas. Cada rol ve
// solo lo suyo; la regla de verdad sigue en (dashboard)/layout.tsx y en la
// API.

import {
  BarChart3Icon,
  BoxesIcon,
  Building2Icon,
  CarFrontIcon,
  ClipboardCheckIcon,
  HandCoinsIcon,
  LandmarkIcon,
  LayoutDashboardIcon,
  MapPinCheckIcon,
  NavigationIcon,
  PackageIcon,
  SettingsIcon,
  TruckIcon,
  WalletIcon,
} from "lucide-react";
import type { RolUsuario } from "@/lib/mock-data";

export type Seccion = {
  label: string;
  href: string;
  roles?: RolUsuario[];
  /** Palabras extra para encontrarla en el buscador. */
  claves?: string;
};

export type Area = {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  roles?: RolUsuario[];
  secciones: Seccion[];
  /** Va al final del menú, separado del trabajo diario. */
  abajo?: boolean;
};

// Roles que ven la operación completa. Un REPARTIDOR queda fuera a
// propósito: su única pantalla es el despachador.
const OPERACION: RolUsuario[] = ["ADMIN", "DESPACHOS", "APROBADOR"];
const ADMIN: RolUsuario[] = ["ADMIN"];
// El sistema administrativo (facturación, inventario) se ve solo donde se
// enciende con NEXT_PUBLIC_MODULO_ADMINISTRATIVO=1. En producción queda
// oculto hasta el corte.
const ADMINISTRATIVO = process.env.NEXT_PUBLIC_MODULO_ADMINISTRATIVO === "1";
const soloAdministrativo = (secciones: Seccion[]) => (ADMINISTRATIVO ? secciones : []);

export const AREAS: Area[] = [
  {
    id: "inicio",
    label: "Inicio",
    icon: LayoutDashboardIcon,
    roles: ADMIN,
    secciones: [{ label: "Resumen", href: "/" }],
  },
  {
    id: "ventas",
    label: "Ventas",
    icon: BarChart3Icon,
    roles: ADMIN,
    secciones: [
      { label: "Indicadores", href: "/indicadores", claves: "ventas cargas extracto metas" },
      { label: "Resultados y gastos", href: "/gastos", claves: "estado de resultados excel" },
      ...soloAdministrativo([
        { label: "Pedidos", href: "/administrativo/pedidos" },
        { label: "Documentos de venta", href: "/administrativo/documentos", claves: "facturas notas de credito" },
        { label: "Libro de ventas", href: "/administrativo/libro", claves: "iva seniat" },
      ]),
      { label: "Vendedores", href: "/supervisor", claves: "visitas rendimiento" },
      { label: "Censo", href: "/censo", claves: "clientes nuevos levantamiento" },
    ],
  },
  {
    id: "cobranzas",
    label: "Cobranzas",
    icon: HandCoinsIcon,
    roles: ["ADMIN", "COBRANZAS"],
    secciones: [
      { label: "Tablero", href: "/cobranzas", claves: "cartera deuda" },
      { label: "Pagos por verificar", href: "/cobranzas/pagos", claves: "comprobantes" },
      { label: "Clientes", href: "/cobranzas/clientes", claves: "estado de cuenta" },
    ],
  },
  {
    id: "logistica",
    label: "Logística",
    icon: TruckIcon,
    roles: OPERACION,
    secciones: [
      { label: "Despachos", href: "/despachos", claves: "nuevo despacho facturas" },
      { label: "Aprobación", href: "/despachos/aprobacion", roles: ["ADMIN", "APROBADOR"], claves: "aprobar despachos" },
      { label: "Rutas", href: "/rutas", claves: "nueva ruta viajes" },
      { label: "Planificación", href: "/rutas/planificacion", claves: "agenda salidas" },
      { label: "Seguimiento", href: "/seguimiento", claves: "mapa en transito" },
      { label: "Delivery en moto", href: "/delivery", roles: ADMIN, claves: "motorizados pagos" },
      { label: "Despachador", href: "/despachador", roles: ADMIN, claves: "repartidor telefono" },
    ],
  },
  {
    id: "clientes",
    label: "Clientes",
    icon: Building2Icon,
    roles: OPERACION,
    secciones: [{ label: "Clientes", href: "/clientes", claves: "maestra ubicaciones" }],
  },
  {
    id: "flota",
    label: "Flota",
    icon: CarFrontIcon,
    roles: OPERACION,
    secciones: [
      { label: "Vehículos", href: "/flota", claves: "camiones motos" },
      { label: "Choferes", href: "/flota/choferes", claves: "conductores" },
    ],
  },
  {
    id: "inventario",
    label: "Inventario",
    icon: BoxesIcon,
    roles: ADMIN,
    secciones: soloAdministrativo([
      { label: "Existencias", href: "/administrativo/inventario", claves: "lotes ajustes almacen" },
      { label: "Catálogo y precios", href: "/administrativo/catalogo", claves: "productos listas de precio" },
    ]),
  },
  {
    id: "bancos",
    label: "Bancos y caja",
    icon: LandmarkIcon,
    roles: ADMIN,
    secciones: soloAdministrativo([
      {
        label: "Bancos y caja",
        href: "/administrativo/bancos",
        claves: "cuentas tesoreria movimientos flujo de caja conciliacion",
      },
    ]),
  },

  // Los módulos de un solo rol: sus pantallas sueltas, como hasta ahora.
  { id: "mis-despachos", label: "Mis despachos", icon: PackageIcon, roles: ["VENDEDOR"], secciones: [{ label: "Mis despachos", href: "/vendedor" }] },
  { id: "visitas", label: "Visitas", icon: MapPinCheckIcon, roles: ["VENDEDOR"], secciones: [{ label: "Visitas", href: "/vendedor/visitas" }] },
  { id: "mis-indicadores", label: "Indicadores", icon: BarChart3Icon, roles: ["VENDEDOR"], secciones: [{ label: "Indicadores", href: "/vendedor/indicadores" }] },
  { id: "mi-censo", label: "Censo", icon: ClipboardCheckIcon, roles: ["VENDEDOR"], secciones: [{ label: "Censo", href: "/vendedor/censo" }] },
  { id: "supervision", label: "Vendedores", icon: MapPinCheckIcon, roles: ["SUPERVISOR"], secciones: [{ label: "Vendedores", href: "/supervisor" }] },
  { id: "censo-supervisor", label: "Censo de clientes", icon: ClipboardCheckIcon, roles: ["SUPERVISOR"], secciones: [{ label: "Censo de clientes", href: "/censo" }] },
  { id: "mis-pedidos", label: "Mis pedidos", icon: NavigationIcon, roles: ["REPARTIDOR"], secciones: [{ label: "Mis pedidos", href: "/despachador" }] },
  { id: "mi-cuenta", label: "Mi estado de cuenta", icon: WalletIcon, roles: ["REPARTIDOR"], secciones: [{ label: "Mi estado de cuenta", href: "/despachador/cuenta" }] },

  {
    id: "configuracion",
    label: "Configuración",
    icon: SettingsIcon,
    roles: ["ADMIN", "COBRANZAS"],
    abajo: true,
    secciones: [
      { label: "Usuarios", href: "/usuarios", roles: ADMIN, claves: "claves roles permisos" },
      ...soloAdministrativo([
        { label: "Empresas", href: "/administrativo/empresas", roles: ADMIN, claves: "rif datos fiscales" },
      ]),
      { label: "Cuentas del portal", href: "/cobranzas/cuentas", claves: "portal clientes acceso" },
      { label: "Ajustes de cobranzas", href: "/cobranzas/ajustes", claves: "dias de credito correo" },
    ],
  },
];

function puedeVer(roles: RolUsuario[] | undefined, rol: RolUsuario) {
  return !roles || roles.includes(rol);
}

/** Las áreas que ve un rol, cada una con solo sus secciones visibles. */
export function areasDe(rol: RolUsuario): Area[] {
  return AREAS.filter((a) => puedeVer(a.roles, rol))
    .map((a) => ({ ...a, secciones: a.secciones.filter((s) => puedeVer(s.roles, rol)) }))
    .filter((a) => a.secciones.length > 0);
}

function coincide(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** La sección (y su área) de la pantalla actual: la más específica que
 * coincide. /despachos/aprobacion es Aprobación y no Despachos;
 * /despachos/nuevo cae en Despachos. */
export function ubicar(pathname: string, areas: Area[]): { area: Area; seccion: Seccion } | null {
  let mejor: { area: Area; seccion: Seccion } | null = null;
  for (const area of areas) {
    for (const seccion of area.secciones) {
      if (coincide(pathname, seccion.href) && (!mejor || seccion.href.length > mejor.seccion.href.length)) {
        mejor = { area, seccion };
      }
    }
  }
  return mejor;
}
