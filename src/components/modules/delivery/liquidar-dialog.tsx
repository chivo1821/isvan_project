"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BanknoteIcon } from "lucide-react";
import { toast } from "sonner";
import { apiPost, mensajeDeError } from "@/lib/api-client";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatDate, formatNumero, formatUsd } from "@/lib/constants";
import type { LiquidacionDelivery, MotorizadoDelivery } from "@/lib/delivery";

/** Cierra el pago de un motorizado en el período: congela los kilómetros y
 * los montos de sus entregas pendientes. */
export function LiquidarDialog({
  motorizado,
  desde,
  hasta,
  entregasPendientes,
}: {
  motorizado: MotorizadoDelivery;
  desde: string;
  hasta: string;
  entregasPendientes: number;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [nota, setNota] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function liquidar() {
    if (!motorizado.repartidorId) return;
    setEnviando(true);
    try {
      const liquidacion = await apiPost<LiquidacionDelivery>("/delivery/liquidaciones", {
        repartidorId: motorizado.repartidorId,
        desde,
        hasta,
        nota: nota.trim() || null,
      });
      toast.success(`Pago registrado: ${formatUsd(liquidacion.totalUsd, 2)}`, {
        description: `${formatNumero(liquidacion.entregas)} entregas de ${motorizado.conductor}`,
      });
      setAbierto(false);
      setNota("");
      router.refresh();
    } catch (err) {
      toast.error("No se pudo registrar el pago", { description: mensajeDeError(err, "Intenta de nuevo") });
    } finally {
      setEnviando(false);
    }
  }

  // Sin chofer asignado no hay a quien pagarle, y sin pendiente no hay nada
  // que registrar: el boton queda deshabilitado, pero diciendo por que.
  const motivo = !motorizado.repartidorId
    ? "Esta moto no tiene chofer asignado: asígnale un repartidor en Vehículos → Choferes"
    : motorizado.pendienteUsd <= 0
      ? motorizado.sinDistancia > 0
        ? "Sus entregas todavía no tienen distancia calculada, así que no hay monto que pagar"
        : "No hay entregas pendientes de pago en este período"
      : null;

  return (
    <AlertDialog open={abierto} onOpenChange={setAbierto}>
      <AlertDialogTrigger asChild disabled={!!motivo}>
        <span title={motivo ?? undefined} className="inline-flex">
          <Button size="sm" variant="outline" disabled={!!motivo}>
            <BanknoteIcon />
            Registrar pago
          </Button>
        </span>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Registrar el pago de {motorizado.conductor}</AlertDialogTitle>
          <AlertDialogDescription>
            Se dan por pagadas {formatNumero(entregasPendientes)} entregas del {formatDate(desde)} al{" "}
            {formatDate(hasta)}, por {formatUsd(motorizado.pendienteUsd, 2)}. Quedan congeladas con esos kilómetros y
            montos: si después cambias el tabulador, este pago no se altera.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="nota-pago">Nota (opcional)</Label>
          <Textarea
            id="nota-pago"
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            placeholder="Ej. pagado en efectivo, quincena del 1 al 15"
            rows={2}
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={enviando}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              liquidar();
            }}
            disabled={enviando}
          >
            {enviando ? "Registrando..." : `Registrar ${formatUsd(motorizado.pendienteUsd, 2)}`}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
