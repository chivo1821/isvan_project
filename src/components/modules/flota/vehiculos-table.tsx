"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
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
  // Vehiculos agregados en esta sesion no tienen pagina de detalle (no existen
  // en los datos mock del servidor), asi que no se muestran como enlace.
  const [nuevosIds, setNuevosIds] = useState<Set<string>>(new Set());

  function cambiarEstado(vehiculo: Vehiculo, nuevoEstado: EstadoVehiculo) {
    setEstados((prev) => ({ ...prev, [vehiculo.id]: nuevoEstado }));
    toast.info(`Vehículo ${vehiculo.placa} actualizado`, {
      description: `Nuevo estado: ${ESTADO_VEHICULO_META[nuevoEstado].label}. (Simulación: no se persiste todavía.)`,
    });
  }

  function agregarVehiculo(vehiculo: Vehiculo) {
    setLista((prev) => [vehiculo, ...prev]);
    setEstados((prev) => ({ ...prev, [vehiculo.id]: vehiculo.estado }));
    setNuevosIds((prev) => new Set(prev).add(vehiculo.id));
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <NuevoVehiculoDialog onAdd={agregarVehiculo} />
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
                    {nuevosIds.has(vehiculo.id) ? (
                      <span>{vehiculo.placa}</span>
                    ) : (
                      <Link href={`/flota/${vehiculo.id}`} className="hover:underline">
                        {vehiculo.placa}
                      </Link>
                    )}
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
