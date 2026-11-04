"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarOffIcon, ChevronLeftIcon, ChevronRightIcon, PlusIcon, TrashIcon } from "lucide-react";
import { toast } from "sonner";
import { apiGet, apiPut, mensajeDeError } from "@/lib/api-client";
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
import type { DiaFeriado } from "@/lib/indicadores";

/** Los feriados del año: no cuentan como días de venta en el cuadro de metas.
 * Carnaval y Semana Santa cambian cada año, por eso se cargan a mano. */
export function FeriadosDialog({ anioInicial }: { anioInicial: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [anio, setAnio] = useState(anioInicial);
  const [feriados, setFeriados] = useState<DiaFeriado[] | null>(null);
  const [cargadoDe, setCargadoDe] = useState<number | null>(null);
  const [guardando, setGuardando] = useState(false);
  const cargando = cargadoDe !== anio;

  useEffect(() => {
    if (!open) return;
    let vigente = true;
    apiGet<{ anio: number; feriados: DiaFeriado[] }>(`/indicadores/feriados?anio=${anio}`)
      .then((r) => {
        if (!vigente) return;
        setFeriados(r.feriados);
        setCargadoDe(r.anio);
      })
      .catch((e) => toast.error("No se pudieron cargar los feriados", { description: mensajeDeError(e, "Intenta de nuevo") }));
    return () => {
      vigente = false;
    };
  }, [open, anio]);

  function cambiar(indice: number, cambio: Partial<DiaFeriado>) {
    setFeriados((previos) => (previos ?? []).map((f, i) => (i === indice ? { ...f, ...cambio } : f)));
  }

  async function guardar() {
    if (!feriados) return;
    const incompletos = feriados.filter((f) => !f.fecha || !f.nombre.trim());
    if (incompletos.length) {
      toast.error("Hay feriados sin fecha o sin nombre", { description: "Complétalos o quítalos antes de guardar." });
      return;
    }
    setGuardando(true);
    try {
      const r = await apiPut<{ feriados: DiaFeriado[] }>("/indicadores/feriados", { anio, feriados });
      setFeriados(r.feriados);
      toast.success(`Feriados de ${anio} guardados`, { description: `${r.feriados.length} día(s).` });
      router.refresh();
    } catch (e) {
      toast.error("No se pudieron guardar los feriados", { description: mensajeDeError(e, "Intenta de nuevo") });
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <CalendarOffIcon />
          Feriados
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Feriados</DialogTitle>
          <DialogDescription>
            Los días que no cuentan como días de venta (de lunes a viernes). Carnaval y Semana Santa cambian cada año:
            revísalos al empezar el año.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={() => setAnio(anio - 1)} aria-label="Año anterior">
            <ChevronLeftIcon />
          </Button>
          <span className="min-w-12 text-center text-sm font-medium tabular-nums">{anio}</span>
          <Button variant="ghost" size="icon" onClick={() => setAnio(anio + 1)} aria-label="Año siguiente">
            <ChevronRightIcon />
          </Button>
        </div>

        <div className="max-h-[50vh] space-y-2 overflow-y-auto pr-1">
          {cargando || !feriados ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Cargando…</p>
          ) : feriados.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No hay feriados cargados en {anio}.</p>
          ) : (
            feriados.map((f, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  type="date"
                  min={`${anio}-01-01`}
                  max={`${anio}-12-31`}
                  value={f.fecha.slice(0, 10)}
                  onChange={(e) => cambiar(i, { fecha: e.target.value })}
                  className="w-40"
                  aria-label="Fecha del feriado"
                />
                <Input
                  value={f.nombre}
                  onChange={(e) => cambiar(i, { nombre: e.target.value })}
                  placeholder="Nombre"
                  aria-label="Nombre del feriado"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setFeriados((previos) => (previos ?? []).filter((_, j) => j !== i))}
                  aria-label={`Quitar el feriado ${f.nombre}`}
                >
                  <TrashIcon />
                </Button>
              </div>
            ))
          )}
        </div>

        <DialogFooter className="sm:justify-between">
          <Button
            variant="outline"
            onClick={() => setFeriados((previos) => [...(previos ?? []), { fecha: "", nombre: "" }])}
            disabled={cargando || guardando}
          >
            <PlusIcon />
            Agregar feriado
          </Button>
          <Button onClick={guardar} disabled={cargando || guardando}>
            {guardando ? "Guardando…" : `Guardar ${anio}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
