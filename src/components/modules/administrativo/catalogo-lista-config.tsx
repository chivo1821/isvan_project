"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2Icon, SettingsIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiPut, mensajeDeError } from "@/lib/api-client";
import type { BaseCosto, ListaPrecio, MetodoMargen } from "@/lib/administrativo";

export function ListaConfigDialog({
  lista,
  onActualizado,
}: {
  lista: ListaPrecio;
  onActualizado?: () => void;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [guardando, setGuardando] = useState(false);

  const [baseCosto, setBaseCosto] = useState<BaseCosto>(lista.baseCostoPorDefecto ?? "PROMEDIO");
  const [metodoMargen, setMetodoMargen] = useState<MetodoMargen>(lista.metodoMargen ?? "SOBRE_VENTA");
  const [margenObjetivoPct, setMargenObjetivoPct] = useState<string>(
    lista.margenObjetivoPct != null ? String(lista.margenObjetivoPct) : "20"
  );

  async function guardar() {
    setGuardando(true);
    try {
      const pct = parseFloat(margenObjetivoPct.replace(",", "."));
      await apiPut(`/catalogo/listas/${lista.id}`, {
        baseCostoPorDefecto: baseCosto,
        metodoMargen,
        margenObjetivoPct: Number.isNaN(pct) ? null : pct,
      });

      toast.success("Configuración de lista actualizada");
      setAbierto(false);
      onActualizado?.();
      router.refresh();
    } catch (err) {
      toast.error("No se pudo guardar la configuración", {
        description: mensajeDeError(err, "Revisa los campos"),
      });
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Dialog open={abierto} onOpenChange={setAbierto}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 gap-1 px-2 text-xs">
          <SettingsIcon className="size-3.5" /> Configurar lista
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">Configuración de Lista de Precios</DialogTitle>
          <DialogDescription className="text-xs">
            {lista.codigo} — {lista.nombre}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2 text-sm">
          <div className="space-y-1.5">
            <Label htmlFor="cfg-base">Base de costo por defecto</Label>
            <Select value={baseCosto} onValueChange={(v) => setBaseCosto(v as BaseCosto)}>
              <SelectTrigger id="cfg-base" className="h-8 text-xs sm:text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="PROMEDIO">Costo Promedio (SENIAT - Fiscal)</SelectItem>
                <SelectItem value="ULTIMO">Último Costo (Reposición)</SelectItem>
                <SelectItem value="PRESUPUESTARIO">Costo Presupuestario</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              Base utilizada para calcular y alertar rentabilidad en los reportes de ventas.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cfg-metodo">Método de cálculo de margen</Label>
            <Select value={metodoMargen} onValueChange={(v) => setMetodoMargen(v as MetodoMargen)}>
              <SelectTrigger id="cfg-metodo" className="h-8 text-xs sm:text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="SOBRE_VENTA">Margen sobre Venta: (Precio - Costo) / Precio</SelectItem>
                <SelectItem value="SOBRE_COSTO">Margen sobre Costo (Markup): (Precio - Costo) / Costo</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cfg-margen-obj">Margen objetivo mínimo (%)</Label>
            <Input
              id="cfg-margen-obj"
              type="text"
              inputMode="decimal"
              className="h-8 text-xs sm:text-sm"
              value={margenObjetivoPct}
              onChange={(e) => setMargenObjetivoPct(e.target.value)}
              placeholder="ej. 20"
            />
            <p className="text-[11px] text-muted-foreground">
              Se mostrará una advertencia si el margen del producto cae por debajo de este porcentaje.
            </p>
          </div>
        </div>

        <DialogFooter className="flex-row justify-end gap-2">
          <Button variant="outline" onClick={() => setAbierto(false)} disabled={guardando}>
            Cancelar
          </Button>
          <Button onClick={guardar} disabled={guardando}>
            {guardando && <Loader2Icon className="mr-1.5 size-4 animate-spin" />}
            Guardar cambios
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
