"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Undo2Icon } from "lucide-react";
import { toast } from "sonner";
import { apiPost, mensajeDeError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const MOTIVO_MINIMO = 5;

/** Reverso de una ruta ya asignada (solo ADMIN). La ruta queda cancelada con
 * el motivo y sus despachos vuelven a «Aprobado» sin ruta. La página solo lo
 * muestra si ninguna parada tiene marcas, y la API lo vuelve a validar. */
export function ReversarRutaButton({
  rutaId,
  numero,
  paradas,
}: {
  rutaId: string;
  numero: string;
  paradas: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function reversar() {
    setEnviando(true);
    try {
      await apiPost(`/rutas/${rutaId}/reversar`, { motivo });
      toast.success(`Ruta ${numero} reversada`, {
        description: `${paradas} despacho(s) volvieron a «Aprobado», listos para otra ruta.`,
      });
      setOpen(false);
      router.refresh();
    } catch (err) {
      toast.error("No se pudo reversar la ruta", { description: mensajeDeError(err, "Intenta de nuevo") });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) setMotivo("");
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="text-destructive hover:text-destructive">
          <Undo2Icon />
          Reversar ruta
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reversar la ruta {numero}</DialogTitle>
          <DialogDescription>
            La ruta queda cancelada y sus {paradas} despacho(s) vuelven a «Aprobado» sin ruta, para armar otro
            viaje. El vehículo queda libre y el repartidor deja de verla. No se puede deshacer.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor="motivo-reverso">Motivo</Label>
          <Textarea
            id="motivo-reverso"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Ej.: el cliente pidió cambiar el día de entrega"
            rows={3}
          />
          <p className="text-xs text-muted-foreground">Queda registrado en la ruta junto con tu nombre.</p>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={enviando}>
              Cancelar
            </Button>
          </DialogClose>
          <Button
            variant="destructive"
            onClick={reversar}
            disabled={enviando || motivo.trim().length < MOTIVO_MINIMO}
          >
            {enviando ? "Reversando..." : "Reversar ruta"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
