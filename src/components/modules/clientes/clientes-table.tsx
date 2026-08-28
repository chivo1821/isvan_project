"use client";

import { useState } from "react";
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

export function ClientesTable({ clientes, puedeCrear }: { clientes: Cliente[]; puedeCrear: boolean }) {
  const [lista, setLista] = useState<Cliente[]>(clientes);

  return (
    <div className="space-y-4">
      {puedeCrear && (
        <div className="flex justify-end gap-2">
          <ImportarClientesDialog onImportados={(nuevos) => setLista((prev) => [...nuevos, ...prev])} />
          <NuevoClienteDialog onAdd={(cliente) => setLista((prev) => [cliente, ...prev])} />
        </div>
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
                  <TableCell className="text-muted-foreground">{c.telefono}</TableCell>
                  <TableCell>
                    {c.lat != null && c.lng != null ? (
                      <span className="text-xs text-muted-foreground">
                        {c.lat.toFixed(4)}, {c.lng.toFixed(4)}
                      </span>
                    ) : (
                      <StatusBadge tone="warning" label="Sin coordenadas" />
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
