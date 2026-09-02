"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCheckIcon } from "lucide-react";
import { toast } from "sonner";
import { apiPost, mensajeDeError } from "@/lib/api-client";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type Resultado = { aprobados: number; numeros: string[] };

/** Aprueba de una vez toda la cola de despachos pendientes. Solo se le
 * muestra a un ADMIN (la página decide si renderizarlo) y el endpoint
 * también exige rol ADMIN — la UI no es la que autoriza. Pide confirmación
 * porque aprobar en bloque no se deshace desde la app. */
export function AprobarTodosButton({ pendientes }: { pendientes: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [comentario, setComentario] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function aprobarTodos() {
    setEnviando(true);
    try {
      const resultado = await apiPost<Resultado>("/despachos/aprobacion/masiva", {
        comentario: comentario.trim() || undefined,
      });
      toast.success(`${resultado.aprobados} despacho(s) aprobado(s)`, {
        description: "Ya están disponibles para armar rutas.",
      });
      setOpen(false);
      setComentario("");
      router.refresh();
    } catch (err) {
      toast.error("No se pudieron aprobar los despachos", {
        description: mensajeDeError(err, "Intenta de nuevo"),
      });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) setComentario("");
      }}
    >
      <DialogTrigger asChild>
        <Button disabled={pendientes === 0}>
          <CheckCheckIcon />
          Aprobar todos ({pendientes})
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Aprobar los {pendientes} despachos pendientes</DialogTitle>
          <DialogDescription>
            Se aprueban todos de una vez y quedan listos para agregarse a una ruta. Queda registrado a tu
            nombre en el historial de cada uno. No se puede deshacer desde la aplicación.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="comentario-aprobacion-masiva">Comentario (opcional)</Label>
          <Textarea
            id="comentario-aprobacion-masiva"
            value={comentario}
            onChange={(e) => setComentario(e.target.value)}
            placeholder="Ej: aprobación en bloque de la carga del día"
          />
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancelar</Button>
          </DialogClose>
          <Button disabled={enviando} onClick={aprobarTodos}>
            {enviando ? "Aprobando..." : `Aprobar los ${pendientes}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
