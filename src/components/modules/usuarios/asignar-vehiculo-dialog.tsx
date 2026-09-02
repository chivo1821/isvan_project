"use client";

import { useState } from "react";
import { TruckIcon } from "lucide-react";
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
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TIPO_VEHICULO_META } from "@/lib/constants";
import type { Usuario, Vehiculo } from "@/lib/mock-data";

const SIN_VEHICULO = "__ninguno__";

/** Asigna el vehículo que maneja un repartidor. No es un dato cosmético: es
 * lo que define la única ruta que ese usuario puede ver. */
export function AsignarVehiculoDialog({
  usuario,
  vehiculos,
  onAsignado,
}: {
  usuario: Usuario;
  vehiculos: Vehiculo[];
  onAsignado: (usuario: Usuario) => void;
}) {
  const [open, setOpen] = useState(false);
  const [vehiculoId, setVehiculoId] = useState(usuario.vehiculoAsignadoId ?? SIN_VEHICULO);
  const [guardando, setGuardando] = useState(false);

  async function guardar() {
    setGuardando(true);
    try {
      const actualizado = await apiPatch<Usuario>(`/usuarios/${usuario.id}/vehiculo`, {
        vehiculoAsignadoId: vehiculoId === SIN_VEHICULO ? null : vehiculoId,
      });
      onAsignado(actualizado);
      toast.success(
        actualizado.vehiculoAsignadoId
          ? `Vehículo asignado a ${usuario.nombre}`
          : `${usuario.nombre} quedó sin vehículo asignado`
      );
      setOpen(false);
    } catch (err) {
      toast.error("No se pudo asignar el vehículo", {
        description: mensajeDeError(err, "Intenta de nuevo"),
      });
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) setVehiculoId(usuario.vehiculoAsignadoId ?? SIN_VEHICULO);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <TruckIcon />
          Vehículo
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Vehículo de {usuario.nombre}</DialogTitle>
          <DialogDescription>
            El repartidor solo verá la ruta activa de este vehículo — ninguna otra ruta, ni los clientes,
            ni la cola de despachos.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor="vehiculo-asignado">Vehículo</Label>
          <Select value={vehiculoId} onValueChange={setVehiculoId}>
            <SelectTrigger id="vehiculo-asignado" className="w-full">
              <SelectValue placeholder="Sin vehículo asignado" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={SIN_VEHICULO}>Sin vehículo asignado</SelectItem>
              {vehiculos.map((v) => (
                <SelectItem key={v.id} value={v.id}>
                  {v.placa} — {TIPO_VEHICULO_META[v.tipo].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {vehiculoId === SIN_VEHICULO && (
            <p className="text-xs text-muted-foreground">
              Sin vehículo asignado no verá ninguna ruta al entrar.
            </p>
          )}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancelar</Button>
          </DialogClose>
          <Button onClick={guardar} disabled={guardando}>
            {guardando ? "Guardando..." : "Guardar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
