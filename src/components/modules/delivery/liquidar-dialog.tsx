"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BanknoteIcon } from "lucide-react";
import { toast } from "sonner";
import { apiPost, mensajeDeError } from "@/lib/api-client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatDate, formatNumero, formatUsd } from "@/lib/constants";
import type { LiquidacionDelivery, MotorizadoDelivery, ParadaDelivery } from "@/lib/delivery";

/** La misma llave que LiquidacionDeliveryParada: ruta, cliente y moto. */
function claveDe(p: ParadaDelivery) {
  return `${p.rutaId}|${p.clienteId}|${p.vehiculoId}`;
}

type GrupoRuta = { rutaId: string; rutaNumero: string; fecha: string; paradas: ParadaDelivery[] };

function porRuta(paradas: ParadaDelivery[]): GrupoRuta[] {
  const grupos = new Map<string, GrupoRuta>();
  for (const p of paradas) {
    const grupo = grupos.get(p.rutaId) ?? { rutaId: p.rutaId, rutaNumero: p.rutaNumero, fecha: p.fecha, paradas: [] };
    grupo.paradas.push(p);
    grupos.set(p.rutaId, grupo);
  }
  return [...grupos.values()];
}

/** Cierra el pago de un motorizado en el período: congela los kilómetros y
 * los montos de las entregas pendientes que se elijan. Las que se dejan sin
 * marcar siguen pendientes para el próximo corte. */
export function LiquidarDialog({
  motorizado,
  desde,
  hasta,
  pendientes,
}: {
  motorizado: MotorizadoDelivery;
  desde: string;
  hasta: string;
  /** Sus entregas pendientes con monto, en el orden del detalle. */
  pendientes: ParadaDelivery[];
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [nota, setNota] = useState("");
  const [elegidas, setElegidas] = useState<Set<string>>(new Set());
  const [enviando, setEnviando] = useState(false);

  const seleccion = pendientes.filter((p) => elegidas.has(claveDe(p)));
  const total = seleccion.reduce((suma, p) => suma + (p.montoUsd ?? 0), 0);
  const grupos = porRuta(pendientes);

  function abrir(valor: boolean) {
    // Al abrir arranca todo marcado: el caso de siempre es pagar todo.
    if (valor) setElegidas(new Set(pendientes.map(claveDe)));
    setAbierto(valor);
  }

  function fijar(paradas: ParadaDelivery[], incluir: boolean) {
    setElegidas((previas) => {
      const nuevas = new Set(previas);
      for (const p of paradas) {
        if (incluir) nuevas.add(claveDe(p));
        else nuevas.delete(claveDe(p));
      }
      return nuevas;
    });
  }

  async function liquidar() {
    if (!motorizado.repartidorId || seleccion.length === 0) return;
    setEnviando(true);
    try {
      const liquidacion = await apiPost<LiquidacionDelivery>("/delivery/liquidaciones", {
        repartidorId: motorizado.repartidorId,
        desde,
        hasta,
        nota: nota.trim() || null,
        paradas: seleccion.map((p) => ({ rutaId: p.rutaId, clienteId: p.clienteId, vehiculoId: p.vehiculoId })),
      });
      const quedan = pendientes.length - seleccion.length;
      toast.success(`Pago registrado: ${formatUsd(liquidacion.totalUsd, 2)}`, {
        description:
          `${formatNumero(liquidacion.entregas)} entregas de ${motorizado.conductor}` +
          (quedan > 0 ? `. Quedan ${formatNumero(quedan)} pendientes.` : ""),
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
    : pendientes.length === 0
      ? motorizado.sinDistancia > 0
        ? "Sus entregas todavía no tienen distancia calculada, así que no hay monto que pagar"
        : "No hay entregas pendientes de pago en este período"
      : null;

  const todas = seleccion.length === pendientes.length;

  return (
    <Dialog open={abierto} onOpenChange={abrir}>
      <DialogTrigger asChild disabled={!!motivo}>
        <span title={motivo ?? undefined} className="inline-flex">
          <Button size="sm" variant="outline" disabled={!!motivo}>
            <BanknoteIcon />
            Registrar pago
          </Button>
        </span>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Registrar el pago de {motorizado.conductor}</DialogTitle>
          <DialogDescription>
            Entregas pendientes del {formatDate(desde)} al {formatDate(hasta)}. Marca las que entran en este pago: las
            demás siguen pendientes para el próximo corte. Lo pagado queda congelado con esos kilómetros y montos, aunque
            después cambie el tabulador.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>
              {formatNumero(seleccion.length)} de {formatNumero(pendientes.length)} entregas elegidas
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7"
              onClick={() => fijar(pendientes, !todas)}
            >
              {todas ? "Desmarcar todas" : "Marcar todas"}
            </Button>
          </div>
          <div className="max-h-72 overflow-y-auto rounded-lg border border-border">
            {grupos.map((g) => {
              const marcadas = g.paradas.filter((p) => elegidas.has(claveDe(p))).length;
              const subtotal = g.paradas.reduce((suma, p) => suma + (p.montoUsd ?? 0), 0);
              const idRuta = `pago-ruta-${g.rutaId}`;
              return (
                <div key={g.rutaId} className="border-b border-border last:border-b-0">
                  <div className="flex items-center gap-2.5 bg-muted/50 px-3 py-2">
                    <Checkbox
                      id={idRuta}
                      checked={marcadas === g.paradas.length ? true : marcadas > 0 ? "indeterminate" : false}
                      onCheckedChange={() => fijar(g.paradas, marcadas !== g.paradas.length)}
                    />
                    <Label htmlFor={idRuta} className="flex-1 cursor-pointer text-xs font-semibold">
                      {g.rutaNumero} · {formatDate(g.fecha)}
                    </Label>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {formatNumero(g.paradas.length)} · {formatUsd(subtotal, 2)}
                    </span>
                  </div>
                  <ul>
                    {g.paradas.map((p) => {
                      const id = `pago-${claveDe(p)}`;
                      return (
                        <li key={claveDe(p)} className="flex items-center gap-2.5 px-3 py-1.5 pl-6">
                          <Checkbox
                            id={id}
                            checked={elegidas.has(claveDe(p))}
                            onCheckedChange={(v) => fijar([p], v === true)}
                          />
                          <Label
                            htmlFor={id}
                            className="min-w-0 flex-1 cursor-pointer flex-col items-start gap-0 font-normal"
                          >
                            <span className="block w-full truncate">{p.clienteNombre}</span>
                            <span className="block text-xs text-muted-foreground">
                              cód. {p.clienteCodigo}
                              {p.km != null && ` · ${formatNumero(p.km, 1)} km`}
                            </span>
                          </Label>
                          <span className="text-sm tabular-nums">{formatUsd(p.montoUsd, 2)}</span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </div>
        </div>

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

        <DialogFooter>
          <Button variant="outline" onClick={() => setAbierto(false)} disabled={enviando}>
            Cancelar
          </Button>
          <Button onClick={liquidar} disabled={enviando || seleccion.length === 0}>
            {enviando
              ? "Registrando..."
              : seleccion.length === 0
                ? "Elige al menos una entrega"
                : `Registrar ${formatUsd(total, 2)}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
