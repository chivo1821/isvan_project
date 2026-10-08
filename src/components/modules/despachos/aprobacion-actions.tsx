"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangleIcon, CheckIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { apiPost, mensajeDeError } from "@/lib/api-client";
import { formatUsd } from "@/lib/constants";
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

/** Deuda del cliente del despacho (ver backend/app/services/cartera.py). */
export type BloqueoCartera = { vencidoUsd: number; documentosVencidos: number; diasAtraso: number };

export function AprobacionDespachoActions({
  despachoId,
  despachoNumero,
  destinoNombre,
  size = "default",
  stopPropagation = false,
  bloqueo = null,
  puedeAutorizar = false,
}: {
  despachoId: string;
  despachoNumero: string;
  destinoNombre: string;
  size?: "default" | "sm";
  /** Util cuando el componente vive dentro de una fila clickeable de una tabla. */
  stopPropagation?: boolean;
  /** Si el cliente tiene deuda vencida: solo se aprueba como excepción. */
  bloqueo?: BloqueoCartera | null;
  /** Si quien mira puede aprobar esa excepción (ADMIN o con el permiso). */
  puedeAutorizar?: boolean;
}) {
  const router = useRouter();
  const [comentario, setComentario] = useState("");
  const [motivo, setMotivo] = useState("");
  const [open, setOpen] = useState<"aprobar" | "rechazar" | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function confirmar(accion: "aprobar" | "rechazar") {
    setEnviando(true);
    try {
      await apiPost(`/despachos/${despachoId}/aprobacion`, {
        accion: accion === "aprobar" ? "APROBADA" : "RECHAZADA",
        comentario: comentario.trim() || undefined,
        excepcion: accion === "aprobar" && bloqueo ? { motivo: motivo.trim() } : undefined,
      });
      if (accion === "aprobar") {
        toast.success(`Despacho ${despachoNumero} aprobado`, {
          description: `Pasa a preparación con destino ${destinoNombre}.`,
        });
      } else {
        toast.error(`Despacho ${despachoNumero} rechazado`, {
          description: `No continuará hacia ${destinoNombre}.`,
        });
      }
      setOpen(null);
      setComentario("");
      setMotivo("");
      router.push("/despachos/aprobacion");
      router.refresh();
    } catch (err) {
      toast.error("No se pudo registrar la aprobación", {
        description: mensajeDeError(err, "Intenta de nuevo"),
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
            <Button variant="destructive" disabled={enviando} onClick={() => confirmar("rechazar")}>
              Confirmar rechazo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={open === "aprobar"} onOpenChange={(v) => setOpen(v ? "aprobar" : null)}>
        <DialogTrigger asChild>
          {bloqueo && !puedeAutorizar ? (
            // Sin permiso no hay excepción posible: el botón explica por qué.
            <Button size={size} variant="outline" disabled title="Cliente con deuda vencida: solo un usuario autorizado puede aprobarlo">
              <AlertTriangleIcon />
              Bloqueado por deuda
            </Button>
          ) : (
            <Button size={size} variant={bloqueo ? "outline" : "default"}>
              {bloqueo ? <AlertTriangleIcon /> : <CheckIcon />}
              {bloqueo ? "Aprobar como excepción" : "Aprobar"}
            </Button>
          )}
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{bloqueo ? `Aprobar ${despachoNumero} como excepción` : `Aprobar ${despachoNumero}`}</DialogTitle>
            <DialogDescription>
              {bloqueo
                ? `${destinoNombre} tiene ${bloqueo.documentosVencidos} documento(s) vencido(s) por ${formatUsd(bloqueo.vencidoUsd, 2)} (hasta ${bloqueo.diasAtraso} días de atraso). La excepción queda registrada a tu nombre con el motivo.`
                : "El despacho pasará a preparación."}
            </DialogDescription>
          </DialogHeader>
          {bloqueo && (
            <div className="space-y-1.5">
              <Label htmlFor={`motivo-excepcion-${despachoId}`}>Motivo de la excepción (obligatorio)</Label>
              <Textarea
                id={`motivo-excepcion-${despachoId}`}
                value={motivo}
                maxLength={300}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Ej: acuerdo de pago firmado con cobranzas para el 15/10"
              />
            </div>
          )}
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
            <Button disabled={enviando || (bloqueo != null && motivo.trim().length < 5)} onClick={() => confirmar("aprobar")}>
              {bloqueo ? "Aprobar como excepción" : "Confirmar aprobación"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
