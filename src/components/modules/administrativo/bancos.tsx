"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangleIcon,
  ArrowDownLeftIcon,
  ArrowUpDownIcon,
  ArrowUpRightIcon,
  Building2Icon,
  CheckCircle2Icon,
  CoinsIcon,
  DollarSignIcon,
  FileSpreadsheetIcon,
  LandmarkIcon,
  ReceiptIcon,
  RefreshCwIcon,
  TrendingDownIcon,
  TrendingUpIcon,
  WalletIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiGet, mensajeDeError } from "@/lib/api-client";
import { formatBs, formatDate, formatNumero, formatUsd } from "@/lib/constants";
import type {
  CuentaTesoreria,
  EstadoTasa,
  MovimientoBancario,
  ResumenBancos,
} from "@/lib/administrativo";
import { BancosCuentas } from "./bancos-cuentas";
import { BancosMovimientos } from "./bancos-movimientos";
import { BancosFlujo } from "./bancos-flujo";
import { BancosConciliacion } from "./bancos-conciliacion";

export function BancosModulo({
  empresaId,
  initialResumen,
  tasa,
}: {
  empresaId: string;
  initialResumen: ResumenBancos | null;
  tasa: EstadoTasa | null;
}) {
  const [resumen, setResumen] = useState<ResumenBancos | null>(initialResumen);
  const [movimientos, setMovimientos] = useState<MovimientoBancario[]>([]);
  const [cargando, setCargando] = useState(false);
  const [tabActiva, setTabActiva] = useState("cuentas");

  const cargarDatos = useCallback(async () => {
    setCargando(true);
    try {
      const [res, movs] = await Promise.all([
        apiGet<ResumenBancos>(`/bancos/resumen?empresaId=${empresaId}`).catch(() => null),
        apiGet<MovimientoBancario[]>(`/bancos/movimientos?empresaId=${empresaId}`).catch(() => []),
      ]);
      if (res) setResumen(res);
      setMovimientos(movs);
    } catch (err) {
      toast.error("Error al actualizar datos de tesorería", {
        description: mensajeDeError(err, "Intenta de nuevo"),
      });
    } finally {
      setCargando(false);
    }
  }, [empresaId]);

  useEffect(() => {
    let activo = true;
    Promise.all([
      apiGet<ResumenBancos>(`/bancos/resumen?empresaId=${empresaId}`).catch(() => null),
      apiGet<MovimientoBancario[]>(`/bancos/movimientos?empresaId=${empresaId}`).catch(() => []),
    ]).then(([res, movs]) => {
      if (!activo) return;
      if (res) setResumen(res);
      setMovimientos(movs);
    });
    return () => {
      activo = false;
    };
  }, [empresaId]);

  const cuentas = resumen?.cuentas ?? [];
  const tasaBcv = resumen?.tasaBcv ?? tasa?.tasa ?? null;
  const cuentasEnNegativo = resumen?.cuentasEnNegativo ?? 0;

  return (
    <div className="space-y-6 max-w-full overflow-x-hidden">
      {/* Alerta destacada si existen cuentas en negativo / sobregiro */}
      {cuentasEnNegativo > 0 && (
        <Alert variant="destructive" className="border-destructive/60 bg-destructive/10">
          <AlertTriangleIcon className="size-5" />
          <AlertTitle className="text-sm font-semibold flex flex-wrap items-center gap-2">
            <span>Alerta de Sobregiro en Tesorería</span>
            <Badge variant="destructive" className="text-xs">
              {cuentasEnNegativo} {cuentasEnNegativo === 1 ? "cuenta en negativo" : "cuentas en negativo"}
            </Badge>
          </AlertTitle>
          <AlertDescription className="text-xs mt-1">
            Se detectaron saldos por debajo de cero en cuentas operativas o cajas. Revisa la pestaña de
            Cuentas para identificar los sobregiros y conciliar o transferir fondos.
          </AlertDescription>
        </Alert>
      )}

      {/* KPIs de Disponible */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* 1. Disponible en USD */}
        <Card className="relative overflow-hidden">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Disponible en USD
            </CardTitle>
            <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <DollarSignIcon className="size-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold tabular-nums tracking-tight">
              {formatUsd(resumen?.disponibleUsd ?? 0, 2)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {cuentas.filter((c) => c.moneda === "USD").length} cuenta(s) en dólares
            </p>
          </CardContent>
        </Card>

        {/* 2. Disponible en Bs */}
        <Card className="relative overflow-hidden">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Disponible en Bs
            </CardTitle>
            <div className="p-2 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400">
              <LandmarkIcon className="size-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold tabular-nums tracking-tight">
              {formatBs(resumen?.disponibleBs ?? 0)}
            </div>
            <p className="text-xs text-muted-foreground mt-1 tabular-nums">
              ≈ {formatUsd(resumen?.disponibleBsEnUsd ?? 0, 2)} a tasa oficial{" "}
              {tasaBcv ? `(${formatNumero(tasaBcv, 2)})` : ""}
            </p>
          </CardContent>
        </Card>

        {/* 3. Total Consolidado (USD) */}
        <Card className="relative overflow-hidden border-primary/30 bg-primary/5">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-semibold text-primary uppercase tracking-wider">
              Total Consolidado (USD)
            </CardTitle>
            <div className="p-2 rounded-lg bg-primary/20 text-primary">
              <WalletIcon className="size-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-black tabular-nums tracking-tight text-foreground">
              {formatUsd(resumen?.disponibleConsolidadoUsd ?? 0, 2)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              USD disponibles + Bolívares valorados a tasa BCV
            </p>
          </CardContent>
        </Card>

        {/* 4. Flujo Neto del Mes (USD) */}
        <Card className="relative overflow-hidden">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Flujo Neto del Mes (USD)
            </CardTitle>
            <div
              className={`p-2 rounded-lg ${
                (resumen?.flujoNetoMesUsd ?? 0) >= 0
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  : "bg-rose-500/10 text-rose-600 dark:text-rose-400"
              }`}
            >
              {(resumen?.flujoNetoMesUsd ?? 0) >= 0 ? (
                <TrendingUpIcon className="size-4" />
              ) : (
                <TrendingDownIcon className="size-4" />
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div
              className={`text-2xl font-bold tabular-nums tracking-tight ${
                (resumen?.flujoNetoMesUsd ?? 0) >= 0
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-rose-600 dark:text-rose-400"
              }`}
            >
              {(resumen?.flujoNetoMesUsd ?? 0) >= 0 ? "+" : ""}
              {formatUsd(resumen?.flujoNetoMesUsd ?? 0, 2)}
            </div>
            <p className="text-xs text-muted-foreground mt-1 tabular-nums">
              +{formatUsd(resumen?.ingresosMesUsd ?? 0, 0)} / -
              {formatUsd(resumen?.egresosMesUsd ?? 0, 0)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Pestañas de control de tesorería */}
      <Tabs value={tabActiva} onValueChange={setTabActiva} className="space-y-4">
        {/* Contenedor con scroll horizontal en móvil para que nunca desborde */}
        <div className="w-full overflow-x-auto pb-1 scrollbar-none">
          <TabsList className="inline-flex w-auto min-w-full sm:min-w-0 justify-start h-9 p-1 bg-muted/60">
            <TabsTrigger value="cuentas" className="text-xs gap-1.5 px-3">
              <Building2Icon className="size-3.5" />
              <span>Resumen y Cuentas</span>
              <Badge variant="secondary" className="text-[10px] px-1 py-0 ml-1">
                {cuentas.length}
              </Badge>
            </TabsTrigger>

            <TabsTrigger value="movimientos" className="text-xs gap-1.5 px-3">
              <ReceiptIcon className="size-3.5" />
              <span>Movimientos</span>
              {movimientos.length > 0 && (
                <Badge variant="secondary" className="text-[10px] px-1 py-0 ml-1">
                  {movimientos.length}
                </Badge>
              )}
            </TabsTrigger>

            <TabsTrigger value="flujo" className="text-xs gap-1.5 px-3">
              <TrendingUpIcon className="size-3.5" />
              <span>Flujo de Caja</span>
            </TabsTrigger>

            <TabsTrigger value="conciliacion" className="text-xs gap-1.5 px-3">
              <CheckCircle2Icon className="size-3.5" />
              <span>Conciliación Bancaria</span>
            </TabsTrigger>
          </TabsList>
        </div>

        {/* Pestaña 1: Cuentas y Cajas */}
        <TabsContent value="cuentas" className="space-y-4 focus-visible:outline-none">
          <BancosCuentas
            empresaId={empresaId}
            cuentas={cuentas}
            onActualizado={cargarDatos}
          />
        </TabsContent>

        {/* Pestaña 2: Libro de Movimientos */}
        <TabsContent value="movimientos" className="space-y-4 focus-visible:outline-none">
          <BancosMovimientos
            empresaId={empresaId}
            cuentas={cuentas}
            movimientos={movimientos}
            tasaBcv={tasaBcv}
            onActualizado={cargarDatos}
          />
        </TabsContent>

        {/* Pestaña 3: Flujo de Caja */}
        <TabsContent value="flujo" className="space-y-4 focus-visible:outline-none">
          <BancosFlujo empresaId={empresaId} />
        </TabsContent>

        {/* Pestaña 4: Conciliación Bancaria */}
        <TabsContent value="conciliacion" className="space-y-4 focus-visible:outline-none">
          <BancosConciliacion
            empresaId={empresaId}
            cuentas={cuentas}
            onActualizado={cargarDatos}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
