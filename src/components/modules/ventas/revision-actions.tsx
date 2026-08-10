"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { apiPost } from "@/lib/api-client";
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

export function RevisionActions({
  ventaId,
  ventaNumero,
  clienteNombre,
  usuarioId,
  size = "default",
  stopPropagation = false,
}: {
  ventaId: string;
  ventaNumero: string;
  clienteNombre: string;
  usuarioId: string;
  size?: "default" | "sm";
  /** Util cuando el componente vive dentro de una fila clickeable de una tabla. */
  stopPropagation?: boolean;
}) {
  const router = useRouter();
  const [comentario, setComentario] = useState("");
  const [open, setOpen] = useState<"aprobar" | "rechazar" | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function confirmar(accion: "aprobar" | "rechazar") {
    setEnviando(true);
    try {
      await apiPost(`/ventas/${ventaId}/revision`, {
        usuarioId,
        accion: accion === "aprobar" ? "APROBADA" : "RECHAZADA",
        comentario: comentario.trim() || undefined,
      });
      if (accion === "aprobar") {
        toast.success(`Venta ${ventaNumero} aprobada`, {
          description: `Ya se puede generar el despacho para ${clienteNombre} desde "Nuevo despacho".`,
        });
      } else {
        toast.error(`Venta ${ventaNumero} rechazada`, {
          description: `No se generará despacho para ${clienteNombre}.`,
        });
      }
      setOpen(null);
      setComentario("");
      router.push("/ventas/revision");
      router.refresh();
    } catch (err) {
      toast.error("No se pudo registrar la revisión", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setEnviando(false);
    }
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
            <Button variant="destructive" disabled={enviando} onClick={() => confirmar("rechazar")}>
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
            <DialogTitle>Aprobar {ventaNumero}</DialogTitle>
            <DialogDescription>
              Al aprobar, la venta queda lista para generar despacho para {clienteNombre} pese a las facturas
              pendientes.
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
            <Button disabled={enviando} onClick={() => confirmar("aprobar")}>
              Confirmar aprobación
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
