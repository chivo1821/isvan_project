"use client";

import { useState } from "react";
import { AsignarRutasDialog } from "@/components/modules/usuarios/asignar-rutas-dialog";
import { AsignarVehiculoDialog } from "@/components/modules/usuarios/asignar-vehiculo-dialog";
import { PermisoExcepciones } from "@/components/modules/usuarios/permiso-excepciones";
import { NuevoUsuarioDialog } from "@/components/modules/usuarios/nuevo-usuario-dialog";
import { RestablecerPasswordDialog } from "@/components/modules/usuarios/restablecer-password-dialog";
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
import { ROL_USUARIO_META, TIPO_VEHICULO_META, formatTelefono } from "@/lib/constants";
import type { Usuario, Vehiculo } from "@/lib/mock-data";

function iniciales(nombre: string) {
  return nombre
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function UsuariosTable({
  usuarios,
  vehiculos,
  esAdmin,
}: {
  usuarios: Usuario[];
  vehiculos: Vehiculo[];
  esAdmin: boolean;
}) {
  const [lista, setLista] = useState<Usuario[]>(usuarios);
  const vehiculoPorId = new Map(vehiculos.map((v) => [v.id, v]));

  function reemplazar(usuario: Usuario) {
    setLista((prev) => prev.map((u) => (u.id === usuario.id ? usuario : u)));
  }

  return (
    <div className="space-y-4">
      {esAdmin && (
        <div className="flex justify-end">
          <NuevoUsuarioDialog
            vehiculos={vehiculos}
            onAdd={(usuario) => setLista((prev) => [usuario, ...prev])}
          />
        </div>
      )}
      <Card>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Usuario</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Rol</TableHead>
                <TableHead>Vehículo</TableHead>
                <TableHead>Estado</TableHead>
                {esAdmin && <TableHead className="w-10" />}
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
                  <TableCell className="text-muted-foreground">
                    {u.autogestionado ? (
                      <span>
                        {formatTelefono(u.telefono)}
                        <span className="ml-1.5 text-xs">(motorizado, entra con placa y PIN)</span>
                      </span>
                    ) : (
                      u.email
                    )}
                  </TableCell>
                  <TableCell>
                    <StatusBadge {...ROL_USUARIO_META[u.rol]} />
                    {/* Aprobar despachos de clientes con deuda vencida
                        (ver backend/app/services/cartera.py). */}
                    {(u.rol === "APROBADOR" || u.rol === "COBRANZAS") &&
                      (esAdmin ? (
                        <PermisoExcepciones usuario={u} onCambio={reemplazar} />
                      ) : (
                        u.autorizaExcepciones && <span className="mt-1 block text-xs text-muted-foreground">Autoriza excepciones</span>
                      ))}
                  </TableCell>
                  <TableCell>
                    {u.rol !== "REPARTIDOR" ? (
                      <span className="text-xs text-muted-foreground">—</span>
                    ) : u.vehiculoAsignadoId && vehiculoPorId.has(u.vehiculoAsignadoId) ? (
                      <span className="text-sm">
                        {vehiculoPorId.get(u.vehiculoAsignadoId)!.placa}
                        <span className="ml-1 text-xs text-muted-foreground">
                          {TIPO_VEHICULO_META[vehiculoPorId.get(u.vehiculoAsignadoId)!.tipo].label}
                        </span>
                      </span>
                    ) : (
                      <StatusBadge tone="warning" label="Sin vehículo" />
                    )}
                  </TableCell>
                  <TableCell>
                    {u.activo ? (
                      <StatusBadge tone="success" label="Activo" />
                    ) : (
                      <StatusBadge tone="neutral" label="Inactivo" />
                    )}
                  </TableCell>
                  {esAdmin && (
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        {/* Un motorizado anda en su moto y entra con PIN: se administra
                            en Vehículos › Choferes › Motorizados. */}
                        {u.rol === "REPARTIDOR" && !u.autogestionado && (
                          <AsignarVehiculoDialog usuario={u} vehiculos={vehiculos} onAsignado={reemplazar} />
                        )}
                        {u.rol === "VENDEDOR" && <AsignarRutasDialog usuario={u} />}
                        {!u.autogestionado && <RestablecerPasswordDialog usuarioId={u.id} usuarioNombre={u.nombre} />}
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
