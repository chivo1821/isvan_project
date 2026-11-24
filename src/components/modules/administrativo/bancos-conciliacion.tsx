"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertCircleIcon,
  AlertTriangleIcon,
  Building2Icon,
  CheckCircle2Icon,
  ChevronDownIcon,
  ChevronUpIcon,
  ClockIcon,
  EyeIcon,
  FileSpreadsheetIcon,
  FileTextIcon,
  HelpCircleIcon,
  HistoryIcon,
  InfoIcon,
  Loader2Icon,
  PlusIcon,
  UploadCloudIcon,
  UploadIcon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "@/components/shared/status-badge";
import { apiGet, apiPost, apiPostForm, mensajeDeError } from "@/lib/api-client";
import { formatBs, formatDate, formatDateTime, formatNumero, formatUsd } from "@/lib/constants";
import type {
  ConciliacionBancaria,
  CuentaTesoreria,
  LineaConciliacion,
} from "@/lib/administrativo";

export const ESTADO_LINEA_META: Record<
  LineaConciliacion["estado"],
  { label: string; tone: "success" | "info" | "warning" | "neutral"; descripcion: string }
> = {
  COINCIDE_MOVIMIENTO: {
    label: "Coincide Movimiento",
    tone: "success",
    descripcion: "Coincide con un movimiento bancario ya registrado",
  },
  COINCIDE_GASTO: {
    label: "Comprobado vs Gasto",
    tone: "info",
    descripcion: "Coincide con una factura o comprobante de gasto del sistema",
  },
  SOLO_EN_BANCO: {
    label: "Solo en Banco",
    tone: "warning",
    descripcion: "Presente en el extracto pero no registrado en tesorería",
  },
  SOLO_EN_SISTEMA: {
    label: "Solo en Sistema",
    tone: "neutral",
    descripcion: "Registrado en el sistema pero ausente en el extracto",
  },
};

const BANCOS_COMPATIBLES = [
  "Banesco",
  "Mercantil",
  "Banco de Venezuela",
  "BBVA Provincial",
  "BNC",
  "Bancamiga",
  "Banplus",
  "BFC",
  "Banco Plaza",
  "Banco Exterior",
];

export function BancosConciliacion({
  empresaId,
  cuentas,
  onActualizado,
}: {
  empresaId: string;
  cuentas: CuentaTesoreria[];
  onActualizado: () => void;
}) {
  const [cuentaId, setCuentaId] = useState<string>(cuentas[0]?.id ?? "");
  const [archivo, setArchivo] = useState<File | null>(null);
  const [analizando, setAnalizando] = useState(false);
  const [conciliacion, setConciliacion] = useState<ConciliacionBancaria | null>(null);

  // Historial de conciliaciones
  const [historial, setHistorial] = useState<ConciliacionBancaria[]>([]);
  const [cargandoHistorial, setCargandoHistorial] = useState(false);
  const [mostrarHistorial, setMostrarHistorial] = useState(false);

  // Filtro de líneas de la conciliación activa
  const [filtroEstado, setFiltroEstado] = useState<string>("TODAS");
  const [filtroTexto, setFiltroTexto] = useState("");

  // Selección de líneas para confirmar
  const [seleccionadas, setSeleccionadas] = useState<Set<number>>(new Set());
  const [registrarFaltantes, setRegistrarFaltantes] = useState(true);
  const [confirmando, setConfirmando] = useState(false);

  const cuentaActual = cuentas.find((c) => c.id === cuentaId);

  async function cargarHistorial(ctaId = cuentaId) {
    if (!ctaId) return;
    setCargandoHistorial(true);
    try {
      const data = await apiGet<ConciliacionBancaria[]>(
        `/bancos/conciliaciones?empresaId=${empresaId}&cuentaId=${ctaId}`
      );
      setHistorial(data);
    } catch {
      // Si aún no hay conciliaciones o endpoint devuelve vacío
      setHistorial([]);
    } finally {
      setCargandoHistorial(false);
    }
  }

  useEffect(() => {
    if (!cuentaId) return;
    let activo = true;
    apiGet<ConciliacionBancaria[]>(
      `/bancos/conciliaciones?empresaId=${empresaId}&cuentaId=${cuentaId}`
    )
      .then((data) => {
        if (activo) setHistorial(data);
      })
      .catch(() => {
        if (activo) setHistorial([]);
      });
    return () => {
      activo = false;
    };
  }, [cuentaId, empresaId]);

  async function handleAnalizar(e: React.FormEvent) {
    e.preventDefault();
    if (!archivo) {
      toast.error("Selecciona un archivo .xlsx o .csv con el estado de cuenta bancario");
      return;
    }
    if (!cuentaId) {
      toast.error("Selecciona la cuenta bancaria a conciliar");
      return;
    }

    setAnalizando(true);
    try {
      const form = new FormData();
      form.append("archivo", archivo);
      form.append("cuentaId", cuentaId);
      form.append("empresaId", empresaId);

      const res = await apiPostForm<ConciliacionBancaria>("/bancos/conciliaciones/analizar", form);
      setConciliacion(res);

      // Preseleccionar automáticamente coincidencias encontradas
      const indicesPre = res.lineas
        .filter((l) => l.estado === "COINCIDE_MOVIMIENTO" || l.estado === "COINCIDE_GASTO")
        .map((l) => l.indice);
      setSeleccionadas(new Set(indicesPre));

      toast.success("Estado de cuenta analizado con éxito", {
        description: `Se procesaron ${res.resumen.totalLineasBanco} líneas bancarias.`,
      });
      cargarHistorial();
    } catch (err) {
      toast.error("Error al analizar el estado de cuenta", {
        description: mensajeDeError(
          err,
          "Asegúrate de subir el archivo original de banco (.xlsx o .csv)"
        ),
      });
    } finally {
      setAnalizando(false);
    }
  }

  // Filtrado de líneas
  const lineasFiltradas = useMemo(() => {
    if (!conciliacion) return [];
    return conciliacion.lineas.filter((l) => {
      if (filtroEstado !== "TODAS" && l.estado !== filtroEstado) return false;
      if (filtroTexto.trim()) {
        const q = filtroTexto.toLowerCase().trim();
        const coincide =
          l.descripcion.toLowerCase().includes(q) ||
          (l.referencia && l.referencia.toLowerCase().includes(q)) ||
          (l.gastoResumen?.proveedor && l.gastoResumen.proveedor.toLowerCase().includes(q));
        if (!coincide) return false;
      }
      return true;
    });
  }, [conciliacion, filtroEstado, filtroTexto]);

  function seleccionarTodas() {
    if (!conciliacion) return;
    if (seleccionadas.size === conciliacion.lineas.length) {
      setSeleccionadas(new Set());
    } else {
      setSeleccionadas(new Set(conciliacion.lineas.map((l) => l.indice)));
    }
  }

  function seleccionarCoincidencias() {
    if (!conciliacion) return;
    const coincidencias = conciliacion.lineas
      .filter((l) => l.estado === "COINCIDE_MOVIMIENTO" || l.estado === "COINCIDE_GASTO")
      .map((l) => l.indice);
    setSeleccionadas(new Set(coincidencias));
  }

  function alternarLinea(indice: number) {
    setSeleccionadas((prev) => {
      const nuevo = new Set(prev);
      if (nuevo.has(indice)) nuevo.delete(indice);
      else nuevo.add(indice);
      return nuevo;
    });
  }

  async function handleConfirmar() {
    if (!conciliacion) return;
    if (seleccionadas.size === 0) {
      toast.error("Selecciona al menos una línea para conciliar");
      return;
    }

    setConfirmando(true);
    try {
      await apiPost(`/bancos/conciliaciones/${conciliacion.id}/confirmar`, {
        lineasSeleccionadas: Array.from(seleccionadas),
        registrarFaltantes,
      });

      toast.success("Conciliación confirmada correctamente", {
        description: registrarFaltantes
          ? "Se conciliaron las líneas seleccionadas y se crearon los movimientos faltantes."
          : "Se conciliaron las líneas seleccionadas.",
      });

      setConciliacion((prev) => (prev ? { ...prev, estado: "CONFIRMADA" } : null));
      cargarHistorial();
      onActualizado();
    } catch (err) {
      toast.error("Error al confirmar conciliación", {
        description: mensajeDeError(err, "Intenta de nuevo"),
      });
    } finally {
      setConfirmando(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Sección superior: Carga de extracto */}
      {!conciliacion ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <UploadCloudIcon className="size-5 text-primary" />
              <span>Cargar y Analizar Estado de Cuenta Bancario</span>
            </CardTitle>
            <CardDescription className="text-xs">
              Sube el extracto bancario en Excel (.xlsx) o CSV descargado del portal de tu banco.
              El sistema cruzará automáticamente los movimientos contra la tesorería y gastos
              operativos.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form onSubmit={handleAnalizar} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Cuenta bancaria a conciliar *</Label>
                  <Select value={cuentaId} onValueChange={setCuentaId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecciona cuenta bancaria" />
                    </SelectTrigger>
                    <SelectContent>
                      {cuentas
                        .filter((c) => c.activa)
                        .map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.nombre} ({c.moneda} - {c.bancoNombre ?? c.tipo})
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label>Archivo de estado de cuenta (.xlsx o .csv) *</Label>
                  <Input
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    onChange={(e) => setArchivo(e.target.files?.[0] ?? null)}
                    required
                  />
                </div>
              </div>

              <div className="rounded-lg bg-muted/40 p-3 space-y-2 text-xs">
                <div className="flex items-center gap-1.5 font-medium text-foreground">
                  <Building2Icon className="size-4 text-muted-foreground" />
                  <span>Formatos bancarios soportados con detección automática:</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {BANCOS_COMPATIBLES.map((b) => (
                    <Badge key={b} variant="secondary" className="text-[11px] font-normal">
                      {b}
                    </Badge>
                  ))}
                  <Badge variant="outline" className="text-[11px] font-normal text-muted-foreground">
                    + Cualquier CSV con columnas Fecha, Ref, Monto/Débito/Crédito
                  </Badge>
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <Button type="submit" disabled={analizando || !archivo} className="gap-2">
                  {analizando ? (
                    <>
                      <Loader2Icon className="size-4 animate-spin" />
                      <span>Analizando y cruzando extracto...</span>
                    </>
                  ) : (
                    <>
                      <UploadIcon className="size-4" />
                      <span>Analizar extracto bancario</span>
                    </>
                  )}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : (
        /* Vista de Conciliación Activa */
        <div className="space-y-4">
          <Card className="border-primary/30">
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <CardTitle className="text-base font-semibold break-all">
                      Conciliación: {conciliacion.archivo}
                    </CardTitle>
                    <Badge
                      variant={conciliacion.estado === "CONFIRMADA" ? "default" : "outline"}
                      className={
                        conciliacion.estado === "CONFIRMADA"
                          ? "bg-emerald-600 hover:bg-emerald-700"
                          : "text-amber-600 border-amber-500/40"
                      }
                    >
                      {conciliacion.estado === "CONFIRMADA" ? "Confirmada" : "Borrador de cuadre"}
                    </Badge>
                  </div>
                  <CardDescription className="text-xs">
                    Cuenta: <strong>{conciliacion.cuentaNombre ?? cuentaActual?.nombre}</strong> ·
                    Período: <strong>{formatDate(conciliacion.periodoDesde)}</strong> al{" "}
                    <strong>{formatDate(conciliacion.periodoHasta)}</strong>
                    {conciliacion.saldoExtractoFinal != null && (
                      <span>
                        {" "}
                        · Saldo final extracto:{" "}
                        <strong>
                          {cuentaActual?.moneda === "USD"
                            ? formatUsd(conciliacion.saldoExtractoFinal, 2)
                            : formatBs(conciliacion.saldoExtractoFinal)}
                        </strong>
                      </span>
                    )}
                  </CardDescription>
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setConciliacion(null);
                    setArchivo(null);
                  }}
                  className="gap-1.5 text-xs"
                >
                  <XIcon className="size-3.5" />
                  Cerrar o nuevo extracto
                </Button>
              </div>
            </CardHeader>

            <CardContent className="space-y-4">
              {/* Resumen de cuadre en 4 tarjetas métricas */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {/* 1. Coincide Movimiento */}
                <div className="rounded-lg border border-emerald-500/40 bg-emerald-50/30 dark:bg-emerald-950/20 p-3 space-y-1">
                  <div className="flex items-center justify-between text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                    <span>1. Coincide Movimiento</span>
                    <CheckCircle2Icon className="size-4" />
                  </div>
                  <div className="text-2xl font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
                    {conciliacion.resumen.coincideMovimiento}
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-tight">
                    Líneas que coinciden exactamente con movimientos en tesorería.
                  </p>
                </div>

                {/* 2. Comprobado vs Gasto */}
                <div className="rounded-lg border border-blue-500/40 bg-blue-50/30 dark:bg-blue-950/20 p-3 space-y-1">
                  <div className="flex items-center justify-between text-xs font-semibold text-blue-700 dark:text-blue-400">
                    <span>2. Comprobado vs Gasto</span>
                    <InfoIcon className="size-4" />
                  </div>
                  <div className="text-2xl font-bold tabular-nums text-blue-700 dark:text-blue-400">
                    {conciliacion.resumen.coincideGasto}
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-tight">
                    Egresos del banco cruzados contra gastos operativos aprobados.
                  </p>
                </div>

                {/* 3. Solo en Banco */}
                <div className="rounded-lg border border-amber-500/40 bg-amber-50/30 dark:bg-amber-950/20 p-3 space-y-1">
                  <div className="flex items-center justify-between text-xs font-semibold text-amber-700 dark:text-amber-400">
                    <span>3. Solo en Banco</span>
                    <AlertTriangleIcon className="size-4" />
                  </div>
                  <div className="text-2xl font-bold tabular-nums text-amber-700 dark:text-amber-400">
                    {conciliacion.resumen.soloEnBanco}
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-tight">
                    En el banco pero no registrados en tesorería (comisiones, etc.).
                  </p>
                </div>

                {/* 4. Solo en Sistema */}
                <div className="rounded-lg border border-purple-500/40 bg-purple-50/30 dark:bg-purple-950/20 p-3 space-y-1">
                  <div className="flex items-center justify-between text-xs font-semibold text-purple-700 dark:text-purple-400">
                    <span>4. Solo en Sistema</span>
                    <ClockIcon className="size-4" />
                  </div>
                  <div className="text-2xl font-bold tabular-nums text-purple-700 dark:text-purple-400">
                    {conciliacion.resumen.soloEnSistema}
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-tight">
                    Movimientos o gastos registrados que no salieron en el extracto.
                  </p>
                </div>
              </div>

              {/* Barra de filtrado y selección de líneas */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    placeholder="Filtrar por descripción, ref, proveedor..."
                    className="h-8 w-60 text-xs"
                    value={filtroTexto}
                    onChange={(e) => setFiltroTexto(e.target.value)}
                  />

                  <Select value={filtroEstado} onValueChange={setFiltroEstado}>
                    <SelectTrigger className="h-8 w-48 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="TODAS">Todas las líneas ({conciliacion.lineas.length})</SelectItem>
                      <SelectItem value="COINCIDE_MOVIMIENTO">
                        Coincide Movimiento ({conciliacion.resumen.coincideMovimiento})
                      </SelectItem>
                      <SelectItem value="COINCIDE_GASTO">
                        Comprobado vs Gasto ({conciliacion.resumen.coincideGasto})
                      </SelectItem>
                      <SelectItem value="SOLO_EN_BANCO">
                        Solo en Banco ({conciliacion.resumen.soloEnBanco})
                      </SelectItem>
                      <SelectItem value="SOLO_EN_SISTEMA">
                        Solo en Sistema ({conciliacion.resumen.soloEnSistema})
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {conciliacion.estado === "BORRADOR" && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={seleccionarCoincidencias}
                      className="h-7 text-xs"
                    >
                      Preseleccionar coincidencias
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={seleccionarTodas}
                      className="h-7 text-xs"
                    >
                      {seleccionadas.size === conciliacion.lineas.length
                        ? "Deseleccionar todas"
                        : "Seleccionar todas"}
                    </Button>
                  </div>
                )}
              </div>

              {/* Tabla de líneas de conciliación */}
              <div className="overflow-x-auto rounded-lg border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {conciliacion.estado === "BORRADOR" && (
                        <TableHead className="w-10 text-center">
                          <span className="sr-only">Seleccionar</span>
                        </TableHead>
                      )}
                      <TableHead className="w-12 text-center">#</TableHead>
                      <TableHead className="w-24">Fecha</TableHead>
                      <TableHead className="w-28">Referencia</TableHead>
                      <TableHead>Descripción / Detalle bancario</TableHead>
                      <TableHead className="text-right">Monto</TableHead>
                      <TableHead className="text-right">Saldo banco</TableHead>
                      <TableHead className="w-40 text-center">Estado</TableHead>
                      <TableHead>Cruce en Sistema</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lineasFiltradas.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={conciliacion.estado === "BORRADOR" ? 9 : 8}
                          className="py-8 text-center text-xs text-muted-foreground"
                        >
                          No hay líneas con el filtro aplicado.
                        </TableCell>
                      </TableRow>
                    ) : (
                      lineasFiltradas.map((linea) => {
                        const meta = ESTADO_LINEA_META[linea.estado];
                        const esDebito = linea.monto < 0;
                        const seleccionada = seleccionadas.has(linea.indice);

                        return (
                          <TableRow
                            key={linea.indice}
                            className={seleccionada ? "bg-primary/5" : ""}
                          >
                            {conciliacion.estado === "BORRADOR" && (
                              <TableCell className="text-center">
                                <Checkbox
                                  checked={seleccionada}
                                  onCheckedChange={() => alternarLinea(linea.indice)}
                                  aria-label={`Seleccionar línea ${linea.indice}`}
                                />
                              </TableCell>
                            )}

                            <TableCell className="text-center text-xs text-muted-foreground font-mono">
                              {linea.indice}
                            </TableCell>

                            <TableCell className="text-xs whitespace-nowrap font-mono">
                              {formatDate(linea.fecha)}
                            </TableCell>

                            <TableCell className="text-xs font-mono">
                              {linea.referencia || "—"}
                            </TableCell>

                            <TableCell className="max-w-xs text-xs font-medium truncate" title={linea.descripcion}>
                              {linea.descripcion}
                            </TableCell>

                            <TableCell className="text-right tabular-nums whitespace-nowrap">
                              <span
                                className={`text-xs font-semibold ${
                                  esDebito
                                    ? "text-rose-600 dark:text-rose-400"
                                    : "text-emerald-600 dark:text-emerald-400"
                                }`}
                              >
                                {linea.monto > 0 ? "+" : ""}
                                {cuentaActual?.moneda === "USD"
                                  ? formatUsd(linea.monto, 2)
                                  : formatBs(linea.monto)}
                              </span>
                            </TableCell>

                            <TableCell className="text-right tabular-nums text-xs whitespace-nowrap text-muted-foreground">
                              {linea.saldo != null
                                ? cuentaActual?.moneda === "USD"
                                  ? formatUsd(linea.saldo, 2)
                                  : formatBs(linea.saldo)
                                : "—"}
                            </TableCell>

                            <TableCell className="text-center whitespace-nowrap">
                              <StatusBadge
                                label={meta.label}
                                tone={meta.tone}
                                className="text-[10px]"
                              />
                            </TableCell>

                            <TableCell className="text-xs text-muted-foreground">
                              {linea.movimientoId && (
                                <span className="font-mono text-primary font-medium">
                                  Mov #{linea.movimientoId}
                                </span>
                              )}
                              {linea.gastoResumen && (
                                <div>
                                  <span className="font-medium text-foreground">
                                    {linea.gastoResumen.proveedor ?? "Gasto operativo"}
                                  </span>{" "}
                                  · {linea.gastoResumen.categoria} (
                                  {formatUsd(linea.gastoResumen.montoUsd, 2)})
                                </div>
                              )}
                              {!linea.movimientoId && !linea.gastoResumen && (
                                <span className="text-muted-foreground italic">
                                  {linea.estado === "SOLO_EN_BANCO"
                                    ? "Sin registro en sistema"
                                    : "Sin coincidencia en extracto"}
                                </span>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>

              {/* Pie de confirmación */}
              {conciliacion.estado === "BORRADOR" && (
                <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t bg-muted/20 p-3 rounded-lg">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="reg-faltantes"
                      checked={registrarFaltantes}
                      onCheckedChange={(c) => setRegistrarFaltantes(Boolean(c))}
                    />
                    <Label htmlFor="reg-faltantes" className="text-xs cursor-pointer">
                      Registrar automáticamente egresos de &quot;Solo en Banco&quot; seleccionados como
                      nuevos movimientos de tesorería (comisiones, débitos).
                    </Label>
                  </div>

                  <Button
                    onClick={handleConfirmar}
                    disabled={confirmando || seleccionadas.size === 0}
                    className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
                  >
                    {confirmando ? (
                      <>
                        <Loader2Icon className="size-4 animate-spin" />
                        <span>Confirmando conciliación...</span>
                      </>
                    ) : (
                      <>
                        <CheckCircle2Icon className="size-4" />
                        <span>Confirmar conciliación ({seleccionadas.size} líneas)</span>
                      </>
                    )}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Historial de conciliaciones anteriores */}
      <Card>
        <CardHeader
          className="cursor-pointer pb-3 hover:bg-muted/10 transition-colors"
          onClick={() => setMostrarHistorial(!mostrarHistorial)}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <HistoryIcon className="size-4 text-muted-foreground" />
              <CardTitle className="text-sm font-semibold">
                Historial de Conciliaciones Bancarias
              </CardTitle>
              <Badge variant="outline" className="text-xs">
                {historial.length}
              </Badge>
            </div>
            {mostrarHistorial ? (
              <ChevronUpIcon className="size-4 text-muted-foreground" />
            ) : (
              <ChevronDownIcon className="size-4 text-muted-foreground" />
            )}
          </div>
        </CardHeader>

        {mostrarHistorial && (
          <CardContent className="pt-0 space-y-3">
            {cargandoHistorial ? (
              <div className="flex py-6 justify-center">
                <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
              </div>
            ) : historial.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted-foreground">
                No hay conciliaciones previas registradas para esta cuenta.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Fecha proceso</TableHead>
                      <TableHead>Archivo</TableHead>
                      <TableHead>Período</TableHead>
                      <TableHead className="text-center">Líneas banco</TableHead>
                      <TableHead className="text-center">Coincidencias</TableHead>
                      <TableHead className="text-center">Estado</TableHead>
                      <TableHead className="text-right">Acción</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {historial.map((h) => (
                      <TableRow key={h.id}>
                        <TableCell className="text-xs whitespace-nowrap">
                          {formatDateTime(h.creadaEn)}
                        </TableCell>
                        <TableCell className="text-xs font-medium">{h.archivo}</TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {formatDate(h.periodoDesde)} al {formatDate(h.periodoHasta)}
                        </TableCell>
                        <TableCell className="text-center tabular-nums text-xs">
                          {h.resumen?.totalLineasBanco ?? h.lineas?.length ?? "—"}
                        </TableCell>
                        <TableCell className="text-center tabular-nums text-xs text-emerald-600 font-medium">
                          {(h.resumen?.coincideMovimiento ?? 0) + (h.resumen?.coincideGasto ?? 0)}
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge
                            variant={h.estado === "CONFIRMADA" ? "default" : "outline"}
                            className="text-[10px]"
                          >
                            {h.estado}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs gap-1"
                            onClick={() => {
                              setConciliacion(h);
                              const inc = h.lineas
                                .filter(
                                  (l) =>
                                    l.estado === "COINCIDE_MOVIMIENTO" ||
                                    l.estado === "COINCIDE_GASTO"
                                )
                                .map((l) => l.indice);
                              setSeleccionadas(new Set(inc));
                              window.scrollTo({ top: 0, behavior: "smooth" });
                            }}
                          >
                            <EyeIcon className="size-3" />
                            Ver detalle
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        )}
      </Card>
    </div>
  );
}
