"use client";

import { useState } from "react";
import { toast } from "sonner";
import { apiPatch, mensajeDeError } from "@/lib/api-client";
import type { Usuario } from "@/lib/mock-data";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

/** Casilla del ADMIN para dar o quitar el permiso de aprobar despachos de
 * clientes con deuda vencida (PATCH /usuarios/{id}/excepciones). */
export function PermisoExcepciones({ usuario, onCambio }: { usuario: Usuario; onCambio: (u: Usuario) => void }) {
  const [guardando, setGuardando] = useState(false);
  const id = `excepciones-${usuario.id}`;

  async function cambiar(autoriza: boolean) {
    setGuardando(true);
    try {
      const actualizado = await apiPatch<Usuario>(`/usuarios/${usuario.id}/excepciones`, { autoriza });
      onCambio(actualizado);
      toast.success(autoriza ? `${usuario.nombre} puede autorizar excepciones` : `${usuario.nombre} ya no autoriza excepciones`);
    } catch (err) {
      toast.error("No se pudo cambiar el permiso", { description: mensajeDeError(err, "Intenta de nuevo") });
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="mt-1.5 flex items-center gap-1.5">
      <Checkbox
        id={id}
        checked={Boolean(usuario.autorizaExcepciones)}
        disabled={guardando}
        onCheckedChange={(v) => cambiar(v === true)}
      />
      <Label htmlFor={id} className="text-xs font-normal text-muted-foreground">
        Autoriza excepciones por deuda
      </Label>
    </div>
  );
}
