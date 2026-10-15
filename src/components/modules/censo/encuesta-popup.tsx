"use client";

import { useEffect, useState } from "react";
import { Loader2Icon } from "lucide-react";
import { apiGet, mensajeDeError } from "@/lib/api-client";
import type { DetalleCenso } from "@/lib/censo";
import type { DefinicionFormulario } from "@/lib/formulario/motor";
import { DetalleDeCenso } from "./detalle-censo";

/** La encuesta completa dentro del popup del mapa. Se pide al abrir el
 * popup (Leaflet monta su contenido recién entonces): el tablero no trae
 * las respuestas de todos los censos. */
export function EncuestaEnPopup({ id, definicion }: { id: string; definicion: DefinicionFormulario }) {
  const [censo, setCenso] = useState<DetalleCenso | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vigente = true;
    apiGet<DetalleCenso>(`/censo/${encodeURIComponent(id)}`)
      .then((c) => vigente && setCenso(c))
      .catch((e) => vigente && setError(mensajeDeError(e, "No se pudo cargar la encuesta")));
    return () => {
      vigente = false;
    };
  }, [id]);

  if (error) return <p className="text-xs text-destructive">{error}</p>;
  if (!censo)
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2Icon className="size-3.5 animate-spin" /> Cargando la encuesta…
      </p>
    );
  return (
    <div className="max-h-[22rem] overflow-y-auto pr-1 [scrollbar-width:thin]">
      <DetalleDeCenso censo={censo} definicion={definicion} compacto />
    </div>
  );
}
