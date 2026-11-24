"use client";

import { useMemo } from "react";
import { BoxesIcon, DollarSignIcon, LandmarkIcon, TrendingUpIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { formatBs, formatNumero, formatUsd } from "@/lib/constants";
import type { Existencia } from "@/lib/administrativo";

export function InventarioKpis({ existencias }: { existencias: Existencia[] }) {
  const metricas = useMemo(() => {
    let valorPromedioUsd = 0;
    let valorPromedioBs = 0;
    let valorUltimoUsd = 0;
    let valorPresupuestarioUsd = 0;
    let totalCajas = 0;
    const productosConExistencia = new Set<string>();

    for (const e of existencias) {
      const cajas = e.cajas || 0;
      totalCajas += cajas;
      if (cajas > 0) {
        productosConExistencia.add(e.productoId);
      }

      // Usar totales si vienen precalculados por el backend o calcularlos de forma resiliente
      const valPromUsd = e.valorPromedioUsd ?? (cajas * (e.costoPromedioCajaUsd ?? 0));
      const valPromBs = e.valorPromedioBs ?? (cajas * (e.costoPromedioCajaBs ?? 0));
      const valUltUsd = e.valorUltimoUsd ?? (cajas * (e.ultimoCostoCajaUsd ?? 0));
      const valPresUsd = e.valorPresupuestarioUsd ?? (cajas * (e.costoPresupuestarioCajaUsd ?? 0));

      valorPromedioUsd += valPromUsd;
      valorPromedioBs += valPromBs;
      valorUltimoUsd += valUltUsd;
      valorPresupuestarioUsd += valPresUsd;
    }

    const productosTotal = new Set(existencias.map((e) => e.productoId)).size;

    return {
      valorPromedioUsd,
      valorPromedioBs,
      valorUltimoUsd,
      valorPresupuestarioUsd,
      totalCajas,
      productosConExistencia: productosConExistencia.size,
      productosTotal,
    };
  }, [existencias]);

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {/* 1. Costo Promedio (SENIAT) */}
      <Card className="border-border">
        <CardContent className="p-4 sm:p-5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-muted-foreground">Costo Promedio (SENIAT)</span>
            <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
              <LandmarkIcon className="size-4" />
            </span>
          </div>
          <p className="mt-2 text-xl font-bold tabular-nums text-foreground sm:text-2xl">
            {formatUsd(metricas.valorPromedioUsd, 2)}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground truncate" title={formatBs(metricas.valorPromedioBs)}>
            Fiscal: <span className="font-medium text-foreground/80">{formatBs(metricas.valorPromedioBs)}</span>
          </p>
        </CardContent>
      </Card>

      {/* 2. Último Costo (Reposición) */}
      <Card className="border-border">
        <CardContent className="p-4 sm:p-5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-muted-foreground">Último Costo (Reposición)</span>
            <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-blue-500/10 text-blue-500">
              <TrendingUpIcon className="size-4" />
            </span>
          </div>
          <p className="mt-2 text-xl font-bold tabular-nums text-foreground sm:text-2xl">
            {formatUsd(metricas.valorUltimoUsd, 2)}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Reposición según última compra valorada
          </p>
        </CardContent>
      </Card>

      {/* 3. Costo Presupuestario */}
      <Card className="border-border">
        <CardContent className="p-4 sm:p-5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-muted-foreground">Costo Presupuestario</span>
            <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-amber-500/10 text-amber-500">
              <DollarSignIcon className="size-4" />
            </span>
          </div>
          <p className="mt-2 text-xl font-bold tabular-nums text-foreground sm:text-2xl">
            {formatUsd(metricas.valorPresupuestarioUsd, 2)}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Base para metas y margen en listas
          </p>
        </CardContent>
      </Card>

      {/* 4. Total de Cajas y Productos */}
      <Card className="border-border">
        <CardContent className="p-4 sm:p-5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-muted-foreground">Existencia Total</span>
            <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-500">
              <BoxesIcon className="size-4" />
            </span>
          </div>
          <p className="mt-2 text-xl font-bold tabular-nums text-foreground sm:text-2xl">
            {formatNumero(metricas.totalCajas, 2)} <span className="text-sm font-normal text-muted-foreground">cajas</span>
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {metricas.productosConExistencia} producto(s) con stock · {metricas.productosTotal} en catálogo
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
