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
import { INICIO_POR_ROL, MODULOS_POR_ROL, enModulo } from "@/lib/constants";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { UserNav } from "@/components/layout/user-nav";
import type { Usuario } from "@/lib/mock-data";

const SEGMENT_LABELS: Record<string, string> = {
  despachos: "Despachos",
  nuevo: "Nuevo despacho",
  aprobacion: "Aprobación",
  rutas: "Rutas",
  clientes: "Clientes",
  flota: "Flota",
  seguimiento: "Seguimiento",
  despachador: "Despachador",
  cuenta: "Mi estado de cuenta",
  usuarios: "Usuarios",
  indicadores: "Indicadores de venta",
  delivery: "Delivery en moto",
  cargas: "Cargas y cobertura",
  choferes: "Choferes",
  vendedor: "Mis despachos",
  visitas: "Visitas",
  cobranzas: "Cobranzas",
  supervisor: "Vendedores",
  censo: "Censo de clientes",
  pagos: "Pagos",
  cuentas: "Cuentas del portal",
  ajustes: "Ajustes",
  documentos: "Documentos",
  ISVAN: "ISVAN",
  TRALOG: "TRALOG",
};

function labelForSegment(segment: string) {
  return SEGMENT_LABELS[segment] ?? "Detalle";
}

export function Topbar({
  user,
}: {
  user: Pick<Usuario, "id" | "nombre" | "email" | "rol" | "avatarUrl" | "autogestionado" | "telefono">;
}) {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);
  // Solo ADMIN tiene "Inicio": para los demás roles el enlace a "/" los
  // devolvería a su propio módulo (ver (dashboard)/layout.tsx).
  // Los roles con pantallas propias (repartidor, vendedor, cobranzas,
  // supervisor): la pantalla en la que está es la raíz de la miga y su
  // primer segmento no se repite.
  const modulos = MODULOS_POR_ROL[user.rol];
  const moduloUnico = modulos !== undefined;
  const modulo = modulos?.find((m) => enModulo(pathname, m)) ?? INICIO_POR_ROL[user.rol];
  const raiz =
    user.rol === "ADMIN"
      ? { href: "/", label: "Inicio" }
      : { href: modulo, label: SEGMENT_LABELS[modulo.split("/")[1]] ?? "Inicio" };

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border bg-card px-4">
      <div className="flex items-center gap-2">
        {/* En el teléfono es la única forma de llegar al menú: más grande para el dedo. */}
        <SidebarTrigger className="max-sm:size-10" />
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
