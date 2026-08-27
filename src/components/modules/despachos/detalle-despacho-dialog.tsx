"use client";

import Link from "next/link";
import { AprobacionDespachoActions } from "@/components/modules/despachos/aprobacion-actions";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/constants";
import type { DespachoConDetalle } from "@/lib/mock-data";

export function DetalleDespachoDialog({
  despacho,
  usuarioId,
}: {
  despacho: DespachoConDetalle;
  usuarioId: string;
}) {
  const pesoTotal = despacho.items.reduce((sum, item) => sum + item.cantidad * item.pesoUnitarioKg, 0);

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button type="button" className="font-medium text-foreground hover:underline">
          {despacho.numero}
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{despacho.numero}</DialogTitle>
          <DialogDescription>
            Creado el {formatDate(despacho.fechaCreacion)} por {despacho.creadoPor.nombre}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
          <div>
            <p className="font-medium text-foreground">Origen</p>
            <p className="text-muted-foreground">{despacho.origen.nombre}</p>
            <p className="text-muted-foreground">
              {despacho.origen.direccion}, {despacho.origen.ciudad}
            </p>
          </div>
          <div>
            <p className="font-medium text-foreground">Destino</p>
            <p className="text-muted-foreground">
              {despacho.destinoCliente.nombre}{" "}
              <span className="text-xs">
                ({despacho.destinoCliente.empresa} · {despacho.destinoCliente.codigo})
              </span>
            </p>
            <p className="text-muted-foreground">
              {despacho.destinoCliente.direccion}, {despacho.destinoCliente.ciudad}
            </p>
            {despacho.destinoCliente.telefono && (
              <p className="text-muted-foreground">{despacho.destinoCliente.telefono}</p>
            )}
          </div>
        </div>

        <div className="max-h-64 overflow-y-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Ítem</TableHead>
                <TableHead className="text-right">Cantidad</TableHead>
                <TableHead className="text-right">Peso</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {despacho.items.map((item) => (
                <TableRow key={item.id} className="hover:bg-transparent">
                  <TableCell>
                    {item.descripcion}
                    {item.requiereFrio && <span className="ml-1.5 text-xs text-info">· frío</span>}
                  </TableCell>
                  <TableCell className="text-right">{item.cantidad}</TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {(item.cantidad * item.pesoUnitarioKg).toLocaleString("es-VE", { maximumFractionDigits: 2 })} kg
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <p className="-mt-2 text-right text-xs text-muted-foreground">
          Peso total: {pesoTotal.toLocaleString("es-VE", { maximumFractionDigits: 2 })} kg
        </p>

        <DialogFooter className="items-center gap-3 sm:justify-between">
          <Link href={`/despachos/aprobacion/${despacho.id}`} className="text-xs text-muted-foreground hover:underline">
            Ver página completa →
          </Link>
          <AprobacionDespachoActions
            despachoId={despacho.id}
            despachoNumero={despacho.numero}
            destinoNombre={despacho.destinoCliente.nombre}
            usuarioId={usuarioId}
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
