"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { TruckIcon } from "lucide-react";
import { apiPost, mensajeDeError } from "@/lib/api-client";
import { ReversarDialog } from "@/components/modules/rutas/reversar-dialog";
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

/** El repartidor no puede seguir el viaje (accidente, moto dañada...),
 * aunque ya haya entregado algo: lo pendiente vuelve a la oficina y la ruta
 * se cancela. Después vuelve a su lista de rutas. */
export function NoCompletarRutaButton({ rutaId }: { rutaId: string }) {
  const router = useRouter();
  return (
    <ReversarDialog
      endpoint={`/rutas/${rutaId}/no-completada`}
      boton="No puedo completar la ruta"
      titulo="No puedo completar la ruta"
      descripcion="Las paradas que no has entregado vuelven a la oficina para otro viaje y la ruta se cancela. Lo que ya entregaste queda registrado como entregado."
      confirmar="Confirmar"
      exito={{ titulo: "Ruta cancelada", descripcion: "La oficina ya ve los pedidos pendientes para otro viaje." }}
      placeholder="Ej.: tuve un accidente, se dañó la moto"
      size="default"
      onHecho={() => router.push("/despachador")}
    />
  );
}
