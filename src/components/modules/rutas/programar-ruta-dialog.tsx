"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarClockIcon } from "lucide-react";
import { toast } from "sonner";
import { apiPatch, mensajeDeError } from "@/lib/api-client";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TIPO_VEHICULO_META, formatDateTime } from "@/lib/constants";
import type { Ruta } from "@/lib/mock-data/types";
import { partesCaracas, salidaIso, type VehiculoOpcion } from "@/lib/planificacion";

// Radix Select no admite "" como valor de una opción.
const SIN_VEHICULO = "__sin_vehiculo";

function detalleVehiculo(
  v: VehiculoOpcion,
  { libre, pesoKg }: { libre: boolean | null; pesoKg?: number }
): { texto: string; problema: boolean } {
  if (v.estado !== "FUNCIONAL") {
    return { texto: v.estado === "EN_MANTENIMIENTO" ? "en mantenimiento" : "fuera de servicio", problema: true };
  }
  if (pesoKg != null && v.capacidadKg < pesoKg) return { texto: "capacidad insuficiente", problema: true };
  if (libre === false) return { texto: "ocupado a esa hora", problema: true };
  if (libre === true) return { texto: "libre a esa hora", problema: false };
  return { texto: "", problema: false };
}

/** Reprogramar la salida de una ruta planificada y asignarle, cambiarle o
 * quitarle el vehículo (PATCH /rutas/{id}/programacion). Nada de esto
 * bloquea: si queda un conflicto, la API lo devuelve como aviso y se muestra. */
export function ProgramarRutaDialog({
  ruta,
  vehiculos,
  libres,
  pesoKg,
  trigger,
}: {
  ruta: { id: string; numero: string; salidaProgramada: string; vehiculoId: string | null };
  vehiculos: VehiculoOpcion[];
  /** Los vehículos libres en el horario actual de la ruta, si se conocen. */
  libres?: string[] | null;
  pesoKg?: number;
  trigger?: React.ReactNode;
}) {
  const router = useRouter();
  const inicial = partesCaracas(ruta.salidaProgramada);
  const [open, setOpen] = useState(false);
  const [fecha, setFecha] = useState(inicial.fecha);
  const [hora, setHora] = useState(inicial.hora);
  const [vehiculoId, setVehiculoId] = useState(ruta.vehiculoId ?? SIN_VEHICULO);
  const [guardando, setGuardando] = useState(false);

  const salida = salidaIso(fecha, hora);
  const salidaCambio = fecha !== inicial.fecha || hora !== inicial.hora;
  const vehiculoNuevo = vehiculoId === SIN_VEHICULO ? null : vehiculoId;
  const vehiculoCambio = vehiculoNuevo !== ruta.vehiculoId;
  // Los libres se calcularon para el horario actual: con otro horario ya no
  // valen (la API avisa después si el elegido choca con otra ruta).
  const libresVigentes = !salidaCambio && libres ? new Set(libres) : null;

  function reiniciar() {
    setFecha(inicial.fecha);
    setHora(inicial.hora);
    setVehiculoId(ruta.vehiculoId ?? SIN_VEHICULO);
  }

  async function guardar() {
    if (!salida) return;
    const cambios: { salidaProgramada?: string; vehiculoId?: string | null } = {};
    if (salidaCambio) cambios.salidaProgramada = salida;
    if (vehiculoCambio) cambios.vehiculoId = vehiculoNuevo;
    setGuardando(true);
    try {
      const actualizada = await apiPatch<Ruta>(`/rutas/${ruta.id}/programacion`, cambios);
      toast.success(`Ruta ${ruta.numero} actualizada`, {
        description: `Sale el ${formatDateTime(actualizada.salidaProgramada)}${
          actualizada.vehiculoId ? "" : " · sin vehículo"
        }.`,
      });
      if (actualizada.avisos?.length) {
        toast.warning("La ruta quedó con avisos", {
          description: actualizada.avisos.map((a) => a.mensaje).join(" · "),
        });
      }
      setOpen(false);
      router.refresh();
    } catch (err) {
      toast.error("No se pudo actualizar la ruta", { description: mensajeDeError(err, "Intenta de nuevo") });
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
        {trigger ?? (
          <Button variant="outline" size="sm">
            <CalendarClockIcon />
            Programar
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Programar la ruta {ruta.numero}</DialogTitle>
          <DialogDescription>
            La hora de salida es la de recogida en el almacén que ve el repartidor. El vehículo se puede
            asignar ahora o más adelante.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex flex-wrap gap-3">
            <div className="space-y-1.5">
              <Label htmlFor={`fecha-${ruta.id}`}>Fecha de salida</Label>
              <Input
                id={`fecha-${ruta.id}`}
                type="date"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
                className="w-44"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`hora-${ruta.id}`}>Hora</Label>
              <Input
                id={`hora-${ruta.id}`}
                type="time"
                value={hora}
                onChange={(e) => setHora(e.target.value)}
                className="w-32"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`vehiculo-${ruta.id}`}>Vehículo</Label>
            <Select value={vehiculoId} onValueChange={setVehiculoId}>
              <SelectTrigger id={`vehiculo-${ruta.id}`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SIN_VEHICULO}>Sin vehículo (se asigna después)</SelectItem>
                {vehiculos.map((v) => {
                  const { texto, problema } = detalleVehiculo(v, {
                    libre: libresVigentes ? libresVigentes.has(v.id) : null,
                    pesoKg,
                  });
                  return (
                    <SelectItem key={v.id} value={v.id}>
                      <span>
                        {v.placa} — {TIPO_VEHICULO_META[v.tipo].label} ·{" "}
                        {v.capacidadKg.toLocaleString("es-VE")} kg
                        {texto && (
                          <span className={problema ? "text-warning" : "text-muted-foreground"}> · {texto}</span>
                        )}
                      </span>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            {salidaCambio && libres && (
              <p className="text-xs text-muted-foreground">
                Con el horario nuevo, si el vehículo elegido choca con otra ruta se avisará al guardar.
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={guardando}>
              Cancelar
            </Button>
          </DialogClose>
          <Button onClick={guardar} disabled={guardando || !salida || (!salidaCambio && !vehiculoCambio)}>
            {guardando ? "Guardando..." : "Guardar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
