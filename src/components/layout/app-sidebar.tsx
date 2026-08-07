"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ClipboardCheckIcon,
  IceCreamConeIcon,
  LayoutDashboardIcon,
  MapPinnedIcon,
  PackageIcon,
  ShoppingCartIcon,
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
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";

type NavLeaf = { label: string; href: string };
type NavItem = { label: string; href: string; icon: React.ComponentType<{ className?: string }>; children?: NavLeaf[] };
type NavGroup = { label: string; items: NavItem[] };

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Ventas",
    items: [
      {
        label: "Ventas",
        href: "/ventas",
        icon: ShoppingCartIcon,
        children: [
          { label: "Todas las ventas", href: "/ventas" },
          { label: "Nueva venta", href: "/ventas/nueva" },
          { label: "Revisión de ventas", href: "/ventas/revision" },
        ],
      },
    ],
  },
  {
    label: "Inventario",
    items: [{ label: "Inventario", href: "/inventario", icon: PackageIcon }],
  },
  {
    label: "Despachos",
    items: [
      {
        label: "Despachos",
        href: "/despachos",
        icon: TruckIcon,
        children: [
          { label: "Todos los despachos", href: "/despachos" },
          { label: "Nuevo despacho", href: "/despachos/nuevo" },
          { label: "Aprobación de despachos", href: "/despachos/aprobacion" },
        ],
      },
    ],
  },
  {
    label: "Flota",
    items: [{ label: "Vehículos", href: "/flota", icon: ClipboardCheckIcon }],
  },
  {
    label: "Seguimiento",
    items: [{ label: "Seguimiento", href: "/seguimiento", icon: MapPinnedIcon }],
  },
  {
    label: "Administración",
    items: [{ label: "Usuarios", href: "/usuarios", icon: UsersIcon }],
  },
];

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppSidebar() {
  const pathname = usePathname();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild size="lg">
              <Link href="/">
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
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={pathname === "/"} tooltip="Inicio">
                  <Link href="/">
                    <LayoutDashboardIcon />
                    <span>Inicio</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {NAV_GROUPS.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label.toUpperCase()}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  const active = isActive(pathname, item.href);
                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton asChild isActive={active} tooltip={item.label}>
                        <Link href={item.href}>
                          <item.icon />
                          <span>{item.label}</span>
                        </Link>
                      </SidebarMenuButton>
                      {item.children && (
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
