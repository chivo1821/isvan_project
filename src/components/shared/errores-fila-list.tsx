"use client";

import { useState } from "react";
import { ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

type ErrorFila = { fila: number; columna?: string | null; motivo: string };

/** Lista de errores fila-por-fila de un preview de importación (Excel de
 * despachos, de clientes, etc.) — colapsada por defecto, mostrando solo el
 * conteo, para no dominar la pantalla cuando son muchas filas. */
export function ErroresFilaList({ errores }: { errores: ErrorFila[] }) {
  const [expandido, setExpandido] = useState(false);

  if (errores.length === 0) return null;

  return (
    <div className="space-y-1.5">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-auto gap-1 px-0 font-medium text-destructive hover:bg-transparent hover:text-destructive"
        onClick={() => setExpandido((v) => !v)}
      >
        {expandido ? <ChevronUpIcon className="size-3.5" /> : <ChevronDownIcon className="size-3.5" />}
        {errores.length} fila{errores.length === 1 ? "" : "s"} con error (no se {errores.length === 1 ? "importa" : "importan"})
      </Button>
      {expandido && (
        <ul className="max-h-48 space-y-1 overflow-y-auto rounded-md border border-border bg-muted/30 p-2 text-xs text-muted-foreground">
          {errores.map((e, i) => (
            <li key={i}>
              Fila {e.fila}
              {e.columna ? ` (${e.columna})` : ""}: {e.motivo}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
