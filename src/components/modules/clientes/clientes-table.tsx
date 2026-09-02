"use client";

import { useState } from "react";
import { AlertTriangleIcon } from "lucide-react";
import { ImportarClientesDialog } from "@/components/modules/clientes/importar-clientes-dialog";
import { NuevoClienteDialog } from "@/components/modules/clientes/nuevo-cliente-dialog";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Cliente } from "@/lib/mock-data";
import { motivoSinUbicacion } from "@/lib/ubicacion";

export function ClientesTable({ clientes, puedeCrear }: { clientes: Cliente[]; puedeCrear: boolean }) {
  const [lista, setLista] = useState<Cliente[]>(clientes);
  const sinUbicar = lista.filter((c) => motivoSinUbicacion(c) !== null).length;

  return (
    <div className="space-y-4">
      {puedeCrear && (
        <div className="flex justify-end gap-2">
          <ImportarClientesDialog onImportados={(nuevos) => setLista((prev) => [...nuevos, ...prev])} />
          <NuevoClienteDialog onAdd={(cliente) => setLista((prev) => [cliente, ...prev])} />
        </div>
      )}
      {sinUbicar > 0 && (
        <p className="flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm text-muted-foreground">
          <AlertTriangleIcon className="size-4 shrink-0 text-warning" />
          {sinUbicar} cliente(s) sin ubicación válida — les faltan las coordenadas o están en 0,0. No se
          pueden incluir en rutas hasta corregirlas.
        </p>
      )}
      <Card>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Empresa</TableHead>
                <TableHead>Código</TableHead>
                <TableHead>Nombre</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Ciudad</TableHead>
                <TableHead>Ruta comercial</TableHead>
                <TableHead>Teléfono</TableHead>
                <TableHead>Coordenadas</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lista.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <StatusBadge tone={c.empresa === "ISVAN" ? "info" : "primary"} label={c.empresa} />
                  </TableCell>
                  <TableCell className="font-medium">{c.codigo}</TableCell>
                  <TableCell>{c.nombre}</TableCell>
                  <TableCell className="text-muted-foreground">{c.tipo}</TableCell>
                  <TableCell className="text-muted-foreground">{c.ciudad}</TableCell>
                  <TableCell>
                    {c.rutaComercial ? (
                      <StatusBadge tone="neutral" label={c.rutaComercial} />
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{c.telefono}</TableCell>
                  <TableCell>
                    {motivoSinUbicacion(c) ? (
                      <StatusBadge tone="warning" label={motivoSinUbicacion(c)!} />
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {c.lat!.toFixed(4)}, {c.lng!.toFixed(4)}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
