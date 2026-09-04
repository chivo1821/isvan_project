"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2Icon, MapPinCheckIcon } from "lucide-react";
import { toast } from "sonner";
import { apiPost, mensajeDeError } from "@/lib/api-client";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { estadoDeParada, formatHora } from "@/lib/constants";
import type { EstadoDespacho } from "@/lib/mock-data";

export type MarcasParada = {
  estado: EstadoDespacho;
  llegadaEn?: string | null;
  entregadoEn?: string | null;
};

/** Estado y acciones de una parada del viaje.
 *
 * No guarda las marcas: las recibe y avisa hacia arriba (ver
 * viaje-en-curso.tsx), que es quien las mantiene para que el mapa y la lista
 * cambien juntos apenas responde la API — sin esperar a que Next vuelva a
 * renderizar la página, que en un viaje de decenas de paradas implica
 * reenviar el trazado completo (miles de vértices) y redibujar el mapa. */
export function ParadaAcciones({
  rutaId,
  despachoId,
  rutaEnTransito,
  marcas,
  onMarcado,
}: {
  rutaId: string;
  despachoId: string;
  rutaEnTransito: boolean;
  marcas: MarcasParada;
  onMarcado: (marcas: MarcasParada) => void;
}) {
  const router = useRouter();
  const [enviando, setEnviando] = useState(false);

  async function marcar(accion: "llegada" | "entregar") {
    setEnviando(true);
    try {
      await apiPost(`/rutas/${rutaId}/paradas/${despachoId}/${accion}`);
      const ahora = new Date().toISOString();
      onMarcado(
        accion === "llegada"
          ? { ...marcas, llegadaEn: ahora }
          : { ...marcas, entregadoEn: ahora, estado: "ENTREGADO" }
      );
      toast.success(accion === "llegada" ? "Llegada registrada" : "Parada entregada");
      // Detrás, para que el encabezado de la ruta y el resto de la pantalla
      // se pongan al día; esta parada ya se actualizó sola.
      router.refresh();
    } catch (err) {
      toast.error(accion === "llegada" ? "No se pudo marcar la llegada" : "No se pudo marcar la entrega", {
        description: mensajeDeError(err, "Intenta de nuevo"),
      });
    } finally {
      setEnviando(false);
    }
  }

  const puedeMarcar = rutaEnTransito && marcas.estado === "EN_TRANSITO";

  return (
    <div className="flex shrink-0 flex-col items-end gap-1.5">
      {(marcas.llegadaEn || marcas.entregadoEn) && (
        <p className="text-xs text-muted-foreground">
          {marcas.llegadaEn && `Llegada ${formatHora(marcas.llegadaEn)}`}
          {marcas.llegadaEn && marcas.entregadoEn && " · "}
          {marcas.entregadoEn && `Entrega ${formatHora(marcas.entregadoEn)}`}
        </p>
      )}
      <div className="flex items-center gap-2">
        <StatusBadge {...estadoDeParada(marcas)} />
        {puedeMarcar &&
          (marcas.llegadaEn ? (
            <Button size="sm" disabled={enviando} onClick={() => marcar("entregar")}>
              <CheckCircle2Icon />
              {enviando ? "Marcando..." : "Marcar entregado"}
            </Button>
          ) : (
            <Button size="sm" variant="outline" disabled={enviando} onClick={() => marcar("llegada")}>
              <MapPinCheckIcon />
              {enviando ? "Marcando..." : "Llegué"}
            </Button>
          ))}
      </div>
    </div>
  );
}
