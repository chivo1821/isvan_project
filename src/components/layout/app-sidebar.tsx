"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Collapsible as CollapsiblePrimitive } from "radix-ui";
import {
  Building2Icon,
  ChevronRightIcon,
  ClipboardCheckIcon,
  IceCreamConeIcon,
  LayoutDashboardIcon,
  MapPinCheckIcon,
  MapPinnedIcon,
  NavigationIcon,
  PackageIcon,
  RouteIcon,
  TruckIcon,
  UsersIcon,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";
import { INICIO_POR_ROL } from "@/lib/constants";
import type { RolUsuario } from "@/lib/mock-data";

type NavLeaf = { label: string; href: string; roles?: RolUsuario[] };
type NavItem = {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  children?: NavLeaf[];
  roles?: RolUsuario[];
  /** Activo solo en su ruta exacta, no en las que cuelgan de ella
   * (/vendedor no debe marcarse cuando se está en /vendedor/visitas). */
  exacto?: boolean;
};
type NavGroup = { label: string; items: NavItem[] };

// Roles que ven la operación completa. Un REPARTIDOR queda fuera a
// propósito: su única pantalla es el despachador (ver (dashboard)/layout.tsx
// y backend/app/core/permisos.py).
const ROLES_OPERACION: RolUsuario[] = ["ADMIN", "DESPACHOS", "APROBADOR"];

const NAV_GROUPS: NavGroup[] = [
  {
    // Único módulo de un VENDEDOR (ver (dashboard)/layout.tsx y
    // backend/app/api/vendedor.py).
    label: "Ventas",
    items: [
      { label: "Mis despachos", href: "/vendedor", icon: PackageIcon, roles: ["VENDEDOR"], exacto: true },
      { label: "Visitas", href: "/vendedor/visitas", icon: MapPinCheckIcon, roles: ["VENDEDOR"] },
    ],
  },
  {
    label: "Rutas y despachos",
    items: [
      {
        label: "Despachos",
        href: "/despachos",
        icon: TruckIcon,
        roles: ROLES_OPERACION,
        children: [
          { label: "Todos los despachos", href: "/despachos" },
          { label: "Nuevo despacho", href: "/despachos/nuevo", roles: ["ADMIN", "DESPACHOS"] },
          { label: "Aprobación de despachos", href: "/despachos/aprobacion", roles: ["ADMIN", "APROBADOR"] },
        ],
      },
      {
        label: "Rutas",
        href: "/rutas",
        icon: RouteIcon,
        roles: ROLES_OPERACION,
        children: [
          { label: "Todas las rutas", href: "/rutas" },
          { label: "Nueva ruta", href: "/rutas/nueva", roles: ["ADMIN", "DESPACHOS"] },
        ],
      },
    ],
  },
  {
    label: "Clientes y flota",
    items: [
      { label: "Clientes", href: "/clientes", icon: Building2Icon, roles: ROLES_OPERACION },
      {
        label: "Vehículos",
        href: "/flota",
        icon: ClipboardCheckIcon,
        roles: ROLES_OPERACION,
        children: [
          { label: "Todos los vehículos", href: "/flota" },
          { label: "Choferes", href: "/flota/choferes" },
        ],
      },
    ],
  },
  {
    label: "Seguimiento",
    items: [
      { label: "Seguimiento", href: "/seguimiento", icon: MapPinnedIcon, roles: ROLES_OPERACION },
      { label: "Despachador", href: "/despachador", icon: NavigationIcon, roles: ["ADMIN", "REPARTIDOR"] },
    ],
  },
  {
    label: "Administración",
    items: [{ label: "Usuarios", href: "/usuarios", icon: UsersIcon, roles: ["ADMIN"] }],
  },
];

// Pantallas del bloque "Inicio", solo para ADMIN (la regla de verdad está
// en (dashboard)/layout.tsx y en la API).
const INICIO_HIJOS: NavLeaf[] = [
  { label: "Resumen", href: "/" },
  { label: "Indicadores de venta", href: "/indicadores" },
  { label: "Delivery en moto", href: "/delivery" },
];

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** "Inicio" desplegable: el enlace lleva al resumen y la flecha abre o
 * cierra sus pantallas. */
function InicioAdmin({ pathname }: { pathname: string }) {
  const [abierto, setAbierto] = useState(true);
  const activo = INICIO_HIJOS.some((hijo) => isActive(pathname, hijo.href));

  return (
    <CollapsiblePrimitive.Root open={abierto} onOpenChange={setAbierto} asChild>
      <SidebarMenuItem>
        <SidebarMenuButton asChild isActive={activo} tooltip="Inicio">
          <Link href="/">
            <LayoutDashboardIcon />
            <span>Inicio</span>
          </Link>
        </SidebarMenuButton>
        <CollapsiblePrimitive.Trigger asChild>
          <SidebarMenuAction
            className="transition-transform data-[state=open]:rotate-90"
            aria-label={abierto ? "Cerrar Inicio" : "Abrir Inicio"}
          >
            <ChevronRightIcon />
          </SidebarMenuAction>
        </CollapsiblePrimitive.Trigger>
        <CollapsiblePrimitive.Content>
          <SidebarMenuSub>
            {INICIO_HIJOS.map((hijo) => (
              <SidebarMenuSubItem key={hijo.href}>
                <SidebarMenuSubButton asChild isActive={isActive(pathname, hijo.href)}>
                  <Link href={hijo.href}>{hijo.label}</Link>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            ))}
          </SidebarMenuSub>
        </CollapsiblePrimitive.Content>
      </SidebarMenuItem>
    </CollapsiblePrimitive.Root>
  );
}

function puedeVer(roles: RolUsuario[] | undefined, rol: RolUsuario) {
  return !roles || roles.includes(rol);
}

export function AppSidebar({ rol }: { rol: RolUsuario }) {
  const pathname = usePathname();
  const esAdmin = rol === "ADMIN";
  const inicio = INICIO_POR_ROL[rol];

  const grupos = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items
      .filter((item) => puedeVer(item.roles, rol))
      .map((item) => ({
        ...item,
        children: item.children?.filter((child) => puedeVer(child.roles, rol)),
      })),
  })).filter((group) => group.items.length > 0);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild size="lg">
              <Link href={inicio}>
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                  <IceCreamConeIcon className="size-4.5" />
                </span>
                <span className="flex flex-col">
                  <span className="text-sm font-semibold">Gestión Logística</span>
                  <span className="text-xs text-muted-foreground">Helados &amp; Pizzas</span>
                </span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {esAdmin && (
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                <InicioAdmin pathname={pathname} />
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {grupos.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label.toUpperCase()}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  const active = item.exacto ? pathname === item.href : isActive(pathname, item.href);
                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton asChild isActive={active} tooltip={item.label}>
                        <Link href={item.href}>
                          <item.icon />
                          <span>{item.label}</span>
                        </Link>
                      </SidebarMenuButton>
                      {item.children && item.children.length > 0 && (
                        <SidebarMenuSub>
                          {item.children.map((child) => (
                            <SidebarMenuSubItem key={child.href}>
                              <SidebarMenuSubButton asChild isActive={pathname === child.href}>
                                <Link href={child.href}>{child.label}</Link>
                              </SidebarMenuSubButton>
                            </SidebarMenuSubItem>
                          ))}
                        </SidebarMenuSub>
                      )}
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
    </Sidebar>
  );
}
