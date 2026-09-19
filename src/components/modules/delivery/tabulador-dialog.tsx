"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PlusIcon, SlidersHorizontalIcon, TrashIcon } from "lucide-react";
import { toast } from "sonner";
import { apiPut, mensajeDeError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatUsd } from "@/lib/constants";
import { textoRango, type RangoTabulador } from "@/lib/delivery";

type Fila = { hastaKm: string; montoUsd: string };

function aFilas(tabulador: RangoTabulador[]): Fila[] {
  return tabulador.map((r) => ({ hastaKm: r.hastaKm == null ? "" : String(r.hastaKm), montoUsd: String(r.montoUsd) }));
}

/** El tabulador de pago: hasta cuántos kilómetros se paga cada monto. El
 * último rango va sin tope y cubre las distancias más largas. Cambiarlo no
 * altera los pagos ya registrados. */
export function TabuladorDialog({ tabulador }: { tabulador: RangoTabulador[] }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [filas, setFilas] = useState<Fila[]>(aFilas(tabulador));
  const [guardando, setGuardando] = useState(false);

  function cambiar(indice: number, campo: keyof Fila, valor: string) {
    setFilas((previas) => previas.map((f, i) => (i === indice ? { ...f, [campo]: valor } : f)));
  }

  async function guardar() {
    const rangos = filas.map((f, i) => ({
      hastaKm: i === filas.length - 1 ? null : Number(f.hastaKm.replace(",", ".")),
      montoUsd: Number(f.montoUsd.replace(",", ".")),
    }));
    if (rangos.some((r) => (r.hastaKm !== null && !Number.isFinite(r.hastaKm)) || !Number.isFinite(r.montoUsd))) {
      toast.error("Revisa los valores", { description: "Los kilómetros y los montos tienen que ser números." });
      return;
    }
    setGuardando(true);
    try {
      await apiPut<RangoTabulador[]>("/delivery/tabulador", { rangos });
      toast.success("Tabulador actualizado", { description: "Los pagos ya registrados no cambian." });
      setAbierto(false);
      router.refresh();
    } catch (err) {
      toast.error("No se pudo guardar el tabulador", { description: mensajeDeError(err, "Revisa los rangos") });
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Dialog
      open={abierto}
      onOpenChange={(v) => {
        setAbierto(v);
        if (v) setFilas(aFilas(tabulador));
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">
          <SlidersHorizontalIcon />
          Tabulador
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Tabulador de pago por distancia</DialogTitle>
          <DialogDescription>
            Cada rango llega hasta sus kilómetros y paga ese monto; el último va sin tope y cubre todo lo que pase del
            anterior. Los pagos ya registrados conservan el monto con el que se hicieron.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <div className="grid grid-cols-[1fr_1fr_auto] gap-2 text-xs text-muted-foreground">
            <Label>Hasta (km)</Label>
            <Label>Monto (USD)</Label>
            <span className="w-8" />
          </div>
          {filas.map((fila, i) => {
            const ultimo = i === filas.length - 1;
            return (
              <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-center gap-2">
                <Input
                  value={ultimo ? "" : fila.hastaKm}
                  onChange={(e) => cambiar(i, "hastaKm", e.target.value)}
                  disabled={ultimo}
                  placeholder={ultimo ? "sin tope" : "10"}
                  inputMode="decimal"
                  aria-label={`Kilómetros del rango ${i + 1}`}
                />
                <Input
                  value={fila.montoUsd}
                  onChange={(e) => cambiar(i, "montoUsd", e.target.value)}
                  inputMode="decimal"
                  aria-label={`Monto del rango ${i + 1}`}
                />
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled={filas.length <= 1}
                  onClick={() => setFilas((previas) => previas.filter((_, j) => j !== i))}
                  aria-label={`Quitar el rango ${i + 1}`}
                >
                  <TrashIcon />
                </Button>
              </div>
            );
          })}
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              setFilas((previas) => [...previas.slice(0, -1), { hastaKm: "", montoUsd: "0" }, previas[previas.length - 1]])
            }
          >
            <PlusIcon />
            Agregar rango
          </Button>

          <p className="text-xs text-muted-foreground">
            Ahora mismo:{" "}
            {tabulador.map((r, i) => `${textoRango(tabulador, i)} = ${formatUsd(r.montoUsd, 2)}`).join(" · ")}
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setAbierto(false)} disabled={guardando}>
            Cancelar
          </Button>
          <Button onClick={guardar} disabled={guardando}>
            {guardando ? "Guardando..." : "Guardar tabulador"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
