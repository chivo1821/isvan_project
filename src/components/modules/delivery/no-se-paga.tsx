"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Undo2Icon } from "lucide-react";
import { toast } from "sonner";
import { apiPost, mensajeDeError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatNumero, formatUsd } from "@/lib/constants";
import type { ParadaDelivery } from "@/lib/delivery";

function referencia(p: ParadaDelivery) {
  return { rutaId: p.rutaId, clienteId: p.clienteId, vehiculoId: p.vehiculoId };
}

/** Marca una entrega pendiente como «no se paga», con motivo: sale de lo
 * pendiente sin pagarse. Con `deLaRuta` ofrece aplicarlo a todas las
 * pendientes de esa ruta y moto (p. ej. una ruta vieja cerrada tarde). */
export function NoSePagaDialog({
  parada,
  deLaRuta,
}: {
  parada: ParadaDelivery;
  /** Las pendientes de la misma ruta y moto, incluida esta. */
  deLaRuta: ParadaDelivery[];
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [todaLaRuta, setTodaLaRuta] = useState(false);
  const [enviando, setEnviando] = useState(false);

  const elegidas = todaLaRuta ? deLaRuta : [parada];
  const monto = elegidas.reduce((suma, p) => suma + (p.montoUsd ?? 0), 0);
  const motivoValido = motivo.trim().length >= 3;

  function abrir(valor: boolean) {
    if (valor) {
      setMotivo("");
      setTodaLaRuta(false);
    }
    setAbierto(valor);
  }

  async function confirmar() {
    if (!motivoValido) return;
    setEnviando(true);
    try {
      await apiPost("/delivery/exclusiones", { paradas: elegidas.map(referencia), motivo: motivo.trim() });
      toast.success(
        elegidas.length === 1 ? "La entrega quedó como «no se paga»" : `${elegidas.length} entregas quedaron como «no se paga»`,
        { description: `${formatUsd(monto, 2)} fuera de lo pendiente` }
      );
      setAbierto(false);
      router.refresh();
    } catch (err) {
      toast.error("No se pudo marcar", { description: mensajeDeError(err, "Intenta de nuevo") });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Dialog open={abierto} onOpenChange={abrir}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground">
          No se paga
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>No pagar esta entrega</DialogTitle>
          <DialogDescription>
            {parada.clienteNombre} · {parada.rutaNumero}
            {parada.conductor ? ` · ${parada.conductor}` : ""}. Sale de lo pendiente sin pagarse y queda en el detalle
            con el motivo. Se puede volver a pendiente cuando quieras.
          </DialogDescription>
        </DialogHeader>
        {deLaRuta.length > 1 && (
          <div className="flex items-start gap-2.5 rounded-lg border border-border p-3">
            <Checkbox
              id="no-se-paga-ruta"
              checked={todaLaRuta}
              onCheckedChange={(v) => setTodaLaRuta(v === true)}
              className="mt-0.5"
            />
            <Label htmlFor="no-se-paga-ruta" className="cursor-pointer flex-col items-start gap-0.5 font-normal">
              <span>Toda la ruta {parada.rutaNumero}</span>
              <span className="text-xs text-muted-foreground">
                {formatNumero(deLaRuta.length)} entregas pendientes de esta moto
              </span>
            </Label>
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="no-se-paga-motivo">Motivo</Label>
          <Textarea
            id="no-se-paga-motivo"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Ej. ruta de septiembre cerrada tarde desde la oficina"
            rows={2}
            maxLength={300}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setAbierto(false)} disabled={enviando}>
            Cancelar
          </Button>
          <Button onClick={confirmar} disabled={enviando || !motivoValido}>
            {enviando
              ? "Guardando..."
              : elegidas.length === 1
                ? `No pagar ${formatUsd(monto, 2)}`
                : `No pagar ${formatNumero(elegidas.length)} entregas (${formatUsd(monto, 2)})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Devuelve a pendiente una entrega marcada «no se paga». */
export function VolverAPendienteButton({ parada }: { parada: ParadaDelivery }) {
  const router = useRouter();
  const [enviando, setEnviando] = useState(false);

  async function volver() {
    setEnviando(true);
    try {
      await apiPost("/delivery/exclusiones/quitar", { paradas: [referencia(parada)] });
      toast.success("La entrega volvió a pendiente", {
        description: `${parada.clienteNombre} · ${formatUsd(parada.montoUsd, 2)}`,
      });
      router.refresh();
    } catch (err) {
      toast.error("No se pudo cambiar", { description: mensajeDeError(err, "Intenta de nuevo") });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" onClick={volver} disabled={enviando}>
      <Undo2Icon />
      {enviando ? "..." : "Volver a pendiente"}
    </Button>
  );
}
