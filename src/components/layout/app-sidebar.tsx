"use client";

import Link from "@/components/shared/enlace";
import { usePathname } from "next/navigation";
import { IceCreamConeIcon } from "lucide-react";
import { BuscadorPantallas } from "@/components/layout/buscador-pantallas";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { INICIO_POR_ROL } from "@/lib/constants";
import type { RolUsuario } from "@/lib/mock-data";
import { areasDe, ubicar, type Area } from "@/lib/navegacion";
import { useSinSenal } from "@/lib/seguimiento";

/** Un enlace por área (ver src/lib/navegacion.ts). Las secciones de cada
 * área van como pestañas arriba de la pantalla (PestanasArea), no aquí: así
 * el menú queda corto aunque el sistema siga creciendo. */
export function AppSidebar({ rol }: { rol: RolUsuario }) {
  const pathname = usePathname();
  // La API deja ver las posiciones a DESPACHOS y APROBADOR (y al ADMIN).
  const sinSenal = useSinSenal(rol === "ADMIN" || rol === "DESPACHOS" || rol === "APROBADOR");
  const areas = areasDe(rol);
  const actual = ubicar(pathname, areas)?.area.id;
  const arriba = areas.filter((a) => !a.abajo);
  const abajo = areas.filter((a) => a.abajo);

  const enlace = (area: Area) => (
    <SidebarMenuItem key={area.id}>
      <SidebarMenuButton asChild isActive={area.id === actual} tooltip={area.label}>
        <Link href={area.secciones[0].href}>
          <area.icon />
          <span>{area.label}</span>
        </Link>
      </SidebarMenuButton>
      {area.id === "logistica" && sinSenal > 0 && (
        <SidebarMenuBadge
          className="bg-amber-500/15 text-amber-700 peer-hover/menu-button:text-amber-700 peer-data-active/menu-button:text-amber-700"
          title="Repartidores que dejaron de enviar su ubicación"
          aria-label={`${sinSenal} repartidor(es) dejaron de enviar su ubicación`}
        >
          {sinSenal}
        </SidebarMenuBadge>
      )}
    </SidebarMenuItem>
  );

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild size="lg">
              <Link href={INICIO_POR_ROL[rol]}>
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                  <IceCreamConeIcon className="size-4.5" />
                </span>
                <span className="flex flex-col">
                  <span className="text-sm font-semibold">Gestión Logística</span>
                </span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          {areas.some((a) => a.secciones.length > 1) && <BuscadorPantallas areas={areas} />}
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>{arriba.map(enlace)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      {abajo.length > 0 && (
        <SidebarFooter>
          <SidebarMenu>{abajo.map(enlace)}</SidebarMenu>
        </SidebarFooter>
      )}
    </Sidebar>
  );
}
