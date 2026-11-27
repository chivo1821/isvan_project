"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangleIcon, RefreshCwIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { apiGet, apiPost, mensajeDeError } from "@/lib/api-client";
import { formatNumero } from "@/lib/constants";
import type { EstadoTasa } from "@/lib/administrativo";

function fechaCorta(iso: string | null): string {
  if (!iso) return "";
  const partes = iso.slice(0, 10).split("-");
  if (partes.length !== 3) return iso;
  return `${partes[2]}/${partes[1]}`;
}

export function IndicadorTasaBcv() {
  const router = useRouter();
  const [estado, setEstado] = useState<EstadoTasa | null>(null);
  const [actualizando, setActualizando] = useState(false);

  const cargar = useCallback(() => {
    apiGet<EstadoTasa>("/tasa/estado")
      .then(setEstado)
      .catch(() => {});
  }, []);

  useEffect(() => {
    cargar();
    const intervalo = setInterval(cargar, 15 * 60 * 1000);
    return () => clearInterval(intervalo);
  }, [cargar]);

  async function refrescar() {
    setActualizando(true);
    try {
      const nuevo = await apiPost<EstadoTasa & { actualizadas?: number }>("/tasa/actualizar", {});
      setEstado(nuevo);
      if (nuevo.tasa != null) {
        toast.success(`Tasa BCV: ${formatNumero(nuevo.tasa, 2)} Bs/$`, {
          description: `Fecha valor ${fechaCorta(nuevo.fecha)} (${nuevo.fuente ?? "BCV"})`,
        });
      }
      router.refresh();
    } catch (err) {
      toast.error("No se pudo actualizar la tasa BCV", {
        description: mensajeDeError(err, "Verifica la conexión o cárgala manualmente en Cobranzas"),
      });
    } finally {
      setActualizando(false);
    }
  }

  if (!estado) return null;

  const atrasada = estado.tasa == null || estado.alDia === false;
  const titulo =
    estado.tasa == null
      ? "Sin tasa BCV registrada. Haz clic para actualizar."
      : atrasada
        ? `Tasa BCV desactualizada (${fechaCorta(estado.fecha)}). Último día hábil: ${fechaCorta(estado.ultimoDiaHabil ?? null)}. Haz clic para actualizar.`
        : `Tasa BCV al día (${fechaCorta(estado.fecha)} · ${estado.fuente ?? "BCV"}). Haz clic para refrescar.`;

  return (
    <div
      title={titulo}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors ${
        atrasada
          ? "border-amber-500/50 bg-amber-500/10 text-amber-800 dark:text-amber-300"
          : "border-border bg-muted/40 text-foreground"
      }`}
    >
      {atrasada && <AlertTriangleIcon className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />}
      <span className="font-medium tabular-nums">
        <span className="text-muted-foreground">BCV </span>
        {estado.tasa != null ? `${formatNumero(estado.tasa, 2)}` : "Sin tasa"}
      </span>
      {estado.fecha && (
        <span className="hidden text-[11px] text-muted-foreground sm:inline">· {fechaCorta(estado.fecha)}</span>
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-5 rounded-full hover:bg-background/70"
        onClick={refrescar}
        disabled={actualizando}
        aria-label="Actualizar tasa BCV"
      >
        <RefreshCwIcon className={`size-3 ${actualizando ? "animate-spin" : ""}`} />
      </Button>
    </div>
  );
}
