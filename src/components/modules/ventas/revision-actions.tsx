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

export function RevisionActions({ ventaNumero, clienteNombre }: { ventaNumero: string; clienteNombre: string }) {
  const router = useRouter();
  const [comentario, setComentario] = useState("");
  const [open, setOpen] = useState<"aprobar" | "rechazar" | null>(null);

  function confirmar(accion: "aprobar" | "rechazar") {
    if (accion === "aprobar") {
      toast.success(`Venta ${ventaNumero} aprobada`, {
        description: `Se generará el despacho para ${clienteNombre}. (Simulación: no se persiste todavía.)`,
      });
    } else {
      toast.error(`Venta ${ventaNumero} rechazada`, {
        description: `No se generará despacho para ${clienteNombre}. (Simulación: no se persiste todavía.)`,
      });
    }
    setOpen(null);
    setComentario("");
    router.push("/ventas/revision");
  }

  return (
    <div className="flex gap-2">
      <Dialog open={open === "rechazar"} onOpenChange={(v) => setOpen(v ? "rechazar" : null)}>
        <DialogTrigger asChild>
          <Button variant="destructive">
            <XIcon />
            Rechazar
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rechazar {ventaNumero}</DialogTitle>
            <DialogDescription>
              Explica por qué se rechaza esta venta. No se generará despacho para {clienteNombre}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="comentario-rechazo">Comentario</Label>
            <Textarea
              id="comentario-rechazo"
              value={comentario}
              onChange={(e) => setComentario(e.target.value)}
              placeholder="Ej: cliente con factura vencida hace más de 30 días..."
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
          <Button>
            <CheckIcon />
            Aprobar
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Aprobar {ventaNumero}</DialogTitle>
            <DialogDescription>
              Al aprobar, se generará el despacho para {clienteNombre} pese a las facturas pendientes.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="comentario-aprobacion">Comentario (opcional)</Label>
            <Textarea
              id="comentario-aprobacion"
              value={comentario}
              onChange={(e) => setComentario(e.target.value)}
              placeholder="Ej: cliente se comprometió a regularizar el pago..."
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
