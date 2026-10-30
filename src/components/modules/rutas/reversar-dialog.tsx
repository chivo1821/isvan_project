"use client";

import { useState, type ReactNode } from "react";
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

/** Igual que la API (MOTIVO_MINIMO en backend/app/services/reversos.py). */
const MOTIVO_MINIMO = 5;

/** Sacar despachos de su ruta sin entregarlos, con el motivo obligatorio:
 * la ruta entera o un despacho (el coordinador) y «No se pudo entregar» (el
 * repartidor). Vuelven a «Aprobado» para otro viaje; la API valida todo de
 * nuevo y deja el motivo registrado con el nombre de quien lo hizo. */
export function ReversarDialog({
  endpoint,
  boton,
  titulo,
  descripcion,
  confirmar,
  exito,
  placeholder = "Ej.: el camión se accidentó",
  size = "sm",
  onHecho,
}: {
  /** POST con { motivo }. */
  endpoint: string;
  boton: string;
  titulo: string;
  descripcion: ReactNode;
  /** Texto del botón que confirma (por defecto, el mismo del botón). */
  confirmar?: string;
  exito: { titulo: string; descripcion?: string };
  placeholder?: string;
  size?: "sm" | "default";
  /** Con la respuesta de la API. Si no se pasa, se recarga la página. */
  onHecho?: (respuesta: unknown) => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function enviar() {
    setEnviando(true);
    try {
      const respuesta = await apiPost(endpoint, { motivo });
      toast.success(exito.titulo, { description: exito.descripcion });
      setOpen(false);
      if (onHecho) onHecho(respuesta);
      router.refresh();
    } catch (err) {
      toast.error("No se pudo guardar el reverso", { description: mensajeDeError(err, "Intenta de nuevo") });
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
        <Button variant="outline" size={size} className="text-destructive hover:text-destructive">
          <Undo2Icon />
          {boton}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
          <DialogDescription>{descripcion}</DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor="motivo-reverso">Motivo</Label>
          <Textarea
            id="motivo-reverso"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder={placeholder}
            rows={3}
          />
          <p className="text-xs text-muted-foreground">Es obligatorio y queda registrado junto con tu nombre.</p>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={enviando}>
              Cancelar
            </Button>
          </DialogClose>
          <Button variant="destructive" onClick={enviar} disabled={enviando || motivo.trim().length < MOTIVO_MINIMO}>
            {enviando ? "Guardando..." : (confirmar ?? boton)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
