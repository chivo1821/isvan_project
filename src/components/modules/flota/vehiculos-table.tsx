"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { apiPatch } from "@/lib/api-client";
import { NuevoVehiculoDialog } from "@/components/modules/flota/nuevo-vehiculo-dialog";
import { StatusBadge } from "@/components/shared/status-badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ESTADO_VEHICULO_META, TIPO_VEHICULO_META } from "@/lib/constants";
import type { Almacen, Vehiculo } from "@/lib/mock-data";
import type { EstadoVehiculo } from "@prisma/client";

const ESTADOS: EstadoVehiculo[] = ["FUNCIONAL", "EN_MANTENIMIENTO", "FUERA_DE_SERVICIO"];

export function VehiculosTable({
  vehiculos,
  almacenes,
}: {
  vehiculos: Vehiculo[];
  almacenes: Almacen[];
}) {
  const [lista, setLista] = useState<Vehiculo[]>(vehiculos);
  const [estados, setEstados] = useState<Record<string, EstadoVehiculo>>(() =>
    Object.fromEntries(vehiculos.map((v) => [v.id, v.estado]))
  );
  const almacenBase = almacenes[0];

  async function cambiarEstado(vehiculo: Vehiculo, nuevoEstado: EstadoVehiculo) {
    const anterior = estados[vehiculo.id];
    setEstados((prev) => ({ ...prev, [vehiculo.id]: nuevoEstado }));
    try {
      await apiPatch(`/vehiculos/${vehiculo.id}/estado`, { estado: nuevoEstado });
      toast.info(`Vehículo ${vehiculo.placa} actualizado`, {
        description: `Nuevo estado: ${ESTADO_VEHICULO_META[nuevoEstado].label}.`,
      });
    } catch (err) {
      setEstados((prev) => ({ ...prev, [vehiculo.id]: anterior }));
      toast.error("No se pudo actualizar el estado", {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }

  function agregarVehiculo(vehiculo: Vehiculo) {
    setLista((prev) => [vehiculo, ...prev]);
    setEstados((prev) => ({ ...prev, [vehiculo.id]: vehiculo.estado }));
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <NuevoVehiculoDialog almacenBaseNombre={almacenBase?.nombre ?? ""} onAdd={agregarVehiculo} />
      </div>
      <div className="overflow-hidden rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Placa</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Capacidad</TableHead>
              <TableHead>Refrigeración</TableHead>
              <TableHead>Almacén base</TableHead>
              <TableHead>Conductor</TableHead>
              <TableHead>Estado</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lista.map((vehiculo) => {
              const almacen = almacenes.find((a) => a.id === vehiculo.almacenBaseId);
              const estado = estados[vehiculo.id];
              return (
                <TableRow key={vehiculo.id}>
                  <TableCell className="font-medium">
                    <Link href={`/flota/${vehiculo.id}`} className="hover:underline">
                      {vehiculo.placa}
                    </Link>
                  </TableCell>
                  <TableCell>{TIPO_VEHICULO_META[vehiculo.tipo].label}</TableCell>
                  <TableCell>{vehiculo.capacidadKg.toLocaleString("es-VE")} kg</TableCell>
                  <TableCell>
                    {vehiculo.tieneRefrigeracion ? (
                      <StatusBadge tone="info" label="Refrigerado" />
                    ) : (
                      <StatusBadge tone="neutral" label="Sin refrigeración" />
                    )}
                  </TableCell>
                  <TableCell>{almacen?.nombre ?? "—"}</TableCell>
                  <TableCell>{vehiculo.conductorNombre ?? "—"}</TableCell>
                  <TableCell>
                    <Select value={estado} onValueChange={(v) => cambiarEstado(vehiculo, v as EstadoVehiculo)}>
                      <SelectTrigger size="sm" className="w-44">
                        <SelectValue>
                          <StatusBadge {...ESTADO_VEHICULO_META[estado]} />
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {ESTADOS.map((e) => (
                          <SelectItem key={e} value={e}>
                            {ESTADO_VEHICULO_META[e].label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
