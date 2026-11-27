"use client";

import { useEffect, useState } from "react";
import { DownloadIcon, FileSpreadsheetIcon, Loader2Icon, RefreshCwIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { API_URL, apiGet, mensajeDeError } from "@/lib/api-client";
import { formatBs, formatNumero, formatUsd } from "@/lib/constants";
import type { ReporteArt177 } from "@/lib/administrativo";

function mesActualYYYYMM(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${yyyy}-${mm}`;
}

export function LibroArt177({ empresaId }: { empresaId: string }) {
  const [mes, setMes] = useState<string>(mesActualYYYYMM());
  const [reporte, setReporte] = useState<ReporteArt177 | null>(null);
  const [cargando, setCargando] = useState(false);
  const [descargando, setDescargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function consultar(mesAconsultar: string = mes) {
    setCargando(true);
    setError(null);
    try {
      const data = await apiGet<ReporteArt177>(
        `/inventario/reportes/art-177?empresaId=${empresaId}&mes=${mesAconsultar}&formato=json`
      );
      setReporte(data);
    } catch (err) {
      const msg = mensajeDeError(err, "No se pudo obtener el reporte Art. 177");
      setError(msg);
      setReporte(null);
    } finally {
      setCargando(false);
    }
  }

  useEffect(() => {
    let activo = true;
    apiGet<ReporteArt177>(
      `/inventario/reportes/art-177?empresaId=${empresaId}&mes=${mes}&formato=json`
    )
      .then((data) => {
        if (activo) {
          setReporte(data);
          setError(null);
        }
      })
      .catch((err) => {
        if (activo) {
          setError(mensajeDeError(err, "No se pudo obtener el reporte Art. 177"));
          setReporte(null);
        }
      });
    return () => {
      activo = false;
    };
  }, [empresaId, mes]);

  async function descargarExcel() {
    setDescargando(true);
    try {
      const res = await fetch(
        `${API_URL}/inventario/reportes/art-177?empresaId=${empresaId}&mes=${mes}&formato=xlsx`,
        { credentials: "include" }
      );
      if (!res.ok) throw new Error("No se pudo descargar el archivo Excel");
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `libro_inventario_art177_${mes}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      toast.success("Libro Art. 177 descargado en formato Excel");
    } catch (err) {
      toast.error("Error al descargar el archivo", {
        description: mensajeDeError(err, "Verifica la conexión con el servidor"),
      });
    } finally {
      setDescargando(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Cabecera y controles de filtro */}
      <Card className="border-border">
        <CardHeader>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <span className="flex size-7 items-center justify-center rounded-md bg-purple-500/10 text-purple-600">
                <FileSpreadsheetIcon className="size-4" />
              </span>
              <div>
                <CardTitle className="text-base">Libro de Entradas y Salidas (Art. 177 RISLR)</CardTitle>
                <CardDescription className="text-xs">
                  Registro fiscal obligatorio SENIAT valorado a Costo Promedio Ponderado Móvil
                </CardDescription>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1.5">
                <Label htmlFor="mes-art177" className="text-xs text-muted-foreground">
                  Período:
                </Label>
                <Input
                  id="mes-art177"
                  type="month"
                  className="h-8 w-36 text-xs"
                  value={mes}
                  onChange={(e) => setMes(e.target.value)}
                />
              </div>

              <Button
                variant="outline"
                size="sm"
                onClick={() => consultar(mes)}
                disabled={cargando}
                className="h-8 gap-1 text-xs"
              >
                <RefreshCwIcon className={`size-3.5 ${cargando ? "animate-spin" : ""}`} />
                Consultar
              </Button>

              <Button
                size="sm"
                onClick={descargarExcel}
                disabled={descargando || cargando}
                className="h-8 gap-1 text-xs"
              >
                {descargando ? (
                  <Loader2Icon className="size-3.5 animate-spin" />
                ) : (
                  <DownloadIcon className="size-3.5" />
                )}
                Descargar .xlsx
              </Button>
            </div>
          </div>
        </CardHeader>

        {reporte && reporte.totales && (
          <CardContent className="pt-0">
            <div className="grid grid-cols-2 gap-2 rounded-lg bg-muted/40 p-3 text-xs sm:grid-cols-4">
              <div>
                <span className="text-muted-foreground block text-[11px]">Inventario Inicial</span>
                <span className="font-bold tabular-nums text-foreground">
                  {formatUsd(reporte.totales.invInicialUsd, 2)}
                </span>
                <span className="block text-[10px] text-muted-foreground">
                  {formatBs(reporte.totales.invInicialBs)}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground block text-[11px]">Total Entradas</span>
                <span className="font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                  +{formatUsd(reporte.totales.entradasUsd, 2)}
                </span>
                <span className="block text-[10px] text-muted-foreground">
                  +{formatBs(reporte.totales.entradasBs)}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground block text-[11px]">Ventas y Salidas</span>
                <span className="font-bold tabular-nums text-amber-600 dark:text-amber-400">
                  -{formatUsd(reporte.totales.salidasVentaUsd, 2)}
                </span>
                <span className="block text-[10px] text-muted-foreground">
                  -{formatBs(reporte.totales.salidasVentaBs)}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground block text-[11px]">Inventario Final</span>
                <span className="font-bold tabular-nums text-foreground">
                  {formatUsd(reporte.totales.invFinalUsd, 2)}
                </span>
                <span className="block text-[10px] text-muted-foreground">
                  {formatBs(reporte.totales.invFinalBs)}
                </span>
              </div>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Estados y tabla */}
      {cargando ? (
        <div className="flex h-48 items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2Icon className="size-5 animate-spin text-primary" />
          Generando libro de inventario según Art. 177...
        </div>
      ) : error ? (
        <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
          <p className="font-semibold">Error al cargar el libro Art. 177</p>
          <p className="text-xs mt-1">{error}</p>
          <Button variant="outline" size="sm" onClick={() => consultar(mes)} className="mt-3 text-xs">
            Reintentar consulta
          </Button>
        </div>
      ) : !reporte || reporte.filas.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
          No hay movimientos de inventario registrados para el período {mes}.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 text-[11px]">
                <TableHead className="w-14">Cód.</TableHead>
                <TableHead className="min-w-[160px]">Producto</TableHead>
                <TableHead className="text-right">Inv. Inicial</TableHead>
                <TableHead className="text-right">Entradas</TableHead>
                <TableHead className="text-right">Salidas Venta</TableHead>
                <TableHead className="text-right">Retiros / Autoconsumo</TableHead>
                <TableHead className="text-right">Ajustes</TableHead>
                <TableHead className="text-right">Inv. Final (Cajas)</TableHead>
                <TableHead className="text-right">CPP Final (USD)</TableHead>
                <TableHead className="text-right">Inv. Final (USD)</TableHead>
                <TableHead className="text-right">Inv. Final (Bs)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="text-xs">
              {reporte.filas.map((f) => (
                <TableRow key={f.productoId} className="hover:bg-muted/20">
                  <TableCell className="font-mono text-muted-foreground tabular-nums">{f.codigo}</TableCell>
                  <TableCell className="font-medium text-foreground">
                    {f.nombre}
                    <span className="block text-[10px] text-muted-foreground">{f.grupo ?? "sin grupo"}</span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    <span>{formatNumero(f.invInicialCajas, 1)}</span>
                    <span className="block text-[10px] text-muted-foreground">{formatUsd(f.invInicialUsd, 1)}</span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-emerald-600 dark:text-emerald-400">
                    <span>+{formatNumero(f.entradasCajas, 1)}</span>
                    <span className="block text-[10px] text-muted-foreground">{formatUsd(f.entradasUsd, 1)}</span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-amber-600 dark:text-amber-400">
                    <span>-{formatNumero(f.salidasVentaCajas, 1)}</span>
                    <span className="block text-[10px] text-muted-foreground">{formatUsd(f.salidasVentaUsd, 1)}</span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    <span>{f.retirosAutoconsumoCajas > 0 ? `-${formatNumero(f.retirosAutoconsumoCajas, 1)}` : "—"}</span>
                    {f.retirosAutoconsumoUsd > 0 && (
                      <span className="block text-[10px] text-muted-foreground">
                        {formatUsd(f.retirosAutoconsumoUsd, 1)}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    <span>{f.ajustesCajas !== 0 ? formatNumero(f.ajustesCajas, 1) : "—"}</span>
                  </TableCell>
                  <TableCell className="text-right font-bold tabular-nums text-foreground">
                    {formatNumero(f.invFinalCajas, 2)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatUsd(f.costoPromedioFinalUsd, 2)}
                    <span className="block text-[10px] text-muted-foreground">{formatBs(f.costoPromedioFinalBs)}</span>
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular-nums text-foreground">
                    {formatUsd(f.invFinalUsd, 2)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {formatBs(f.invFinalBs)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
