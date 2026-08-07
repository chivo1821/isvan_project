"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { PlusIcon } from "lucide-react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
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
import { ROL_USUARIO_META } from "@/lib/constants";
import type { Usuario } from "@/lib/mock-data";
import type { RolUsuario } from "@prisma/client";

const ROLES: RolUsuario[] = ["ADMIN", "VENTAS", "INVENTARIO", "DESPACHOS", "APROBADOR", "REPARTIDOR"];

const usuarioSchema = z.object({
  nombre: z.string().min(1, "El nombre es obligatorio"),
  email: z.email("Ingresa un email válido"),
  rol: z.enum(["ADMIN", "VENTAS", "INVENTARIO", "DESPACHOS", "APROBADOR", "REPARTIDOR"], {
    error: "Selecciona un rol",
  }),
});

type UsuarioFormValues = z.infer<typeof usuarioSchema>;

// Contador simple para ids de usuarios agregados en esta sesion (no persisten).
let siguienteIdUsuario = 1;

export function NuevoUsuarioDialog({ onAdd }: { onAdd: (usuario: Usuario) => void }) {
  const [open, setOpen] = useState(false);
  const {
    control,
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<UsuarioFormValues>({
    resolver: zodResolver(usuarioSchema),
    defaultValues: { nombre: "", email: "", rol: undefined },
  });

  function onSubmit(values: UsuarioFormValues) {
    const usuario: Usuario = {
      id: `usr-local-${siguienteIdUsuario++}`,
      nombre: values.nombre,
      email: values.email,
      rol: values.rol,
      avatarUrl: null,
      activo: true,
    };
    onAdd(usuario);
    toast.success(`Usuario ${usuario.nombre} agregado`, {
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
          Agregar usuario
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit(onSubmit)}>
          <DialogHeader>
            <DialogTitle>Agregar usuario</DialogTitle>
            <DialogDescription>Se crea activo, con acceso inmediato al sistema.</DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="nombre">Nombre</Label>
              <Input id="nombre" placeholder="Nombre completo" {...register("nombre")} />
              {errors.nombre && <p className="text-xs text-destructive">{errors.nombre.message}</p>}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" placeholder="persona@empresa.com" {...register("email")} />
              {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="rol">Rol</Label>
              <Controller
                control={control}
                name="rol"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="rol" className="w-full">
                      <SelectValue placeholder="Selecciona un rol" />
                    </SelectTrigger>
                    <SelectContent>
                      {ROLES.map((r) => (
                        <SelectItem key={r} value={r}>
                          {ROL_USUARIO_META[r].label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              {errors.rol && <p className="text-xs text-destructive">{errors.rol.message}</p>}
            </div>
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancelar
              </Button>
            </DialogClose>
            <Button type="submit">Agregar usuario</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
