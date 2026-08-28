"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { apiPatch } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const schema = z.object({
  passwordActual: z.string().min(1, "Ingresa tu contraseña actual"),
  passwordNueva: z.string().min(8, "La contraseña nueva debe tener al menos 8 caracteres"),
});

type FormValues = z.infer<typeof schema>;

export function CambiarPasswordDialog({
  usuarioId,
  open,
  onOpenChange,
}: {
  usuarioId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { passwordActual: "", passwordNueva: "" },
  });

  async function onSubmit(values: FormValues) {
    try {
      await apiPatch(`/usuarios/${usuarioId}/password`, values);
      toast.success("Contraseña actualizada");
      reset();
      onOpenChange(false);
    } catch (err) {
      toast.error("No se pudo cambiar la contraseña", {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) reset();
      }}
    >
      <DialogContent>
        <form onSubmit={handleSubmit(onSubmit)}>
          <DialogHeader>
            <DialogTitle>Cambiar contraseña</DialogTitle>
            <DialogDescription>Confirma tu contraseña actual para establecer una nueva.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="passwordActual">Contraseña actual</Label>
              <Input id="passwordActual" type="password" {...register("passwordActual")} />
              {errors.passwordActual && <p className="text-xs text-destructive">{errors.passwordActual.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="passwordNueva">Contraseña nueva</Label>
              <Input id="passwordNueva" type="password" {...register("passwordNueva")} />
              {errors.passwordNueva && <p className="text-xs text-destructive">{errors.passwordNueva.message}</p>}
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancelar
              </Button>
            </DialogClose>
            <Button type="submit" disabled={isSubmitting}>
              Guardar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
