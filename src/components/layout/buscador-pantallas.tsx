"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { SearchIcon } from "lucide-react";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import type { Area } from "@/lib/navegacion";

/** Ir a cualquier pantalla escribiendo su nombre (Ctrl+K o Cmd+K). Con el
 * menú corto, es el atajo para quien ya sabe a dónde va. */
export function BuscadorPantallas({ areas }: { areas: Area[] }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);

  useEffect(() => {
    function alTeclear(e: KeyboardEvent) {
      if (e.key.toLowerCase() === "k" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setAbierto((v) => !v);
      }
    }
    window.addEventListener("keydown", alTeclear);
    return () => window.removeEventListener("keydown", alTeclear);
  }, []);

  function ir(href: string) {
    setAbierto(false);
    router.push(href);
  }

  return (
    <>
      <SidebarMenuItem>
        <SidebarMenuButton tooltip="Ir a una pantalla (Ctrl+K)" onClick={() => setAbierto(true)}>
          <SearchIcon />
          <span className="flex-1">Ir a…</span>
          <kbd className="pointer-events-none rounded border border-border bg-muted px-1.5 text-[10px] text-muted-foreground">
            Ctrl K
          </kbd>
        </SidebarMenuButton>
      </SidebarMenuItem>
      <CommandDialog
        open={abierto}
        onOpenChange={setAbierto}
        title="Ir a una pantalla"
        description="Escribe el nombre de la pantalla"
      >
        <Command>
          <CommandInput placeholder="Escribe una pantalla: planificación, pagos, gastos…" />
          <CommandList>
            <CommandEmpty>No hay ninguna pantalla con ese nombre.</CommandEmpty>
            {areas.map((area) => (
              <CommandGroup key={area.id} heading={area.label}>
                {area.secciones.map((s) => (
                  <CommandItem
                    key={s.href}
                    value={`${area.label} ${s.label} ${s.claves ?? ""}`}
                    onSelect={() => ir(s.href)}
                  >
                    <area.icon />
                    {s.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  );
}
