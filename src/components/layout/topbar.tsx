"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { INICIO_POR_ROL } from "@/lib/constants";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { UserNav } from "@/components/layout/user-nav";
import type { RolUsuario } from "@prisma/client";

const SEGMENT_LABELS: Record<string, string> = {
  despachos: "Despachos",
  nuevo: "Nuevo despacho",
  aprobacion: "Aprobación",
  rutas: "Rutas",
  clientes: "Clientes",
  flota: "Flota",
  seguimiento: "Seguimiento",
  despachador: "Despachador",
  usuarios: "Usuarios",
  indicadores: "Indicadores de venta",
  cargas: "Cargas",
  choferes: "Choferes",
  vendedor: "Mis despachos",
  visitas: "Visitas",
};

function labelForSegment(segment: string) {
  return SEGMENT_LABELS[segment] ?? "Detalle";
}

export function Topbar({
  user,
}: {
  user: { id: string; nombre: string; email: string; rol: RolUsuario; avatarUrl?: string | null };
}) {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);
  // Solo ADMIN tiene "Inicio": para los demás roles el enlace a "/" los
  // devolvería a su propio módulo (ver (dashboard)/layout.tsx).
  // Repartidor y vendedor tienen un solo módulo, que ya es la raíz de la
  // miga: su primer segmento no se repite.
  const moduloUnico = user.rol === "REPARTIDOR" || user.rol === "VENDEDOR";
  const raiz =
    user.rol === "ADMIN"
      ? { href: "/", label: "Inicio" }
      : { href: INICIO_POR_ROL[user.rol], label: SEGMENT_LABELS[INICIO_POR_ROL[user.rol].split("/")[1]] ?? "Inicio" };

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border bg-card px-4">
      <div className="flex items-center gap-2">
        <SidebarTrigger />
        <Separator orientation="vertical" className="h-5" />
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link href={raiz.href}>{raiz.label}</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            {(moduloUnico ? segments.slice(1) : segments).map((segment, index) => {
              const desplazamiento = moduloUnico ? 1 : 0;
              const href = `/${segments.slice(0, index + 1 + desplazamiento).join("/")}`;
              const isLast = index + desplazamiento === segments.length - 1;
              return (
                <span key={href} className="flex items-center gap-1.5">
                  <BreadcrumbSeparator />
                  <BreadcrumbItem>
                    {isLast ? (
                      <BreadcrumbPage>{labelForSegment(segment)}</BreadcrumbPage>
                    ) : (
                      <BreadcrumbLink asChild>
                        <Link href={href}>{labelForSegment(segment)}</Link>
                      </BreadcrumbLink>
                    )}
                  </BreadcrumbItem>
                </span>
              );
            })}
          </BreadcrumbList>
        </Breadcrumb>
      </div>
      <UserNav user={user} />
    </header>
  );
}
