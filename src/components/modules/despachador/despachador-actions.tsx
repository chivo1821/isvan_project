"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2Icon, TruckIcon } from "lucide-react";
import { apiPost } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import type { EstadoDespacho } from "@prisma/client";

export function DespachadorActions({ despachoId, estado }: { despachoId: string; estado: EstadoDespacho }) {
  const router = useRouter();
  const [enviando, setEnviando] = useState(false);

  async function accionar(accion: "iniciar" | "entregar") {
    setEnviando(true);
    try {
      await apiPost(`/despachos/${despachoId}/${accion}`);
      toast.success(accion === "iniciar" ? "Ruta iniciada" : "Despacho entregado", {
        description:
          accion === "iniciar"
            ? "El despacho quedó marcado en tránsito."
            : "El ciclo de la venta quedó cerrado.",
      });
      router.refresh();
    } catch (err) {
      toast.error("No se pudo actualizar el despacho", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setEnviando(false);
    }
  }

  if (estado === "APROBADO") {
    return (
      <Button onClick={() => accionar("iniciar")} disabled={enviando} size="lg" className="w-full sm:w-auto">
        <TruckIcon />
        {enviando ? "Iniciando..." : "Salí del almacén"}
      </Button>
    );
  }

  if (estado === "EN_TRANSITO") {
    return (
      <Button onClick={() => accionar("entregar")} disabled={enviando} size="lg" className="w-full sm:w-auto">
        <CheckCircle2Icon />
        {enviando ? "Marcando..." : "Marcar como entregado"}
      </Button>
    );
  }

  return null;
}
