"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileSearchIcon, Undo2Icon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { apiDelete, apiGet, apiPost, mensajeDeError } from "@/lib/api-client";
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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime, formatNumero, formatUsd, type Tone } from "@/lib/constants";
import {
  formatFecha,
  type CargaVenta,
  type EstadoCargaVenta,
  type ResumenValidacion as Resumen,
} from "@/lib/indicadores";
import { ResumenValidacion } from "./resumen-validacion";

const ESTADO_CARGA_META: Record<EstadoCargaVenta, { label: string; tone: Tone }> = {
  PENDIENTE: { label: "Pendiente", tone: "warning" },
  CONFIRMADA: { label: "Confirmada", tone: "success" },
  REVERTIDA: { label: "Revertida", tone: "neutral" },
};

/** La validación que se vio al subir el archivo, tal cual quedó guardada. */
function VerValidacion({ carga }: { carga: CargaVenta }) {
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function cargar() {
    if (resumen) return;
    try {
      const detalle = await apiGet<{ resumen: Resumen }>(`/indicadores/cargas/${carga.id}`);
      setResumen(detalle.resumen);
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo leer la validación"));
    }
  }

  return (
    <Dialog onOpenChange={(v) => v && void cargar()}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          <FileSearchIcon />
          Validación
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="truncate pr-6">{carga.archivo}</DialogTitle>
        </DialogHeader>
        {resumen ? (
          <ResumenValidacion resumen={resumen} />
        ) : (
          <p className="py-6 text-center text-sm text-muted-foreground">{error ?? "Cargando..."}</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function CargasHistorial({ cargas }: { cargas: CargaVenta[] }) {
  const router = useRouter();
  const [procesando, setProcesando] = useState<string | null>(null);

  async function revertir(carga: CargaVenta) {
    setProcesando(carga.id);
    try {
      const r = await apiPost<CargaVenta & { filasRestauradas: number }>(`/indicadores/cargas/${carga.id}/revertir`);
      toast.success("Carga revertida", {
        description:
          r.filasRestauradas > 0
            ? `Volvieron a contar ${formatNumero(r.filasRestauradas)} filas de cargas anteriores.`
            : undefined,
      });
      router.refresh();
    } catch (err) {
      toast.error("No se pudo revertir la carga", { description: mensajeDeError(err, "Intenta de nuevo") });
    } finally {
      setProcesando(null);
    }
  }

  async function descartar(carga: CargaVenta) {
    setProcesando(carga.id);
    try {
      await apiDelete(`/indicadores/cargas/${carga.id}`);
      toast.info("Carga descartada");
      router.refresh();
    } catch (err) {
      toast.error("No se pudo descartar la carga", { description: mensajeDeError(err, "Intenta de nuevo") });
    } finally {
      setProcesando(null);
    }
  }

  if (cargas.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
        Todavía no hay cargas de ventas para esta empresa.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Archivo</TableHead>
            <TableHead>Período</TableHead>
            <TableHead className="text-right">Filas</TableHead>
            <TableHead className="text-right">Venta neta</TableHead>
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
              <TableCell className="whitespace-nowrap text-muted-foreground">
                {formatFecha(c.periodoDesde)} – {formatFecha(c.periodoHasta)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {c.estado === "CONFIRMADA" && c.filasVigentes < c.filas ? (
                  <span title="Las demás las reemplazó una carga posterior que cubre las mismas fechas">
                    {formatNumero(c.filasVigentes)} de {formatNumero(c.filas)}
                  </span>
                ) : (
                  formatNumero(c.filas)
                )}
              </TableCell>
              <TableCell className="text-right tabular-nums">{formatUsd(c.ventaNeta)}</TableCell>
              <TableCell>
                <StatusBadge {...ESTADO_CARGA_META[c.estado]} />
              </TableCell>
              <TableCell className="whitespace-nowrap text-muted-foreground">
                {formatDateTime(c.subidaEn)}
                <span className="block text-xs">por {c.subidaPor}</span>
              </TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-1">
                  <VerValidacion carga={c} />
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
                            Sus {formatNumero(c.filas)} filas dejan de contar en los indicadores y vuelven a contar las
                            de cargas anteriores que había reemplazado. La carga queda en el historial como revertida.
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
                  {c.estado === "PENDIENTE" && (
                    <Button variant="ghost" size="sm" disabled={procesando === c.id} onClick={() => descartar(c)}>
                      <XIcon />
                      Descartar
                    </Button>
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
