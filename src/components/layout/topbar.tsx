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
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { UserNav } from "@/components/layout/user-nav";
import type { RolUsuario } from "@prisma/client";

const SEGMENT_LABELS: Record<string, string> = {
  ventas: "Ventas",
  nueva: "Nueva venta",
  revision: "Revisión",
  inventario: "Inventario",
  categorias: "Categorías",
  despachos: "Despachos",
  nuevo: "Nuevo despacho",
  aprobacion: "Aprobación",
  flota: "Flota",
  seguimiento: "Seguimiento",
  usuarios: "Usuarios",
};

function labelForSegment(segment: string) {
  return SEGMENT_LABELS[segment] ?? "Detalle";
}

export function Topbar({
  user,
}: {
  user: { nombre: string; email: string; rol: RolUsuario; avatarUrl?: string | null };
}) {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border bg-card px-4">
      <div className="flex items-center gap-2">
        <SidebarTrigger />
        <Separator orientation="vertical" className="h-5" />
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link href="/">Inicio</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            {segments.map((segment, index) => {
              const href = `/${segments.slice(0, index + 1).join("/")}`;
              const isLast = index === segments.length - 1;
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
