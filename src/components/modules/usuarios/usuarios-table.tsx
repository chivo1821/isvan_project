"use client";

import { useState } from "react";
import { NuevoUsuarioDialog } from "@/components/modules/usuarios/nuevo-usuario-dialog";
import { StatusBadge } from "@/components/shared/status-badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ROL_USUARIO_META } from "@/lib/constants";
import type { Usuario } from "@/lib/mock-data";

function iniciales(nombre: string) {
  return nombre
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function UsuariosTable({ usuarios }: { usuarios: Usuario[] }) {
  const [lista, setLista] = useState<Usuario[]>(usuarios);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <NuevoUsuarioDialog onAdd={(usuario) => setLista((prev) => [usuario, ...prev])} />
      </div>
      <Card>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Usuario</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Rol</TableHead>
                <TableHead>Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lista.map((u) => (
                <TableRow key={u.id}>
                  <TableCell>
                    <div className="flex items-center gap-2.5">
                      <Avatar size="sm">
                        <AvatarFallback>{iniciales(u.nombre)}</AvatarFallback>
                      </Avatar>
                      <span className="font-medium text-foreground">{u.nombre}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{u.email}</TableCell>
                  <TableCell>
                    <StatusBadge {...ROL_USUARIO_META[u.rol]} />
                  </TableCell>
                  <TableCell>
                    {u.activo ? (
                      <StatusBadge tone="success" label="Activo" />
                    ) : (
                      <StatusBadge tone="neutral" label="Inactivo" />
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
