"use client";

import { useState } from "react";
import { KeyRoundIcon } from "lucide-react";
import { toast } from "sonner";
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

export function RestablecerPasswordDialog({ usuarioId, usuarioNombre }: { usuarioId: string; usuarioNombre: string }) {
  const [open, setOpen] = useState(false);
  const [passwordNueva, setPasswordNueva] = useState("");
  const [enviando, setEnviando] = useState(false);

  function cerrar(v: boolean) {
    setOpen(v);
    if (!v) setPasswordNueva("");
  }

  async function confirmar() {
    if (passwordNueva.length < 8) {
      toast.error("La contraseña debe tener al menos 8 caracteres");
      return;
    }
    setEnviando(true);
    try {
      await apiPost(`/usuarios/${usuarioId}/reset-password`, { passwordNueva });
      toast.success(`Contraseña de ${usuarioNombre} restablecida`, {
        description: "Comunícasela por un canal seguro — puede cambiarla después desde su perfil.",
      });
      cerrar(false);
    } catch (err) {
      toast.error("No se pudo restablecer la contraseña", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={cerrar}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Restablecer contraseña de ${usuarioNombre}`}>
          <KeyRoundIcon />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Restablecer contraseña</DialogTitle>
          <DialogDescription>
            Define una contraseña temporal para {usuarioNombre}. Comunícasela por un canal seguro; puede cambiarla
            después desde su perfil.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5 py-2">
          <Label htmlFor="password-nueva">Contraseña nueva</Label>
          <Input
            id="password-nueva"
            type="password"
            value={passwordNueva}
            onChange={(e) => setPasswordNueva(e.target.value)}
            autoFocus
          />
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancelar</Button>
          </DialogClose>
          <Button onClick={confirmar} disabled={enviando || passwordNueva.length < 8}>
            {enviando ? "Restableciendo..." : "Restablecer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
