"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { PlusIcon } from "lucide-react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { apiPost } from "@/lib/api-client";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Cliente, Empresa } from "@/lib/mock-data";

const clienteSchema = z.object({
  empresa: z.enum(["ISVAN", "TRALOG"], { error: "Selecciona una empresa" }),
  codigo: z.string().min(1, "El código es obligatorio"),
  nombre: z.string().min(1, "El nombre es obligatorio"),
  tipo: z.string().min(1, "El tipo es obligatorio"),
  direccion: z.string().min(1, "La dirección es obligatoria"),
  ciudad: z.string().min(1, "La ciudad es obligatoria"),
  lat: z.number().optional(),
  lng: z.number().optional(),
  telefono: z.string().min(1, "El teléfono es obligatorio"),
  email: z.union([z.email("Ingresa un email válido"), z.literal("")]).optional(),
});

type ClienteFormValues = z.infer<typeof clienteSchema>;

export function NuevoClienteDialog({ onAdd }: { onAdd: (cliente: Cliente) => void }) {
  const [open, setOpen] = useState(false);
  const {
    control,
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ClienteFormValues>({
    resolver: zodResolver(clienteSchema),
    defaultValues: {
      empresa: undefined,
      codigo: "",
      nombre: "",
      tipo: "",
      direccion: "",
      ciudad: "",
      lat: undefined,
      lng: undefined,
      telefono: "",
      email: "",
    },
  });

  async function onSubmit(values: ClienteFormValues) {
    try {
      const cliente = await apiPost<Cliente>("/clientes", {
        empresa: values.empresa,
        codigo: values.codigo.trim(),
        nombre: values.nombre.trim(),
        tipo: values.tipo.trim(),
        direccion: values.direccion.trim(),
        ciudad: values.ciudad.trim(),
        lat: values.lat,
        lng: values.lng,
        telefono: values.telefono.trim(),
        email: values.email?.trim() || undefined,
      });
      onAdd(cliente);
      toast.success(`Cliente ${cliente.nombre} agregado`);
      reset();
      setOpen(false);
    } catch (err) {
      toast.error("No se pudo agregar el cliente", {
        description: err instanceof Error ? err.message : undefined,
      });
    }
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
          Agregar cliente
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit(onSubmit)}>
          <DialogHeader>
            <DialogTitle>Agregar cliente</DialogTitle>
            <DialogDescription>
              Las coordenadas son necesarias para poder incluir a este cliente en una ruta más adelante.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 gap-3 py-2 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="empresa">Empresa</Label>
              <Controller
                control={control}
                name="empresa"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={(v) => field.onChange(v as Empresa)}>
                    <SelectTrigger id="empresa" className="w-full">
                      <SelectValue placeholder="ISVAN o TRALOG" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ISVAN">ISVAN</SelectItem>
                      <SelectItem value="TRALOG">TRALOG</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
              {errors.empresa && <p className="text-xs text-destructive">{errors.empresa.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="codigo">Código</Label>
              <Input id="codigo" placeholder="CLI-0001" {...register("codigo")} />
              {errors.codigo && <p className="text-xs text-destructive">{errors.codigo.message}</p>}
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="nombre">Nombre</Label>
              <Input id="nombre" placeholder="Nombre del cliente" {...register("nombre")} />
              {errors.nombre && <p className="text-xs text-destructive">{errors.nombre.message}</p>}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="tipo">Tipo</Label>
              <Input id="tipo" placeholder="Tienda / Distribuidor / Consumidor final" {...register("tipo")} />
              {errors.tipo && <p className="text-xs text-destructive">{errors.tipo.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ciudad">Ciudad</Label>
              <Input id="ciudad" {...register("ciudad")} />
              {errors.ciudad && <p className="text-xs text-destructive">{errors.ciudad.message}</p>}
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="direccion">Dirección</Label>
              <Input id="direccion" {...register("direccion")} />
              {errors.direccion && <p className="text-xs text-destructive">{errors.direccion.message}</p>}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="lat">Latitud</Label>
              <Input id="lat" type="number" step="any" {...register("lat", { valueAsNumber: true })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lng">Longitud</Label>
              <Input id="lng" type="number" step="any" {...register("lng", { valueAsNumber: true })} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="telefono">Teléfono</Label>
              <Input id="telefono" {...register("telefono")} />
              {errors.telefono && <p className="text-xs text-destructive">{errors.telefono.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email">Email (opcional)</Label>
              <Input id="email" type="email" {...register("email")} />
              {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
            </div>
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancelar
              </Button>
            </DialogClose>
            <Button type="submit" disabled={isSubmitting}>
              Agregar cliente
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
