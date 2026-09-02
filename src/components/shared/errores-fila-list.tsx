"use client";

import { useState } from "react";
import { ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

type ErrorFila = { fila: number; columna?: string | null; motivo: string };

/** Agrupa los errores por motivo para poder decir "por qué" sin obligar a
 * expandir la lista completa. Los motivos que nombran un valor puntual (un
 * código, un documento) se agrupan por su parte fija, para que 30 filas con
 * códigos distintos no produzcan 30 grupos de uno. */
function porMotivo(errores: ErrorFila[]) {
  const grupos = new Map<string, { motivo: string; filas: number[] }>();
  for (const e of errores) {
    const clave = e.motivo.replace(/"[^"]*"/g, '"…"');
    const grupo = grupos.get(clave);
    if (grupo) grupo.filas.push(e.fila);
    else grupos.set(clave, { motivo: clave, filas: [e.fila] });
  }
  return [...grupos.values()].sort((a, b) => b.filas.length - a.filas.length);
}

/** Lista de errores fila-por-fila de un preview de importación (Excel de
 * despachos, de clientes, etc.). Muestra siempre el conteo y el motivo de
 * cada grupo con las primeras filas afectadas; el detalle fila por fila
 * queda a un clic, para no dominar la pantalla cuando son muchas. */
export function ErroresFilaList({ errores }: { errores: ErrorFila[] }) {
  const [expandido, setExpandido] = useState(false);

  if (errores.length === 0) return null;

  const grupos = porMotivo(errores);

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

      <ul className="space-y-0.5 text-xs text-muted-foreground">
        {grupos.slice(0, 4).map((g) => (
          <li key={g.motivo}>
            <span className="font-medium text-foreground">{g.filas.length}×</span> {g.motivo} — fila
            {g.filas.length === 1 ? " " : "s "}
            {g.filas.slice(0, 5).join(", ")}
            {g.filas.length > 5 ? ` y ${g.filas.length - 5} más` : ""}
          </li>
        ))}
        {grupos.length > 4 && <li>y {grupos.length - 4} motivo(s) más — abre el detalle</li>}
      </ul>
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
