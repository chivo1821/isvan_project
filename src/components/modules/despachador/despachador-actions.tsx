"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2Icon, TruckIcon } from "lucide-react";
import { apiPost } from "@/lib/api-client";
import { Button } from "@/components/ui/button";

export function IniciarRutaButton({ rutaId }: { rutaId: string }) {
  const router = useRouter();
  const [enviando, setEnviando] = useState(false);

  async function iniciar() {
    setEnviando(true);
    try {
      await apiPost(`/rutas/${rutaId}/iniciar`);
      toast.success("Ruta iniciada", { description: "Todos los despachos de la ruta quedaron en tránsito." });
      router.refresh();
    } catch (err) {
      toast.error("No se pudo iniciar la ruta", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Button onClick={iniciar} disabled={enviando} size="lg" className="w-full sm:w-auto">
      <TruckIcon />
      {enviando ? "Iniciando..." : "Salí del almacén"}
    </Button>
  );
}

export function MarcarParadaEntregadaButton({
  rutaId,
  despachoId,
  size = "default",
}: {
  rutaId: string;
  despachoId: string;
  size?: "default" | "sm" | "lg";
}) {
  const router = useRouter();
  const [enviando, setEnviando] = useState(false);

  async function entregar() {
    setEnviando(true);
    try {
      await apiPost(`/rutas/${rutaId}/paradas/${despachoId}/entregar`);
      toast.success("Parada entregada");
      router.refresh();
    } catch (err) {
      toast.error("No se pudo marcar la entrega", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Button onClick={entregar} disabled={enviando} size={size}>
      <CheckCircle2Icon />
      {enviando ? "Marcando..." : "Marcar entregado"}
    </Button>
  );
}
