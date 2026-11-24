"use client";

import { useEffect, useState } from "react";
import { BookOpenIcon, Loader2Icon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiGet, mensajeDeError } from "@/lib/api-client";
import { formatBs, formatDateTime, formatNumero, formatUsd } from "@/lib/constants";
import type { KardexMovimiento } from "@/lib/administrativo";

function tonoTipo(tipo: string): "default" | "secondary" | "destructive" | "outline" {
  if (tipo.startsWith("ENTRADA") || tipo === "DEVOLUCION") return "default";
  if (tipo.startsWith("SALIDA") || tipo === "RETIRO" || tipo === "AUTOCONSUMO") return "secondary";
  if (tipo === "AJUSTE") return "outline";
  return "outline";
}

export function KardexDialog({
  productoId,
  codigo,
  nombre,
  unidadesPorCaja,
  costoPromedioActualUsd,
  ultimoCostoActualUsd,
  children,
}: {
  productoId: string;
  codigo: number;
  nombre: string;
  unidadesPorCaja?: number;
  costoPromedioActualUsd?: number | null;
  ultimoCostoActualUsd?: number | null;
  children?: React.ReactNode;
}) {
  const [abierto, setAbierto] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [movimientos, setMovimientos] = useState<KardexMovimiento[]>([]);
  const [error, setError] = useState<string | null>(null);

  function handleOpenChange(open: boolean) {
    setAbierto(open);
    if (!open) return;
    setCargando(true);
    setError(null);
    apiGet<KardexMovimiento[]>(`/inventario/kardex/${productoId}`)
      .then((data) => {
        setMovimientos(data);
      })
      .catch((err) => {
        setError(mensajeDeError(err, "No se pudo cargar el kárdex del producto"));
      })
      .finally(() => {
        setCargando(false);
      });
  }

  return (
    <Dialog open={abierto} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {children ?? (
          <Button variant="ghost" size="sm" className="h-8 gap-1.5 px-2 text-xs">
            <BookOpenIcon className="size-3.5" /> Kárdex
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl lg:max-w-5xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2 text-base sm:text-lg">
            <span>Kárdex Valorizado (Art. 177 SENIAT)</span>
            <Badge variant="outline" className="font-mono">
              #{codigo}
            </Badge>
          </DialogTitle>
          <DialogDescription className="text-sm font-medium text-foreground">
            {nombre}
            {unidadesPorCaja ? ` · ${unidadesPorCaja} und/caja` : ""}
          </DialogDescription>
        </DialogHeader>

        {/* Resumen de costos vigentes */}
        <div className="flex flex-wrap items-center gap-4 rounded-lg bg-muted/40 p-3 text-xs sm:text-sm">
          <div>
            <span className="text-muted-foreground">Promedio Vigente (CPP): </span>
            <span className="font-bold tabular-nums text-foreground">
              {formatUsd(costoPromedioActualUsd, 2)} / caja
            </span>
            {unidadesPorCaja && unidadesPorCaja > 1 && costoPromedioActualUsd != null && (
              <span className="ml-1 text-xs text-muted-foreground">
                ({formatUsd(costoPromedioActualUsd / unidadesPorCaja, 2)}/und)
              </span>
            )}
          </div>
          <div>
            <span className="text-muted-foreground">Último Costo: </span>
            <span className="font-bold tabular-nums text-foreground">
              {formatUsd(ultimoCostoActualUsd, 2)} / caja
            </span>
          </div>
        </div>

        {cargando ? (
          <div className="flex h-48 items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2Icon className="size-5 animate-spin text-primary" />
            Cargando movimientos valorados...
          </div>
        ) : error ? (
          <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
            {error}
          </div>
        ) : movimientos.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            Este producto aún no registra movimientos valorados en el inventario.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30 text-xs">
                  <TableHead className="whitespace-nowrap">Fecha</TableHead>
                  <TableHead>Operación</TableHead>
                  <TableHead>Referencia / Detalle</TableHead>
                  <TableHead className="text-right">Cajas</TableHead>
                  <TableHead className="text-right">Costo Unit. (USD)</TableHead>
                  <TableHead className="text-right">Total (USD)</TableHead>
                  <TableHead className="text-right">Saldo (Cajas)</TableHead>
                  <TableHead className="text-right">CPP Resultante</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="text-xs sm:text-sm">
                {movimientos.map((m) => {
                  const esEntrada = m.cajas > 0;
                  return (
                    <TableRow key={m.id} className="hover:bg-muted/20">
                      <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
                        {formatDateTime(m.fecha)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={tonoTipo(m.tipo)} className="text-[10px] font-medium tracking-tight">
                          {m.tipo.replace("_", " ")}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate">
                        <span className="font-medium text-foreground">{m.referencia || m.documento || "—"}</span>
                        {(m.proveedor || m.numeroFacturaCompra) && (
                          <span className="block text-[11px] text-muted-foreground truncate">
                            Prov: {m.proveedor ?? "—"} {m.numeroFacturaCompra ? `· Fact: ${m.numeroFacturaCompra}` : ""}
                          </span>
                        )}
                        {m.lote && (
                          <span className="block text-[11px] text-muted-foreground truncate">
                            Lote: {m.lote} {m.almacen ? `(${m.almacen})` : ""}
                          </span>
                        )}
                      </TableCell>
                      <TableCell
                        className={`text-right font-semibold tabular-nums ${
                          esEntrada ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"
                        }`}
                      >
                        {esEntrada ? `+${formatNumero(m.cajas, 2)}` : formatNumero(m.cajas, 2)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {m.costoUnitarioUsd != null ? formatUsd(m.costoUnitarioUsd, 2) : "—"}
                        {m.tasa && m.costoUnitarioBs != null && (
                          <span className="block text-[10px] text-muted-foreground" title={`Tasa: ${m.tasa}`}>
                            {formatBs(m.costoUnitarioBs)}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {m.valorTotalUsd != null ? formatUsd(m.valorTotalUsd, 2) : "—"}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {m.saldoCajasEmpresa != null ? formatNumero(m.saldoCajasEmpresa, 2) : "—"}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums text-foreground">
                        {m.costoPromedioResultanteUsd != null
                          ? formatUsd(m.costoPromedioResultanteUsd, 2)
                          : "—"}
                        {m.costoPromedioResultanteBs != null && (
                          <span className="block text-[10px] text-muted-foreground">
                            {formatBs(m.costoPromedioResultanteBs)}
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
