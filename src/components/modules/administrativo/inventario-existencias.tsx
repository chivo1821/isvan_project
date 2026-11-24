"use client";

import { useMemo, useState } from "react";
import { BookOpenIcon, Edit3Icon, LayersIcon, SearchIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatNumero, formatUsd } from "@/lib/constants";
import type { Existencia } from "@/lib/administrativo";
import { CostoPresupuestarioDialog } from "./inventario-costo-dialog";
import { KardexDialog } from "./inventario-kardex-dialog";

type Almacen = { id: string; nombre: string };

export function ExistenciasCostosTabla({
  existencias,
  almacenes,
}: {
  existencias: Existencia[];
  almacenes: Almacen[];
}) {
  const [buscar, setBuscar] = useState("");
  const [almacenFiltro, setAlmacenFiltro] = useState<string>("todos");

  const nombreAlmacen = useMemo(
    () => Object.fromEntries(almacenes.map((a) => [a.id, a.nombre])),
    [almacenes]
  );

  const filtradas = useMemo(() => {
    const t = buscar.trim().toLowerCase();
    return existencias.filter((e) => {
      if (almacenFiltro !== "todos" && e.almacenId !== almacenFiltro) return false;
      if (!t) return true;
      return `${e.codigo} ${e.nombre} ${e.grupo ?? ""}`.toLowerCase().includes(t);
    });
  }, [existencias, buscar, almacenFiltro]);

  return (
    <div className="space-y-4">
      {/* Controles de búsqueda y filtros */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:w-72">
          <SearchIcon className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Buscar por código, nombre o grupo..."
            value={buscar}
            onChange={(e) => setBuscar(e.target.value)}
            aria-label="Buscar producto"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {almacenes.length > 1 && (
            <select
              className="h-9 max-w-full rounded-md border border-input bg-transparent px-2.5 text-xs sm:text-sm"
              value={almacenFiltro}
              onChange={(e) => setAlmacenFiltro(e.target.value)}
              aria-label="Filtrar por almacén"
            >
              <option value="todos">Todos los almacenes</option>
              {almacenes.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.nombre}
                </option>
              ))}
            </select>
          )}
          <span className="text-xs text-muted-foreground">
            {filtradas.length} de {existencias.length} registros
          </span>
        </div>
      </div>

      {filtradas.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
          No se encontraron productos con existencias para el criterio de búsqueda.
        </div>
      ) : (
        <>
          {/* Vista móvil compacta (< sm / 640px) */}
          <div className="space-y-3 sm:hidden">
            {filtradas.map((e) => {
              const u = e.unidadesPorCaja || 1;
              return (
                <div
                  key={`${e.productoId}-${e.almacenId}`}
                  className="rounded-lg border border-border bg-card p-3 shadow-xs space-y-2.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className="font-semibold text-sm leading-tight text-foreground block">
                        {e.nombre}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        #{e.codigo} · {e.grupo ?? "Sin grupo"} · {nombreAlmacen[e.almacenId] ?? e.almacenId}
                      </span>
                    </div>
                    <Badge variant={e.disponible > 0 ? "secondary" : "destructive"} className="text-xs shrink-0">
                      {formatNumero(e.disponible, 2)} disp.
                    </Badge>
                  </div>

                  {/* Stock y reservas */}
                  <div className="grid grid-cols-3 gap-1 rounded bg-muted/30 p-2 text-center text-xs">
                    <div>
                      <span className="text-[10px] text-muted-foreground block">Total</span>
                      <span className="font-semibold tabular-nums">{formatNumero(e.cajas, 2)}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-muted-foreground block">Reservado</span>
                      <span className="text-muted-foreground tabular-nums">{formatNumero(e.reservado, 2)}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-muted-foreground block">Disponible</span>
                      <span className={`font-semibold tabular-nums ${e.disponible <= 0 ? "text-destructive" : ""}`}>
                        {formatNumero(e.disponible, 2)}
                      </span>
                    </div>
                  </div>

                  {/* 3 Costos por caja */}
                  <div className="rounded-md border border-border/60 bg-muted/10 p-2 text-xs space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Promedio (SENIAT):</span>
                      <span className="font-medium tabular-nums text-foreground">
                        {formatUsd(e.costoPromedioCajaUsd, 2)}
                        {u > 1 && e.costoPromedioCajaUsd != null && (
                          <span className="text-[10px] text-muted-foreground ml-1">
                            ({formatUsd(e.costoPromedioCajaUsd / u, 2)}/u)
                          </span>
                        )}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Último Costo:</span>
                      <span className="font-medium tabular-nums text-foreground">
                        {formatUsd(e.ultimoCostoCajaUsd, 2)}
                        {u > 1 && e.ultimoCostoCajaUsd != null && (
                          <span className="text-[10px] text-muted-foreground ml-1">
                            ({formatUsd(e.ultimoCostoCajaUsd / u, 2)}/u)
                          </span>
                        )}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Presupuestario:</span>
                      <span className="font-medium tabular-nums text-foreground">
                        {formatUsd(e.costoPresupuestarioCajaUsd, 2)}
                        {u > 1 && e.costoPresupuestarioCajaUsd != null && (
                          <span className="text-[10px] text-muted-foreground ml-1">
                            ({formatUsd(e.costoPresupuestarioCajaUsd / u, 2)}/u)
                          </span>
                        )}
                      </span>
                    </div>
                  </div>

                  {/* Lotes */}
                  {e.lotes.length > 0 && (
                    <div className="text-[11px] text-muted-foreground">
                      <span className="font-medium">Lotes: </span>
                      {e.lotes.map((l) => `${l.lote}${l.vencimiento ? ` (${formatDate(l.vencimiento)})` : ""}: ${formatNumero(l.cajas, 1)}`).join(" · ")}
                    </div>
                  )}

                  {/* Acciones */}
                  <div className="flex items-center justify-end gap-2 pt-1">
                    <KardexDialog
                      productoId={e.productoId}
                      codigo={e.codigo}
                      nombre={e.nombre}
                      unidadesPorCaja={e.unidadesPorCaja}
                      costoPromedioActualUsd={e.costoPromedioCajaUsd}
                      ultimoCostoActualUsd={e.ultimoCostoCajaUsd}
                    >
                      <Button variant="outline" size="sm" className="h-7 text-xs">
                        <BookOpenIcon className="mr-1 size-3" /> Kárdex
                      </Button>
                    </KardexDialog>
                    <CostoPresupuestarioDialog
                      productoId={e.productoId}
                      codigo={e.codigo}
                      nombre={e.nombre}
                      costoPromedioUsd={e.costoPromedioCajaUsd}
                      ultimoCostoUsd={e.ultimoCostoCajaUsd}
                      costoPresupuestarioActualUsd={e.costoPresupuestarioCajaUsd}
                      modoActual={e.modoPresupuestario}
                      porcentajeActual={e.porcentajePresupuestario}
                    >
                      <Button variant="outline" size="sm" className="h-7 text-xs">
                        <Edit3Icon className="mr-1 size-3" /> Presupuestario
                      </Button>
                    </CostoPresupuestarioDialog>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Vista escritorio (>= sm) */}
          <div className="hidden sm:block overflow-x-auto rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <TableHead className="w-56">Producto</TableHead>
                  <TableHead>Almacén</TableHead>
                  <TableHead className="text-right">Cajas</TableHead>
                  <TableHead className="text-right">Disponible</TableHead>
                  <TableHead className="text-right">Promedio SENIAT</TableHead>
                  <TableHead className="text-right">Último Costo</TableHead>
                  <TableHead className="text-right">Presupuestario</TableHead>
                  <TableHead className="max-w-[200px]">Lotes</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtradas.map((e) => {
                  const u = e.unidadesPorCaja || 1;
                  return (
                    <TableRow key={`${e.productoId}-${e.almacenId}`} className="hover:bg-muted/20">
                      <TableCell className="font-medium">
                        <span className="block text-foreground">{e.nombre}</span>
                        <span className="text-xs text-muted-foreground">
                          #{e.codigo} · {e.grupo ?? "Sin grupo"} · {u} und/caja
                        </span>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {nombreAlmacen[e.almacenId] ?? e.almacenId}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-medium">
                        {formatNumero(e.cajas, 2)}
                        {e.reservado > 0 && (
                          <span className="block text-[11px] text-muted-foreground">
                            {formatNumero(e.reservado, 2)} res.
                          </span>
                        )}
                      </TableCell>
                      <TableCell
                        className={`text-right font-bold tabular-nums ${
                          e.disponible <= 0 ? "text-destructive" : "text-foreground"
                        }`}
                      >
                        {formatNumero(e.disponible, 2)}
                      </TableCell>

                      {/* 1. Costo Promedio SENIAT */}
                      <TableCell className="text-right tabular-nums">
                        <span className="font-semibold text-foreground">
                          {formatUsd(e.costoPromedioCajaUsd, 2)}
                        </span>
                        {u > 1 && e.costoPromedioCajaUsd != null && (
                          <span className="block text-[11px] text-muted-foreground">
                            {formatUsd(e.costoPromedioCajaUsd / u, 2)}/und
                          </span>
                        )}
                      </TableCell>

                      {/* 2. Último Costo */}
                      <TableCell className="text-right tabular-nums">
                        <span className="font-semibold text-foreground">
                          {formatUsd(e.ultimoCostoCajaUsd, 2)}
                        </span>
                        {u > 1 && e.ultimoCostoCajaUsd != null && (
                          <span className="block text-[11px] text-muted-foreground">
                            {formatUsd(e.ultimoCostoCajaUsd / u, 2)}/und
                          </span>
                        )}
                      </TableCell>

                      {/* 3. Costo Presupuestario */}
                      <TableCell className="text-right tabular-nums">
                        <span className="font-semibold text-foreground">
                          {formatUsd(e.costoPresupuestarioCajaUsd, 2)}
                        </span>
                        {u > 1 && e.costoPresupuestarioCajaUsd != null && (
                          <span className="block text-[11px] text-muted-foreground">
                            {formatUsd(e.costoPresupuestarioCajaUsd / u, 2)}/und
                          </span>
                        )}
                      </TableCell>

                      {/* Lotes */}
                      <TableCell className="text-xs text-muted-foreground max-w-[200px]">
                        {e.lotes.length === 0 ? (
                          <span className="text-muted-foreground/60">—</span>
                        ) : (
                          <div className="truncate" title={e.lotes.map((l) => `${l.lote}: ${l.cajas}`).join(", ")}>
                            {e.lotes
                              .map(
                                (l) =>
                                  `${l.lote}${l.vencimiento ? ` (${formatDate(l.vencimiento)})` : ""}: ${formatNumero(l.cajas, 1)}`
                              )
                              .join(" · ")}
                          </div>
                        )}
                      </TableCell>

                      {/* Acciones */}
                      <TableCell className="text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1">
                          <KardexDialog
                            productoId={e.productoId}
                            codigo={e.codigo}
                            nombre={e.nombre}
                            unidadesPorCaja={e.unidadesPorCaja}
                            costoPromedioActualUsd={e.costoPromedioCajaUsd}
                            ultimoCostoActualUsd={e.ultimoCostoCajaUsd}
                          />
                          <CostoPresupuestarioDialog
                            productoId={e.productoId}
                            codigo={e.codigo}
                            nombre={e.nombre}
                            costoPromedioUsd={e.costoPromedioCajaUsd}
                            ultimoCostoUsd={e.ultimoCostoCajaUsd}
                            costoPresupuestarioActualUsd={e.costoPresupuestarioCajaUsd}
                            modoActual={e.modoPresupuestario}
                            porcentajeActual={e.porcentajePresupuestario}
                          />
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}
