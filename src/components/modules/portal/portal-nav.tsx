"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FileTextIcon, HomeIcon, ReceiptIcon, WalletIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const ENLACES = [
  { href: "/portal", label: "Resumen", icon: HomeIcon, exacto: true },
  { href: "/portal/documentos", label: "Documentos", icon: FileTextIcon },
  { href: "/portal/estado-de-cuenta", label: "Estado de cuenta", icon: ReceiptIcon },
  { href: "/portal/pagos", label: "Pagos", icon: WalletIcon },
];

/** Las cuatro secciones del portal. En el teléfono quedan en una fila de
 * cuatro botones (sin desplazamiento horizontal). */
export function PortalNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Secciones del portal" className="grid grid-cols-4 gap-1 sm:flex sm:gap-2">
      {ENLACES.map(({ href, label, icon: Icon, exacto }) => {
        const activo = exacto ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={activo ? "page" : undefined}
            className={cn(
              "flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-md px-2 py-1.5 text-center text-xs font-medium transition-colors sm:flex-row sm:gap-2 sm:px-3 sm:text-sm",
              activo ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            <Icon className="size-4 shrink-0" aria-hidden />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
