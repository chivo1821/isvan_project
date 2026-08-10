"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckIcon } from "lucide-react";
import { toast } from "sonner";
import { apiPatch } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/shared/status-badge";

export function DespachoItemCantidad({
  despachoId,
  itemId,
  cantidad,
  cantidadSolicitada,
  editable,
}: {
  despachoId: string;
  itemId: string;
  cantidad: number;
  cantidadSolicitada: number;
  editable: boolean;
}) {
  const router = useRouter();
  const [valor, setValor] = useState(cantidad);
  const [guardando, setGuardando] = useState(false);
  const faltante = cantidadSolicitada - cantidad;

  async function guardar() {
    if (valor === cantidad) return;
    setGuardando(true);
    try {
      await apiPatch(`/despachos/${despachoId}/items/${itemId}`, { cantidad: valor });
      toast.success("Cantidad actualizada");
      router.refresh();
    } catch (err) {
      toast.error("No se pudo actualizar la cantidad", {
        description: err instanceof Error ? err.message : undefined,
      });
      setValor(cantidad);
    } finally {
      setGuardando(false);
    }
  }

  if (!editable) {
    return (
      <div className="flex flex-col items-end gap-1">
        <span>{cantidad}</span>
        {faltante > 0 && <StatusBadge tone="warning" label={`Faltaron ${faltante}`} />}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center justify-end gap-1.5">
        <Input
          type="number"
          min={0}
          max={cantidadSolicitada}
          value={valor}
          onChange={(e) => setValor(Number(e.target.value))}
          className="h-8 w-20 text-right"
        />
        {valor !== cantidad && (
          <Button size="icon-sm" variant="outline" disabled={guardando} onClick={guardar} aria-label="Guardar cantidad">
            <CheckIcon />
          </Button>
        )}
      </div>
      {faltante > 0 && <StatusBadge tone="warning" label={`Faltan ${faltante}`} />}
    </div>
  );
}
