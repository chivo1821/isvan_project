"use client";

import Link from "@/components/shared/enlace";
import { usePathname } from "next/navigation";
import type { RolUsuario } from "@/lib/mock-data";
import { areasDe, ubicar } from "@/lib/navegacion";
import { useSinSenal } from "@/lib/seguimiento";
import { cn } from "@/lib/utils";

/** Las secciones del área de la pantalla actual, como pestañas. Reemplazan
 * los submenús del menú lateral. Un área de una sola sección no lleva. */
export function PestanasArea({ rol }: { rol: RolUsuario }) {
  const pathname = usePathname();
  // La API deja ver las posiciones a DESPACHOS y APROBADOR (y al ADMIN).
  const sinSenal = useSinSenal(rol === "ADMIN" || rol === "DESPACHOS" || rol === "APROBADOR");
  const actual = ubicar(pathname, areasDe(rol));
  if (!actual || actual.area.secciones.length < 2) return null;

  return (
    <nav aria-label={`Secciones de ${actual.area.label}`} className="-mx-4 -mt-2 border-b border-border sm:-mx-6">
      <ul className="flex gap-1 overflow-x-auto px-4 sm:px-6 [scrollbar-width:none]">
        {actual.area.secciones.map((s) => {
          const activa = s.href === actual.seccion.href;
          return (
            <li key={s.href} className="shrink-0">
              <Link
                href={s.href}
                aria-current={activa ? "page" : undefined}
                className={cn(
                  "-mb-px inline-flex h-10 items-center gap-1.5 border-b-2 px-3 text-sm whitespace-nowrap transition-colors",
                  activa
                    ? "border-primary font-medium text-foreground"
                    : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
                )}
              >
                {s.label}
                {s.href === "/seguimiento" && sinSenal > 0 && (
                  <span
                    className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500/15 px-1.5 text-xs font-medium text-amber-700 tabular-nums"
                    title="Repartidores que dejaron de enviar su ubicación"
                    aria-label={`${sinSenal} repartidor(es) dejaron de enviar su ubicación`}
                  >
                    {sinSenal}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
