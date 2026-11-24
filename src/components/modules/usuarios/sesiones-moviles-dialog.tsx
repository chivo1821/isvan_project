"use client";

import { useState } from "react";
import { SmartphoneIcon } from "lucide-react";
import { toast } from "sonner";
import { apiDelete, apiGet, mensajeDeError } from "@/lib/api-client";
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
import { formatDateTime } from "@/lib/constants";

type SesionMovil = {
  id: string;
  dispositivo: string | null;
  creadoEn: string;
  ultimoUsoEn: string | null;
  expiraEn: string;
};

/** La sesión de la app de campo dura 30 días y se renueva sola: si alguien
 * pierde el teléfono, desde aquí se cierra y la app vuelve a pedir la clave
 * (DELETE /usuarios/{id}/sesiones-moviles). */
export function SesionesMovilesDialog({ usuarioId, usuarioNombre }: { usuarioId: string; usuarioNombre: string }) {
  const [sesiones, setSesiones] = useState<SesionMovil[] | null>(null);
  const [cerrando, setCerrando] = useState(false);

  async function cargar() {
    setSesiones(null);
    try {
      setSesiones(await apiGet<SesionMovil[]>(`/usuarios/${usuarioId}/sesiones-moviles`));
    } catch (err) {
      toast.error("No se pudieron leer las sesiones", { description: mensajeDeError(err, "Intenta de nuevo") });
      setSesiones([]);
    }
  }

  async function cerrarTodas() {
    setCerrando(true);
    try {
      await apiDelete(`/usuarios/${usuarioId}/sesiones-moviles`);
      toast.success(`Sesión de la app cerrada para ${usuarioNombre}`, {
        description: "La próxima vez que abra la app le va a pedir sus datos de entrada.",
      });
      setSesiones([]);
    } catch (err) {
      toast.error("No se pudo cerrar la sesión", { description: mensajeDeError(err, "Intenta de nuevo") });
    } finally {
      setCerrando(false);
    }
  }

  return (
    <Dialog onOpenChange={(v) => v && void cargar()}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Sesiones de la app de ${usuarioNombre}`}>
          <SmartphoneIcon />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>App de {usuarioNombre}</DialogTitle>
          <DialogDescription>
            Los teléfonos donde tiene la app abierta. Si perdió uno, cierra la sesión: la app le vuelve a pedir
            sus datos de entrada.
          </DialogDescription>
        </DialogHeader>
        {sesiones == null ? (
          <p className="py-4 text-center text-sm text-muted-foreground">Cargando…</p>
        ) : sesiones.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">No tiene la app abierta en ningún teléfono.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {sesiones.map((s) => (
              <li key={s.id} className="rounded-lg border border-border p-3">
                <p className="font-medium text-foreground">{s.dispositivo ?? "Teléfono sin nombre"}</p>
                <p className="text-xs text-muted-foreground">
                  Entró el {formatDateTime(s.creadoEn)}
                  {s.ultimoUsoEn && ` · usada por última vez el ${formatDateTime(s.ultimoUsoEn)}`}
                </p>
              </li>
            ))}
          </ul>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cerrar</Button>
          </DialogClose>
          <Button variant="destructive" onClick={cerrarTodas} disabled={cerrando || !sesiones?.length}>
            {cerrando ? "Cerrando…" : "Cerrar sesión en el teléfono"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
