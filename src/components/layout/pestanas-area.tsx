"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { RolUsuario } from "@/lib/mock-data";
import { areasDe, ubicar } from "@/lib/navegacion";
import { cn } from "@/lib/utils";

/** Las secciones del área de la pantalla actual, como pestañas. Reemplazan
 * los submenús del menú lateral. Un área de una sola sección no lleva. */
export function PestanasArea({ rol }: { rol: RolUsuario }) {
  const pathname = usePathname();
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
                  "-mb-px inline-flex h-10 items-center border-b-2 px-3 text-sm whitespace-nowrap transition-colors",
                  activa
                    ? "border-primary font-medium text-foreground"
                    : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
                )}
              >
                {s.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
