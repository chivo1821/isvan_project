"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Edit3Icon, Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiPut, mensajeDeError } from "@/lib/api-client";
import { formatUsd } from "@/lib/constants";
import type { ModoPresupuestario } from "@/lib/administrativo";

export function CostoPresupuestarioDialog({
  productoId,
  codigo,
  nombre,
  ultimoCostoUsd,
  costoPromedioUsd,
  costoPresupuestarioActualUsd,
  modoActual = "MANUAL",
  porcentajeActual = 0,
  onActualizado,
  children,
}: {
  productoId: string;
  codigo: number;
  nombre: string;
  ultimoCostoUsd?: number | null;
  costoPromedioUsd?: number | null;
  costoPresupuestarioActualUsd?: number | null;
  modoActual?: ModoPresupuestario;
  porcentajeActual?: number | null;
  onActualizado?: () => void;
  children?: React.ReactNode;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [modo, setModo] = useState<ModoPresupuestario>(modoActual);
  const [valorManual, setValorManual] = useState<string>(
    costoPresupuestarioActualUsd != null ? String(costoPresupuestarioActualUsd) : ""
  );
  const [porcentaje, setPorcentaje] = useState<string>(
    porcentajeActual != null ? String(porcentajeActual) : "10"
  );

  const baseCalculo = modo === "SOBRE_ULTIMO" ? ultimoCostoUsd : modo === "SOBRE_PROMEDIO" ? costoPromedioUsd : null;
  const pctNum = parseFloat(porcentaje.replace(",", ".")) || 0;
  const costoCalculado = baseCalculo != null ? baseCalculo * (1 + pctNum / 100) : null;

  async function guardar() {
    setGuardando(true);
    try {
      const cuerpo: {
        modo: ModoPresupuestario;
        costoPresupuestarioCajaUsd?: number | null;
        porcentajePresupuestario?: number | null;
        porcentaje?: number | null;
      } = {
        modo,
      };

      if (modo === "MANUAL") {
        const val = parseFloat(valorManual.replace(",", "."));
        if (Number.isNaN(val) || val < 0) {
          toast.error("Ingresa un monto válido");
          setGuardando(false);
          return;
        }
        cuerpo.costoPresupuestarioCajaUsd = val;
        cuerpo.porcentajePresupuestario = null;
        cuerpo.porcentaje = null;
      } else {
        cuerpo.porcentajePresupuestario = pctNum;
        cuerpo.porcentaje = pctNum;
        cuerpo.costoPresupuestarioCajaUsd = costoCalculado;
      }

      await apiPut(`/inventario/productos/${productoId}/costo-presupuestario`, cuerpo);
      toast.success("Costo presupuestario actualizado");
      setAbierto(false);
      onActualizado?.();
      router.refresh();
    } catch (err) {
      toast.error("No se pudo actualizar el costo presupuestario", {
        description: mensajeDeError(err, "Revisa los valores ingresados"),
      });
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Dialog
      open={abierto}
      onOpenChange={(v) => {
        if (v) {
          setModo(modoActual);
          setValorManual(
            costoPresupuestarioActualUsd != null ? String(costoPresupuestarioActualUsd) : ""
          );
          setPorcentaje(porcentajeActual != null ? String(porcentajeActual) : "10");
        }
        setAbierto(v);
      }}
    >
      <DialogTrigger asChild>
        {children ?? (
          <Button variant="ghost" size="sm" className="h-8 gap-1 px-2 text-xs">
            <Edit3Icon className="size-3.5" /> Editar
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">Costo Presupuestario</DialogTitle>
          <DialogDescription className="text-xs">
            #{codigo} · {nombre}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2 text-sm">
          <div className="grid grid-cols-2 gap-2 rounded-lg bg-muted/40 p-2.5 text-xs">
            <div>
              <span className="text-muted-foreground">Último Costo: </span>
              <span className="font-semibold tabular-nums text-foreground">{formatUsd(ultimoCostoUsd, 2)}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Promedio SENIAT: </span>
              <span className="font-semibold tabular-nums text-foreground">{formatUsd(costoPromedioUsd, 2)}</span>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="modo-pres">Método de fijación</Label>
            <Select value={modo} onValueChange={(v) => setModo(v as ModoPresupuestario)}>
              <SelectTrigger id="modo-pres">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="MANUAL">Manual (monto fijo en USD)</SelectItem>
                <SelectItem value="SOBRE_ULTIMO">Sobre Último Costo (+ %)</SelectItem>
                <SelectItem value="SOBRE_PROMEDIO">Sobre Costo Promedio (+ %)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {modo === "MANUAL" ? (
            <div className="space-y-1.5">
              <Label htmlFor="monto-manual">Costo Presupuestario (USD / caja)</Label>
              <Input
                id="monto-manual"
                type="text"
                inputMode="decimal"
                value={valorManual}
                onChange={(e) => setValorManual(e.target.value)}
                placeholder="0.00"
              />
            </div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="pct-margen">Porcentaje sobre base (%)</Label>
                <Input
                  id="pct-margen"
                  type="text"
                  inputMode="decimal"
                  value={porcentaje}
                  onChange={(e) => setPorcentaje(e.target.value)}
                  placeholder="ej. 10"
                />
              </div>
              <div className="rounded-md border border-border p-3 text-xs">
                <p className="text-muted-foreground">Vista previa del costo resultante:</p>
                <p className="mt-1 text-base font-bold tabular-nums text-foreground">
                  {formatUsd(costoCalculado, 2)} / caja
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Se recalculará automáticamente ante futuras compras o entradas valoradas.
                </p>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="flex-row justify-end gap-2 sm:justify-end">
          <Button variant="outline" onClick={() => setAbierto(false)} disabled={guardando}>
            Cancelar
          </Button>
          <Button onClick={guardar} disabled={guardando}>
            {guardando && <Loader2Icon className="mr-1.5 size-4 animate-spin" />}
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
