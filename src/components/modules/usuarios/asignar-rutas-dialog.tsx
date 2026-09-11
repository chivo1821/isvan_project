"use client";

import { useState } from "react";
import { MapIcon } from "lucide-react";
import { toast } from "sonner";
import { apiGet, apiPut, mensajeDeError } from "@/lib/api-client";
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
import type { Empresa, Usuario } from "@/lib/mock-data";

type RutaVenta = { empresa: Empresa; ruta: string };

const clave = (r: RutaVenta) => `${r.empresa}|${r.ruta}`;

/** Rutas de venta de un vendedor (las del sistema de ventas: R1..R8, 10...).
 * Definen qué clientes visita y qué despachos ve (ver
 * backend/app/api/vendedor.py). */
export function AsignarRutasDialog({ usuario }: { usuario: Usuario }) {
  const [open, setOpen] = useState(false);
  const [disponibles, setDisponibles] = useState<RutaVenta[] | null>(null);
  const [elegidas, setElegidas] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  async function cargar() {
    setDisponibles(null);
    setError(null);
    try {
      const [todas, actuales] = await Promise.all([
        apiGet<RutaVenta[]>("/vendedor/rutas-disponibles"),
        apiGet<RutaVenta[]>(`/usuarios/${usuario.id}/rutas-venta`),
      ]);
      setDisponibles(todas);
      setElegidas(new Set(actuales.map(clave)));
    } catch (err) {
      setError(mensajeDeError(err, "No se pudieron cargar las rutas"));
    }
  }

  function alternar(r: RutaVenta) {
    setElegidas((prev) => {
      const next = new Set(prev);
      if (next.has(clave(r))) next.delete(clave(r));
      else next.add(clave(r));
      return next;
    });
  }

  async function guardar() {
    setGuardando(true);
    try {
      const rutas = (disponibles ?? []).filter((r) => elegidas.has(clave(r)));
      const res = await apiPut<RutaVenta[]>(`/usuarios/${usuario.id}/rutas-venta`, { rutas });
      toast.success(
        res.length > 0 ? `${usuario.nombre}: ${res.length} ruta(s) asignada(s)` : `${usuario.nombre} quedó sin rutas`,
        { description: res.map((r) => `${r.ruta} (${r.empresa})`).join(", ") || undefined }
      );
      setOpen(false);
    } catch (err) {
      toast.error("No se pudieron guardar las rutas", { description: mensajeDeError(err, "Intenta de nuevo") });
    } finally {
      setGuardando(false);
    }
  }

  const porEmpresa = new Map<Empresa, RutaVenta[]>();
  for (const r of disponibles ?? []) porEmpresa.set(r.empresa, [...(porEmpresa.get(r.empresa) ?? []), r]);

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) void cargar();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <MapIcon />
          Rutas
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rutas de venta de {usuario.nombre}</DialogTitle>
          <DialogDescription>
            Verá los despachos y los clientes de estas rutas. Son las rutas del sistema de ventas: salen de la
            carga de ventas del módulo de indicadores.
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : disponibles === null ? (
          <p className="text-sm text-muted-foreground">Cargando rutas...</p>
        ) : disponibles.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Todavía no hay ventas cargadas: sube el extracto en Indicadores de venta › Cargas para tener rutas.
          </p>
        ) : (
          <div className="space-y-4">
            {[...porEmpresa.entries()].map(([empresa, rutas]) => (
              <div key={empresa} className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">{empresa}</p>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {rutas.map((r) => (
                    <label
                      key={clave(r)}
                      className="flex cursor-pointer items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-sm"
                    >
                      <Checkbox checked={elegidas.has(clave(r))} onCheckedChange={() => alternar(r)} />
                      {r.ruta}
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={guardando}>
              Cancelar
            </Button>
          </DialogClose>
          <Button onClick={guardar} disabled={guardando || disponibles === null}>
            {guardando ? "Guardando..." : `Guardar (${elegidas.size})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}