"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/shared/status-badge";
import { TIPO_VEHICULO_META } from "@/lib/constants";
import { sugerirVehiculos } from "@/lib/fleet/suggest-vehiculo";

export function VehiculoSugeridoSection({ despachoId }: { despachoId: string }) {
  const [asignado, setAsignado] = useState<string | null>(null);
  const sugerencias = sugerirVehiculos(despachoId);

  function asignar(placa: string) {
    setAsignado(placa);
    toast.success(`Vehículo ${placa} asignado`, {
      description: "(Simulación: no se persiste todavía — en Fase 2 esto quedará guardado en el despacho.)",
    });
  }

  if (sugerencias.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No hay vehículos disponibles que cumplan con la capacidad o refrigeración requerida para este despacho.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Vehículos sugeridos según disponibilidad y mejor ajuste de capacidad para este despacho:
      </p>
      {sugerencias.map((s, index) => (
        <div
          key={s.vehiculo.id}
          className="flex flex-col gap-2 rounded-lg border border-border p-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <div>
            <div className="flex items-center gap-2">
              {index === 0 && <StatusBadge tone="success" label="Recomendado" />}
              <span className="font-medium text-foreground">{s.vehiculo.placa}</span>
              <span className="text-sm text-muted-foreground">{TIPO_VEHICULO_META[s.vehiculo.tipo].label}</span>
            </div>
            <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
              {s.motivos.map((motivo) => (
                <li key={motivo}>✓ {motivo}</li>
              ))}
            </ul>
          </div>
          <Button
            size="sm"
            variant={asignado === s.vehiculo.placa ? "secondary" : "outline"}
            disabled={asignado === s.vehiculo.placa}
            onClick={() => asignar(s.vehiculo.placa)}
          >
            {asignado === s.vehiculo.placa ? "Asignado" : "Asignar"}
          </Button>
        </div>
      ))}
    </div>
  );
}
