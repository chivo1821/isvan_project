"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { apiGet, apiPost } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/shared/status-badge";
import { TIPO_VEHICULO_META } from "@/lib/constants";
import type { Despacho } from "@/lib/mock-data";

type SugerenciaVehiculo = {
  vehiculo: { id: string; placa: string; tipo: string };
  holguraKg: number;
  motivos: string[];
};

export function VehiculoSugeridoSection({ despachoId }: { despachoId: string }) {
  const [sugerencias, setSugerencias] = useState<SugerenciaVehiculo[] | null>(null);
  const [asignado, setAsignado] = useState<string | null>(null);
  const [asignando, setAsignando] = useState<string | null>(null);

  useEffect(() => {
    apiGet<SugerenciaVehiculo[]>(`/despachos/${despachoId}/vehiculos-sugeridos`)
      .then(setSugerencias)
      .catch(() => setSugerencias([]));
  }, [despachoId]);

  async function asignar(vehiculoId: string, placa: string) {
    setAsignando(vehiculoId);
    try {
      await apiPost<Despacho>(`/despachos/${despachoId}/asignar-vehiculo`, { vehiculoId });
      setAsignado(vehiculoId);
      toast.success(`Vehículo ${placa} asignado`);
    } catch (err) {
      toast.error("No se pudo asignar el vehículo", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setAsignando(null);
    }
  }

  if (sugerencias === null) {
    return <p className="text-sm text-muted-foreground">Buscando vehículos disponibles…</p>;
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
              <span className="text-sm text-muted-foreground">
                {TIPO_VEHICULO_META[s.vehiculo.tipo as keyof typeof TIPO_VEHICULO_META].label}
              </span>
            </div>
            <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
              {s.motivos.map((motivo) => (
                <li key={motivo}>✓ {motivo}</li>
              ))}
            </ul>
          </div>
          <Button
            size="sm"
            variant={asignado === s.vehiculo.id ? "secondary" : "outline"}
            disabled={asignado !== null || asignando === s.vehiculo.id}
            onClick={() => asignar(s.vehiculo.id, s.vehiculo.placa)}
          >
            {asignado === s.vehiculo.id ? "Asignado" : asignando === s.vehiculo.id ? "Asignando..." : "Asignar"}
          </Button>
        </div>
      ))}
    </div>
  );
}
