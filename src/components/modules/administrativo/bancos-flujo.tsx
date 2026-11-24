"use client";

import { useEffect, useState } from "react";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CalendarIcon,
  DownloadIcon,
  FileSpreadsheetIcon,
  Loader2Icon,
  RefreshCwIcon,
  TrendingDownIcon,
  TrendingUpIcon,
} from "lucide-react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { API_URL, apiGet, mensajeDeError } from "@/lib/api-client";
import { formatDate, formatNumero, formatUsd } from "@/lib/constants";
import type { FlujoCajaReporte } from "@/lib/administrativo";
import { CATEGORIAS_MOVIMIENTO } from "./bancos-movimientos";

export function BancosFlujo({ empresaId }: { empresaId: string }) {
  const hoy = new Date();
  const primerDiaMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString().slice(0, 10);
  const ultimoDiaMes = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).toISOString().slice(0, 10);

  const [desde, setDesde] = useState(primerDiaMes);
  const [hasta, setHasta] = useState(ultimoDiaMes);
  const [agrupacion, setAgrupacion] = useState<"dia" | "semana" | "mes">("dia");

  const [cargando, setCargando] = useState(false);
  const [descargando, setDescargando] = useState(false);
  const [reporte, setReporte] = useState<FlujoCajaReporte | null>(null);

  async function cargarReporte() {
    setCargando(true);
    try {
      const data = await apiGet<FlujoCajaReporte>(
        `/bancos/flujo-caja?empresaId=${empresaId}&desde=${desde}&hasta=${hasta}&agrupacion=${agrupacion}`
      );
      setReporte(data);
    } catch (err) {
      toast.error("No se pudo cargar el reporte de flujo de caja", {
        description: mensajeDeError(err, "Verifica las fechas seleccionadas"),
      });
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => {
    let activo = true;
    apiGet<FlujoCajaReporte>(
      `/bancos/flujo-caja?empresaId=${empresaId}&desde=${desde}&hasta=${hasta}&agrupacion=${agrupacion}`
    )
      .then((data) => {
        if (activo) setReporte(data);
      })
      .catch((err) => {
        if (activo) {
          toast.error("No se pudo cargar el reporte de flujo de caja", {
            description: mensajeDeError(err, "Verifica las fechas seleccionadas"),
          });
        }
      });
    return () => {
      activo = false;
    };
  }, [empresaId, desde, hasta, agrupacion]);

  async function descargarExcel() {
    setDescargando(true);
    try {
      const url = `${API_URL}/bancos/flujo-caja?empresaId=${empresaId}&desde=${desde}&hasta=${hasta}&agrupacion=${agrupacion}&formato=xlsx`;
      const res = await fetch(url, {
        credentials: "include",
      });

      if (!res.ok) throw new Error("Error al descargar el archivo de flujo de caja");

      const blob = await res.blob();
      const enlace = document.createElement("a");
      enlace.href = URL.createObjectURL(blob);
      enlace.download = `flujo_caja_${desde}_${hasta}.xlsx`;
      document.body.appendChild(enlace);
      enlace.click();
      document.body.removeChild(enlace);
      toast.success("Flujo de caja exportado en Excel correctamente");
    } catch (err) {
      toast.error("No se pudo exportar el archivo", {
        description: mensajeDeError(err, "Intenta de nuevo"),
      });
    } finally {
      setDescargando(false);
    }
  }

  function setRangoPreset(tipo: "mes_actual" | "mes_anterior" | "trimestre" | "ano") {
    const d = new Date();
    if (tipo === "mes_actual") {
      setDesde(new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10));
      setHasta(new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10));
      setAgrupacion("dia");
    } else if (tipo === "mes_anterior") {
      setDesde(new Date(d.getFullYear(), d.getMonth() - 1, 1).toISOString().slice(0, 10));
      setHasta(new Date(d.getFullYear(), d.getMonth(), 0).toISOString().slice(0, 10));
      setAgrupacion("dia");
    } else if (tipo === "trimestre") {
      const noventaDiasAtras = new Date(d.getTime() - 90 * 24 * 3600 * 1000);
      setDesde(noventaDiasAtras.toISOString().slice(0, 10));
      setHasta(d.toISOString().slice(0, 10));
      setAgrupacion("semana");
    } else if (tipo === "ano") {
      setDesde(new Date(d.getFullYear(), 0, 1).toISOString().slice(0, 10));
      setHasta(new Date(d.getFullYear(), 11, 31).toISOString().slice(0, 10));
      setAgrupacion("mes");
    }
  }

  return (
    <div className="space-y-4">
      {/* Barra de control y filtros */}
      <Card>
        <CardContent className="p-3 sm:p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground">Rango rápido:</span>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => setRangoPreset("mes_actual")}
              >
                Mes actual
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => setRangoPreset("mes_anterior")}
              >
                Mes anterior
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => setRangoPreset("trimestre")}
              >
                Últimos 90 días
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => setRangoPreset("ano")}
              >
                Año actual
              </Button>
            </div>

            <div className="flex items-center gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">Agrupar por:</span>
              <div className="inline-flex rounded-md border p-0.5 bg-muted/40">
                <button
                  type="button"
                  onClick={() => setAgrupacion("dia")}
                  className={`px-2.5 py-1 text-xs rounded-sm font-medium transition-colors ${
                    agrupacion === "dia"
                      ? "bg-background shadow-xs text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Día
                </button>
                <button
                  type="button"
                  onClick={() => setAgrupacion("semana")}
                  className={`px-2.5 py-1 text-xs rounded-sm font-medium transition-colors ${
                    agrupacion === "semana"
                      ? "bg-background shadow-xs text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Semana
                </button>
                <button
                  type="button"
                  onClick={() => setAgrupacion("mes")}
                  className={`px-2.5 py-1 text-xs rounded-sm font-medium transition-colors ${
                    agrupacion === "mes"
                      ? "bg-background shadow-xs text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Mes
                </button>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground">Desde:</span>
                <Input
                  type="date"
                  className="h-8 w-34 text-xs"
                  value={desde}
                  onChange={(e) => setDesde(e.target.value)}
                />
              </div>

              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground">Hasta:</span>
                <Input
                  type="date"
                  className="h-8 w-34 text-xs"
                  value={hasta}
                  onChange={(e) => setHasta(e.target.value)}
                />
              </div>

              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs gap-1"
                onClick={cargarReporte}
                disabled={cargando}
              >
                <RefreshCwIcon className={`size-3.5 ${cargando ? "animate-spin" : ""}`} />
                Actualizar
              </Button>
            </div>

            <Button
              onClick={descargarExcel}
              disabled={descargando || cargando}
              variant="outline"
              size="sm"
              className="h-8 text-xs gap-1.5 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 hover:bg-emerald-50 dark:hover:bg-emerald-950/30"
            >
              {descargando ? (
                <Loader2Icon className="size-3.5 animate-spin" />
              ) : (
                <FileSpreadsheetIcon className="size-3.5" />
              )}
              Descargar .xlsx
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Tarjetas resumen del flujo del período */}
      {reporte && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Card className="p-3">
            <div className="text-[11px] font-medium text-muted-foreground uppercase">
              Saldo Inicial
            </div>
            <div className="text-lg font-bold tabular-nums">
              {formatUsd(reporte.saldoInicialUsd, 2)}
            </div>
            <div className="text-[10px] text-muted-foreground">Al inicio del período</div>
          </Card>

          <Card className="p-3 border-emerald-500/30 bg-emerald-50/20 dark:bg-emerald-950/10">
            <div className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400 uppercase flex items-center gap-1">
              <ArrowDownIcon className="size-3" />
              Total Ingresos
            </div>
            <div className="text-lg font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
              +{formatUsd(reporte.totalIngresosUsd, 2)}
            </div>
            <div className="text-[10px] text-muted-foreground">Entradas consolidadas</div>
          </Card>

          <Card className="p-3 border-rose-500/30 bg-rose-50/20 dark:bg-rose-950/10">
            <div className="text-[11px] font-medium text-rose-600 dark:text-rose-400 uppercase flex items-center gap-1">
              <ArrowUpIcon className="size-3" />
              Total Egresos
            </div>
            <div className="text-lg font-bold tabular-nums text-rose-600 dark:text-rose-400">
              -{formatUsd(reporte.totalEgresosUsd, 2)}
            </div>
            <div className="text-[10px] text-muted-foreground">Salidas consolidadas</div>
          </Card>

          <Card className="p-3">
            <div className="text-[11px] font-medium text-muted-foreground uppercase flex items-center gap-1">
              {reporte.flujoNetoUsd >= 0 ? (
                <TrendingUpIcon className="size-3 text-emerald-600" />
              ) : (
                <TrendingDownIcon className="size-3 text-rose-600" />
              )}
              Flujo Neto
            </div>
            <div
              className={`text-lg font-bold tabular-nums ${
                reporte.flujoNetoUsd >= 0
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-rose-600 dark:text-rose-400"
              }`}
            >
              {reporte.flujoNetoUsd >= 0 ? "+" : ""}
              {formatUsd(reporte.flujoNetoUsd, 2)}
            </div>
            <div className="text-[10px] text-muted-foreground">Ingresos menos egresos</div>
          </Card>

          <Card className="p-3 col-span-2 md:col-span-1 bg-primary/5 border-primary/30">
            <div className="text-[11px] font-medium text-primary uppercase">Saldo Final</div>
            <div className="text-lg font-bold tabular-nums text-foreground">
              {formatUsd(reporte.saldoFinalUsd, 2)}
            </div>
            <div className="text-[10px] text-muted-foreground">Al cierre del período</div>
          </Card>
        </div>
      )}

      {/* Gráfico de Flujo de Caja */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex flex-wrap items-center justify-between gap-2">
            <span>Evolución de Ingresos, Egresos y Saldo Acumulado (USD)</span>
            <span className="text-xs font-normal text-muted-foreground">
              {agrupacion === "dia"
                ? "Por día"
                : agrupacion === "semana"
                ? "Por semana"
                : "Por mes"}
            </span>
          </CardTitle>
          <CardDescription className="text-xs">
            Comportamiento de la liquidez durante el período seleccionado.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-2">
          {cargando ? (
            <div className="flex h-72 items-center justify-center">
              <Loader2Icon className="size-8 animate-spin text-muted-foreground" />
            </div>
          ) : !reporte || reporte.series.length === 0 ? (
            <div className="flex h-72 items-center justify-center text-xs text-muted-foreground">
              No hay movimientos registrados en las fechas seleccionadas para graficar.
            </div>
          ) : (
            <div className="w-full h-80">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={reporte.series}
                  margin={{ top: 10, right: 10, left: -10, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis
                    dataKey="periodo"
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                    axisLine={{ opacity: 0.3 }}
                  />
                  <YAxis
                    yAxisId="flujo"
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                    axisLine={{ opacity: 0.3 }}
                    tickFormatter={(v) => `$${v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}`}
                  />
                  <YAxis
                    yAxisId="saldo"
                    orientation="right"
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                    axisLine={{ opacity: 0.3 }}
                    tickFormatter={(v) => `$${v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}`}
                  />
                  <Tooltip
                    content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null;
                      return (
                        <div className="rounded-lg border bg-popover p-2.5 shadow-md text-xs space-y-1">
                          <div className="font-semibold text-foreground">{label}</div>
                          {payload.map((p) => (
                            <div
                              key={p.name}
                              className="flex items-center justify-between gap-3 text-muted-foreground"
                            >
                              <span className="flex items-center gap-1.5">
                                <span
                                  className="size-2 rounded-full"
                                  style={{ backgroundColor: p.color }}
                                />
                                {p.name}:
                              </span>
                              <span className="font-mono font-medium text-foreground">
                                {formatUsd(p.value as number, 2)}
                              </span>
                            </div>
                          ))}
                        </div>
                      );
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
                  <Bar
                    yAxisId="flujo"
                    dataKey="ingresosUsd"
                    name="Ingresos"
                    fill="#10b981"
                    radius={[4, 4, 0, 0]}
                  />
                  <Bar
                    yAxisId="flujo"
                    dataKey="egresosUsd"
                    name="Egresos"
                    fill="#f43f5e"
                    radius={[4, 4, 0, 0]}
                  />
                  <Line
                    yAxisId="saldo"
                    type="monotone"
                    dataKey="saldoAcumuladoUsd"
                    name="Saldo Acumulado"
                    stroke="#3b82f6"
                    strokeWidth={2.5}
                    dot={{ r: 3 }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Tabla desglosada por categoría */}
      {reporte && reporte.porCategoria && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">
              Desglose de Flujo de Caja por Categoría
            </CardTitle>
            <CardDescription className="text-xs">
              Resumen de orígenes y aplicaciones de fondos en el período.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-2">
            <div className="overflow-x-auto rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Categoría de Tesorería</TableHead>
                    <TableHead className="text-center w-28">Movimientos</TableHead>
                    <TableHead className="text-right">Ingresos (USD)</TableHead>
                    <TableHead className="text-right">Egresos (USD)</TableHead>
                    <TableHead className="text-right">Flujo Neto (USD)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reporte.porCategoria.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="py-6 text-center text-xs text-muted-foreground">
                        No hay movimientos categorizados en el período.
                      </TableCell>
                    </TableRow>
                  ) : (
                    reporte.porCategoria.map((cat) => {
                      const label =
                        CATEGORIAS_MOVIMIENTO.find((c) => c.id === cat.categoria)?.label ??
                        cat.categoria;
                      return (
                        <TableRow key={cat.categoria}>
                          <TableCell className="font-medium text-xs">{label}</TableCell>
                          <TableCell className="text-center tabular-nums text-xs text-muted-foreground">
                            {cat.movimientos}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                            {cat.ingresosUsd > 0 ? `+${formatUsd(cat.ingresosUsd, 2)}` : "—"}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-xs text-rose-600 dark:text-rose-400 font-medium">
                            {cat.egresosUsd > 0 ? `-${formatUsd(cat.egresosUsd, 2)}` : "—"}
                          </TableCell>
                          <TableCell
                            className={`text-right tabular-nums text-xs font-semibold ${
                              cat.netoUsd >= 0
                                ? "text-emerald-600 dark:text-emerald-400"
                                : "text-rose-600 dark:text-rose-400"
                            }`}
                          >
                            {cat.netoUsd >= 0 ? "+" : ""}
                            {formatUsd(cat.netoUsd, 2)}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
