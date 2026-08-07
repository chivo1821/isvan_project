"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { PlusIcon } from "lucide-react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TIPO_VEHICULO_META } from "@/lib/constants";
import { almacenes, type Vehiculo } from "@/lib/mock-data";
import type { TipoVehiculo } from "@prisma/client";

const TIPOS: TipoVehiculo[] = ["CAMION_REFRIGERADO", "CAMIONETA", "MOTO"];

const vehiculoSchema = z.object({
  placa: z.string().min(1, "La placa es obligatoria"),
  tipo: z.enum(["CAMION_REFRIGERADO", "CAMIONETA", "MOTO"], { error: "Selecciona un tipo" }),
  capacidadKg: z.number({ error: "Ingresa la capacidad en kg" }).positive("Debe ser mayor a 0"),
  tieneRefrigeracion: z.boolean(),
  conductorNombre: z.string().optional(),
});

type VehiculoFormValues = z.infer<typeof vehiculoSchema>;

// Contador simple para ids de vehiculos agregados en esta sesion (no persisten).
let siguienteIdVehiculo = 1;

export function NuevoVehiculoDialog({ onAdd }: { onAdd: (vehiculo: Vehiculo) => void }) {
  const [open, setOpen] = useState(false);
  const {
    control,
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<VehiculoFormValues>({
    resolver: zodResolver(vehiculoSchema),
    defaultValues: {
      placa: "",
      tipo: undefined,
      capacidadKg: undefined,
      tieneRefrigeracion: true,
      conductorNombre: "",
    },
  });

  function onSubmit(values: VehiculoFormValues) {
    const vehiculo: Vehiculo = {
      id: `veh-local-${siguienteIdVehiculo++}`,
      placa: values.placa.toUpperCase(),
      tipo: values.tipo,
      capacidadKg: values.capacidadKg,
      tieneRefrigeracion: values.tieneRefrigeracion,
      estado: "FUNCIONAL",
      almacenBaseId: almacenes[0].id,
      conductorNombre: values.conductorNombre?.trim() || null,
      ultimaRevision: null,
    };
    onAdd(vehiculo);
    toast.success(`Vehículo ${vehiculo.placa} agregado`, {
      description: "(Simulación: no se persiste todavía — se perderá al recargar la página.)",
    });
    reset();
    setOpen(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <PlusIcon />
          Agregar vehículo
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit(onSubmit)}>
          <DialogHeader>
            <DialogTitle>Agregar vehículo</DialogTitle>
            <DialogDescription>Se agrega a la flota con base en {almacenes[0].nombre}.</DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="placa">Placa</Label>
              <Input id="placa" placeholder="AB123CD" {...register("placa")} />
              {errors.placa && <p className="text-xs text-destructive">{errors.placa.message}</p>}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="tipo">Tipo</Label>
              <Controller
                control={control}
                name="tipo"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="tipo" className="w-full">
                      <SelectValue placeholder="Selecciona un tipo" />
                    </SelectTrigger>
                    <SelectContent>
                      {TIPOS.map((t) => (
                        <SelectItem key={t} value={t}>
                          {TIPO_VEHICULO_META[t].label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              {errors.tipo && <p className="text-xs text-destructive">{errors.tipo.message}</p>}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="capacidadKg">Capacidad (kg)</Label>
              <Input
                id="capacidadKg"
                type="number"
                min={1}
                placeholder="1200"
                {...register("capacidadKg", { valueAsNumber: true })}
              />
              {errors.capacidadKg && <p className="text-xs text-destructive">{errors.capacidadKg.message}</p>}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="conductorNombre">Conductor (opcional)</Label>
              <Input id="conductorNombre" placeholder="Nombre del conductor" {...register("conductorNombre")} />
            </div>

            <Controller
              control={control}
              name="tieneRefrigeracion"
              render={({ field }) => (
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={field.value} onCheckedChange={(v) => field.onChange(v === true)} />
                  Tiene refrigeración
                </label>
              )}
            />
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancelar
              </Button>
            </DialogClose>
            <Button type="submit">Agregar vehículo</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
