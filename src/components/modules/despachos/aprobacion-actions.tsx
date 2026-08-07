"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
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

export function AprobacionDespachoActions({
  despachoNumero,
  destinoNombre,
  size = "default",
  stopPropagation = false,
}: {
  despachoNumero: string;
  destinoNombre: string;
  size?: "default" | "sm";
  /** Util cuando el componente vive dentro de una fila clickeable de una tabla. */
  stopPropagation?: boolean;
}) {
  const router = useRouter();
  const [comentario, setComentario] = useState("");
  const [open, setOpen] = useState<"aprobar" | "rechazar" | null>(null);

  function confirmar(accion: "aprobar" | "rechazar") {
    if (accion === "aprobar") {
      toast.success(`Despacho ${despachoNumero} aprobado`, {
        description: `Pasa a preparación con destino ${destinoNombre}. (Simulación: no se persiste todavía.)`,
      });
    } else {
      toast.error(`Despacho ${despachoNumero} rechazado`, {
        description: `No continuará hacia ${destinoNombre}. (Simulación: no se persiste todavía.)`,
      });
    }
    setOpen(null);
    setComentario("");
    router.push("/despachos/aprobacion");
  }

  return (
    <div className="flex gap-2" onClick={stopPropagation ? (e) => e.stopPropagation() : undefined}>
      <Dialog open={open === "rechazar"} onOpenChange={(v) => setOpen(v ? "rechazar" : null)}>
        <DialogTrigger asChild>
          <Button variant="destructive" size={size}>
            <XIcon />
            Rechazar
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rechazar {despachoNumero}</DialogTitle>
            <DialogDescription>Explica por qué se rechaza este despacho.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="comentario-rechazo-despacho">Comentario</Label>
            <Textarea
              id="comentario-rechazo-despacho"
              value={comentario}
              onChange={(e) => setComentario(e.target.value)}
              placeholder="Ej: faltan datos del vehículo asignado..."
            />
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancelar</Button>
            </DialogClose>
            <Button variant="destructive" onClick={() => confirmar("rechazar")}>
              Confirmar rechazo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={open === "aprobar"} onOpenChange={(v) => setOpen(v ? "aprobar" : null)}>
        <DialogTrigger asChild>
          <Button size={size}>
            <CheckIcon />
            Aprobar
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Aprobar {despachoNumero}</DialogTitle>
            <DialogDescription>El despacho pasará a preparación.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="comentario-aprobacion-despacho">Comentario (opcional)</Label>
            <Textarea
              id="comentario-aprobacion-despacho"
              value={comentario}
              onChange={(e) => setComentario(e.target.value)}
            />
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancelar</Button>
            </DialogClose>
            <Button onClick={() => confirmar("aprobar")}>Confirmar aprobación</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
