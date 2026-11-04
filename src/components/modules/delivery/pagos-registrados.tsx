"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Undo2Icon } from "lucide-react";
import { toast } from "sonner";
import { apiPost, mensajeDeError } from "@/lib/api-client";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { formatDate, formatDateTime, formatNumero, formatUsd } from "@/lib/constants";
import type { LiquidacionDelivery } from "@/lib/delivery";
import { cn } from "@/lib/utils";

/** Da un pago por no hecho: sus entregas vuelven a pendientes. */
function AnularPagoDialog({ pago }: { pago: LiquidacionDelivery }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const motivoValido = motivo.trim().length >= 3;

  async function anular() {
    if (!motivoValido) return;
    setEnviando(true);
    try {
      await apiPost(`/delivery/liquidaciones/${pago.id}/anular`, { motivo: motivo.trim() });
      toast.success(`Pago anulado: ${formatUsd(pago.totalUsd, 2)}`, {
        description: `${formatNumero(pago.entregas)} entrega(s) de ${pago.repartidor} volvieron a pendientes`,
      });
      setAbierto(false);
      setMotivo("");
      router.refresh();
    } catch (err) {
      toast.error("No se pudo anular el pago", { description: mensajeDeError(err, "Intenta de nuevo") });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Dialog open={abierto} onOpenChange={setAbierto}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground">
          <Undo2Icon />
          Anular
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Anular el pago de {pago.repartidor}</DialogTitle>
          <DialogDescription>
            {formatUsd(pago.totalUsd, 2)} por {formatNumero(pago.entregas)} entrega(s) (registrado el{" "}
            {formatDateTime(pago.creadoEn)}). Se da por no hecho: esas entregas vuelven a quedar pendientes y se pueden
            volver a pagar. El pago queda en el historial como anulado, con el motivo.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor={`anular-${pago.id}`}>Motivo</Label>
          <Textarea
            id={`anular-${pago.id}`}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Ej. se registró de más, no se le pagaron las rutas viejas"
            rows={2}
            maxLength={300}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setAbierto(false)} disabled={enviando}>
            Cancelar
          </Button>
          <Button variant="destructive" onClick={anular} disabled={enviando || !motivoValido}>
            {enviando ? "Anulando..." : `Anular ${formatUsd(pago.totalUsd, 2)}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Los pagos registrados que cubren el período, con la opción de anularlos. */
export function PagosRegistrados({ pagos }: { pagos: LiquidacionDelivery[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Pagos registrados</CardTitle>
      </CardHeader>
      <CardContent>
        {pagos.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            No hay pagos registrados que cubran este período.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Registrado</TableHead>
                  <TableHead>Motorizado</TableHead>
                  <TableHead>Período</TableHead>
                  <TableHead className="text-right">Entregas</TableHead>
                  <TableHead className="text-right">Monto</TableHead>
                  <TableHead>Nota</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="w-0" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagos.map((p) => {
                  const anulado = p.anuladaEn != null;
                  return (
                    <TableRow key={p.id} className={anulado ? "text-muted-foreground" : undefined}>
                      <TableCell className="whitespace-nowrap">
                        {formatDateTime(p.creadoEn)}
                        <span className="block text-xs text-muted-foreground">por {p.creadoPor}</span>
                      </TableCell>
                      <TableCell className="font-medium">{p.repartidor}</TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatDate(p.desde)} – {formatDate(p.hasta)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatNumero(p.entregas)}</TableCell>
                      <TableCell className={cn("text-right font-medium tabular-nums", anulado && "line-through")}>
                        {formatUsd(p.totalUsd, 2)}
                      </TableCell>
                      <TableCell className="max-w-48 text-muted-foreground">{p.nota ?? "—"}</TableCell>
                      <TableCell>
                        <StatusBadge label={anulado ? "Anulado" : "Vigente"} tone={anulado ? "neutral" : "success"} />
                        {anulado && (
                          <span className="mt-0.5 block max-w-48 text-xs text-muted-foreground">
                            {p.motivoAnulacion}
                            {p.anuladaPor && p.anuladaEn ? ` (${p.anuladaPor}, ${formatDate(p.anuladaEn)})` : ""}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">{!anulado && <AnularPagoDialog pago={p} />}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
