"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { TruckIcon } from "lucide-react";
import { apiPost, mensajeDeError } from "@/lib/api-client";
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
      toast.error("No se pudo iniciar la ruta", { description: mensajeDeError(err, "Intenta de nuevo") });
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
