"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCwIcon } from "lucide-react";
import { toast } from "sonner";
import { apiPost } from "@/lib/api-client";
import { Button } from "@/components/ui/button";

type RutaRecalculada = { distanciaTotalKm?: number | null; tiempoTotalMin?: number | null };

/** Recalcula el orden de visita y el trazado de una ruta ya creada. El
 * trazado se calcula una sola vez al crearla y queda guardado, así que sin
 * esto una ruta mal calculada se quedaba así para siempre. */
export function RecalcularRutaButton({ rutaId }: { rutaId: string }) {
  const router = useRouter();
  const [recalculando, setRecalculando] = useState(false);

  async function recalcular() {
    setRecalculando(true);
    try {
      const ruta = await apiPost<RutaRecalculada>(`/rutas/${rutaId}/recalcular`);
      toast.success("Ruta recalculada", {
        description:
          ruta.distanciaTotalKm != null
            ? `${ruta.distanciaTotalKm.toLocaleString("es-VE")} km · ~${ruta.tiempoTotalMin} min`
            : undefined,
      });
      router.refresh();
    } catch (err) {
      toast.error("No se pudo recalcular la ruta", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setRecalculando(false);
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={recalcular} disabled={recalculando}>
      <RefreshCwIcon />
      {recalculando ? "Recalculando..." : "Recalcular ruta"}
    </Button>
  );
}
