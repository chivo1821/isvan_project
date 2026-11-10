"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Undo2Icon } from "lucide-react";
import { toast } from "sonner";
import { apiPost, mensajeDeError } from "@/lib/api-client";
import { StatusBadge } from "@/components/shared/status-badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime, formatNumero, formatUsd } from "@/lib/constants";
import { formatFecha } from "@/lib/indicadores";
import type { CargaGasto } from "@/lib/gastos";

export function CargasGastos({ cargas }: { cargas: CargaGasto[] }) {
  const router = useRouter();
  const [procesando, setProcesando] = useState<string | null>(null);

  async function revertir(carga: CargaGasto) {
    setProcesando(carga.id);
    try {
      await apiPost(`/gastos/cargas/${carga.id}/revertir`);
      toast.success("Carga revertida", { description: "Sus gastos ya no cuentan en el resultado." });
      router.refresh();
    } catch (err) {
      toast.error("No se pudo revertir la carga", { description: mensajeDeError(err, "Intenta de nuevo") });
    } finally {
      setProcesando(null);
    }
  }

  if (cargas.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
        Todavía no hay cargas de gastos.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Archivo</TableHead>
            <TableHead>Empresa</TableHead>
            <TableHead>Período</TableHead>
            <TableHead className="text-right">Gastos</TableHead>
            <TableHead className="text-right">Total</TableHead>
            <TableHead>Estado</TableHead>
            <TableHead>Subida</TableHead>
            <TableHead className="text-right">Acciones</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {cargas.map((c) => (
            <TableRow key={c.id}>
              <TableCell className="max-w-64">
                <span className="block truncate font-medium" title={c.archivo}>
                  {c.archivo}
                </span>
              </TableCell>
              <TableCell>{c.empresa}</TableCell>
              <TableCell className="whitespace-nowrap text-muted-foreground">
                {formatFecha(c.periodoDesde)} – {formatFecha(c.periodoHasta)}
              </TableCell>
              <TableCell className="text-right tabular-nums">{formatNumero(c.filas)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatUsd(c.totalUsd, 2)}</TableCell>
              <TableCell>
                <StatusBadge
                  label={c.estado === "CONFIRMADA" ? "Confirmada" : "Revertida"}
                  tone={c.estado === "CONFIRMADA" ? "success" : "neutral"}
                />
              </TableCell>
              <TableCell className="whitespace-nowrap text-muted-foreground">
                {formatDateTime(c.subidaEn)}
                {c.subidaPor && <span className="block text-xs">por {c.subidaPor}</span>}
              </TableCell>
              <TableCell className="text-right">
                {c.estado === "CONFIRMADA" && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="sm" disabled={procesando === c.id}>
                        <Undo2Icon />
                        Revertir
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>¿Revertir esta carga?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Sus {formatNumero(c.filas)} gastos ({formatUsd(c.totalUsd, 2)}) dejan de contar en el
                          resultado. La carga queda en el historial como revertida; para corregirla, sube el archivo
                          otra vez.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction variant="destructive" onClick={() => revertir(c)}>
                          Revertir
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
