"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SettingsIcon } from "lucide-react";
import { toast } from "sonner";
import { apiPut, mensajeDeError } from "@/lib/api-client";
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
import { formatDateTime } from "@/lib/constants";
import type { AjustePlanificacion } from "@/lib/planificacion";

/** Los ajustes de la planificación (hoy, la distancia máxima de las motos).
 * Solo ADMIN: la página no lo muestra a otros y la API lo vuelve a validar. */
export function AjustesPlanificacionDialog({ ajustes }: { ajustes: AjustePlanificacion[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [valores, setValores] = useState<Record<string, string>>({});
  const [guardando, setGuardando] = useState(false);

  function reiniciar() {
    setValores(Object.fromEntries(ajustes.map((a) => [a.clave, String(a.valor)])));
  }

  const cambiados = ajustes.filter((a) => Number(valores[a.clave]) !== a.valor);
  const invalidos = ajustes.filter((a) => {
    const n = Number(valores[a.clave]);
    return valores[a.clave] === "" || !Number.isFinite(n) || n < a.minimo || n > a.maximo;
  });

  async function guardar() {
    setGuardando(true);
    try {
      for (const a of cambiados) {
        await apiPut(`/rutas/configuracion/${a.clave}`, { valor: Number(valores[a.clave]) });
      }
      toast.success("Ajustes guardados", {
        description: "Las próximas sugerencias de ruta ya usan los valores nuevos.",
      });
      setOpen(false);
      router.refresh();
    } catch (err) {
      toast.error("No se pudieron guardar los ajustes", { description: mensajeDeError(err, "Intenta de nuevo") });
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) reiniciar();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">
          <SettingsIcon />
          Ajustes
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ajustes de la planificación</DialogTitle>
          <DialogDescription>Se aplican a las sugerencias de ruta y a los avisos de todas las rutas.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {ajustes.map((a) => (
            <div key={a.clave} className="space-y-1.5">
              <Label htmlFor={`ajuste-${a.clave}`}>{a.etiqueta}</Label>
              <div className="flex items-center gap-2">
                <Input
                  id={`ajuste-${a.clave}`}
                  type="number"
                  inputMode="decimal"
                  min={a.minimo}
                  max={a.maximo}
                  step="any"
                  value={valores[a.clave] ?? ""}
                  onChange={(e) => setValores((prev) => ({ ...prev, [a.clave]: e.target.value }))}
                  className="w-32"
                />
                <span className="text-sm text-muted-foreground">{a.unidad}</span>
              </div>
              <p className="text-xs text-muted-foreground">{a.descripcion}</p>
              <p className="text-xs text-muted-foreground">
                Entre {a.minimo.toLocaleString("es-VE")} y {a.maximo.toLocaleString("es-VE")} {a.unidad} · por
                defecto {a.defecto.toLocaleString("es-VE")} {a.unidad}
                {a.actualizadoEn &&
                  ` · cambiado el ${formatDateTime(a.actualizadoEn)}${a.actualizadoPor ? ` por ${a.actualizadoPor}` : ""}`}
              </p>
            </div>
          ))}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={guardando}>
              Cancelar
            </Button>
          </DialogClose>
          <Button onClick={guardar} disabled={guardando || cambiados.length === 0 || invalidos.length > 0}>
            {guardando ? "Guardando..." : "Guardar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
