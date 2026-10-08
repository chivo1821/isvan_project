"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { apiPost, mensajeDeError } from "@/lib/api-client";
import { nombreDocumento, type Pago } from "@/lib/cobranzas";
import { formatDate, formatUsd } from "@/lib/constants";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const redondear = (v: number) => Math.round(v * 100) / 100;

function leerMonto(texto: string): number | null {
  const limpio = texto.trim();
  if (!limpio) return null;
  const valor = Number(limpio.includes(",") ? limpio.replace(/\./g, "").replace(",", ".") : limpio);
  return Number.isFinite(valor) && valor > 0 ? redondear(valor) : null;
}

/** Confirmar que el dinero llegó. Se puede corregir a qué documentos se
 * abona (parte de lo que propuso el cliente); lo no repartido queda a favor. */
export function VerificarPagoDialog({ pago }: { pago: Pago }) {
  const router = useRouter();
  const pendientes = pago.pendientes ?? [];
  const inicial = () =>
    Object.fromEntries(pago.aplicaciones.map((a) => [a.documentoId, a.montoUsd.toFixed(2)])) as Record<string, string>;
  const [abonos, setAbonos] = useState<Record<string, string>>(inicial);
  const [abierto, setAbierto] = useState(false);
  const [guardando, setGuardando] = useState(false);

  const abonado = redondear(pendientes.reduce((s, d) => s + (leerMonto(abonos[d.id] ?? "") ?? 0), 0));
  const excede = abonado > pago.montoUsd + 0.01;
  const docExcedido = pendientes.find((d) => (leerMonto(abonos[d.id] ?? "") ?? 0) > d.saldoUsd + 0.01);

  function repartir() {
    let resto = pago.montoUsd;
    const nuevo: Record<string, string> = {};
    for (const d of [...pendientes].sort((a, b) => a.vence.localeCompare(b.vence))) {
      if (resto <= 0) break;
      const parte = redondear(Math.min(resto, d.saldoUsd));
      nuevo[d.id] = parte.toFixed(2);
      resto = redondear(resto - parte);
    }
    setAbonos(nuevo);
  }

  async function verificar() {
    setGuardando(true);
    try {
      await apiPost(`/cobranzas/pagos/${pago.id}/verificar`, {
        aplicaciones: pendientes
          .map((d) => ({ documentoId: d.id, montoUsd: leerMonto(abonos[d.id] ?? "") }))
          .filter((a) => a.montoUsd != null),
      });
      toast.success(`Pago ${pago.numero} verificado`, { description: "Se descontó del saldo del cliente y se le avisó por correo." });
      setAbierto(false);
      router.refresh();
    } catch (err) {
      toast.error("No se pudo verificar", { description: mensajeDeError(err, "Intenta de nuevo") });
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Dialog
      open={abierto}
      onOpenChange={(v) => {
        setAbierto(v);
        if (v) setAbonos(inicial());
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <CheckIcon aria-hidden />
          Verificar
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Verificar el pago {pago.numero}</DialogTitle>
          <DialogDescription>
            {formatUsd(pago.montoUsd, 2)} de {pago.cliente ?? pago.codigoCliente}. Confirma a qué documentos se abona; lo
            que no repartas queda a favor del cliente y se aplica a lo que vence primero.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center justify-between gap-2 text-sm">
          <span>
            Repartido <strong className="tabular-nums">{formatUsd(abonado, 2)}</strong> de{" "}
            <strong className="tabular-nums">{formatUsd(pago.montoUsd, 2)}</strong>
          </span>
          <Button type="button" variant="outline" size="sm" onClick={repartir} disabled={pendientes.length === 0}>
            Repartir a lo más antiguo
          </Button>
        </div>
        <ul className="max-h-72 divide-y divide-border overflow-y-auto rounded-md border border-border">
          {pendientes.length === 0 && <li className="p-3 text-sm text-muted-foreground">El cliente no tiene documentos pendientes.</li>}
          {pendientes.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-3 p-2.5 text-sm">
              <span className="min-w-0">
                <span className="block font-medium">{nombreDocumento(d)}</span>
                <span className="text-xs text-muted-foreground">
                  Vence {formatDate(d.vence)} · saldo {formatUsd(d.saldoUsd, 2)}
                </span>
              </span>
              <span className="w-28 shrink-0">
                <Label htmlFor={`v-${pago.id}-${d.id}`} className="sr-only">
                  Abono a {nombreDocumento(d)}
                </Label>
                <Input
                  id={`v-${pago.id}-${d.id}`}
                  inputMode="decimal"
                  className="text-right tabular-nums"
                  placeholder="0,00"
                  value={abonos[d.id] ?? ""}
                  onChange={(e) => setAbonos((a) => ({ ...a, [d.id]: e.target.value }))}
                />
              </span>
            </li>
          ))}
        </ul>
        {(excede || docExcedido) && (
          <p role="alert" className="text-sm text-destructive">
            {excede
              ? "Lo repartido supera el monto del pago."
              : `A ${nombreDocumento(docExcedido!)} se le abona más que su saldo.`}
          </p>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={guardando}>
              Cancelar
            </Button>
          </DialogClose>
          <Button onClick={verificar} disabled={guardando || excede || Boolean(docExcedido)}>
            {guardando ? "Verificando..." : "Verificar pago"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const MOTIVOS = [
  "El pago no aparece en el banco",
  "El monto no coincide con lo recibido",
  "La referencia no corresponde",
  "Comprobante ilegible o incompleto",
];

export function RechazarPagoDialog({ pago }: { pago: Pago }) {
  const router = useRouter();
  const [motivo, setMotivo] = useState("");
  const [abierto, setAbierto] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const valido = motivo.trim().length >= 3;

  async function rechazar() {
    setGuardando(true);
    try {
      await apiPost(`/cobranzas/pagos/${pago.id}/rechazar`, { motivo: motivo.trim() });
      toast.success(`Pago ${pago.numero} rechazado`, { description: "Se le avisó al cliente con el motivo." });
      setAbierto(false);
      router.refresh();
    } catch (err) {
      toast.error("No se pudo rechazar", { description: mensajeDeError(err, "Intenta de nuevo") });
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Dialog
      open={abierto}
      onOpenChange={(v) => {
        setAbierto(v);
        if (v) setMotivo("");
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <XIcon aria-hidden />
          Rechazar
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rechazar el pago {pago.numero}</DialogTitle>
          <DialogDescription>El cliente verá el motivo en el portal y lo recibirá por correo.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-2">
          {MOTIVOS.map((m) => (
            <Button key={m} type="button" variant="secondary" size="sm" onClick={() => setMotivo(m)}>
              {m}
            </Button>
          ))}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`motivo-${pago.id}`}>Motivo</Label>
          <Textarea id={`motivo-${pago.id}`} maxLength={300} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={guardando}>
              Cancelar
            </Button>
          </DialogClose>
          <Button variant="destructive" onClick={rechazar} disabled={guardando || !valido}>
            {guardando ? "Rechazando..." : "Rechazar pago"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
