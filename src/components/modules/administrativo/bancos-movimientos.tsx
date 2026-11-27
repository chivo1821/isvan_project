"use client";

import { useId, useMemo, useState } from "react";
import {
  AlertCircleIcon,
  AlertTriangleIcon,
  ArrowDownLeftIcon,
  ArrowUpDownIcon,
  ArrowUpRightIcon,
  BanIcon,
  CheckCircle2Icon,
  FilterIcon,
  RepeatIcon,
  SearchIcon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/shared/status-badge";
import { apiPost, mensajeDeError } from "@/lib/api-client";
import { formatBs, formatDate, formatNumero, formatUsd } from "@/lib/constants";
import type { CuentaTesoreria, MovimientoBancario } from "@/lib/administrativo";

export const METODOS_PAGO = [
  { id: "TRANSFERENCIA", label: "Transferencia bancaria" },
  { id: "PAGO_MOVIL", label: "Pago Móvil" },
  { id: "EFECTIVO", label: "Efectivo Bs" },
  { id: "DIVISAS", label: "Divisas efectivo (USD)" },
  { id: "ZELLE", label: "Zelle" },
  { id: "CHEQUE", label: "Cheque" },
  { id: "POS", label: "Punto de venta (POS)" },
  { id: "COMISION_IGTF", label: "Comisión bancaria / IGTF" },
  { id: "OTRO", label: "Otro instrumento" },
];

export const CATEGORIAS_MOVIMIENTO = [
  { id: "COBRANZA_CLIENTES", label: "Cobranza de clientes" },
  { id: "COMPRA_INVENTARIO", label: "Compra de inventario" },
  { id: "GASTO_OPERATIVO", label: "Gasto operativo" },
  { id: "NOMINA", label: "Nómina y sueldos" },
  { id: "DELIVERY", label: "Fletes y delivery" },
  { id: "IMPUESTOS_IGTF", label: "Impuestos / IGTF" },
  { id: "TRASPASO", label: "Traspaso interno" },
  { id: "APORTE_CAPITAL", label: "Aporte de capital" },
  { id: "OTRO", label: "Otro" },
];

export function BancosMovimientos({
  empresaId,
  cuentas,
  movimientos,
  tasaBcv,
  onActualizado,
}: {
  empresaId: string;
  cuentas: CuentaTesoreria[];
  movimientos: MovimientoBancario[];
  tasaBcv: number | null;
  onActualizado: () => void;
}) {
  // Filtros
  const [cuentaFiltro, setCuentaFiltro] = useState<string>("TODAS");
  const [tipoFiltro, setTipoFiltro] = useState<string>("TODOS");
  const [categoriaFiltro, setCategoriaFiltro] = useState<string>("TODAS");
  const [conciliadoFiltro, setConciliadoFiltro] = useState<string>("TODOS");
  const [busqueda, setBusqueda] = useState<string>("");
  const [fechaDesde, setFechaDesde] = useState<string>("");
  const [fechaHasta, setFechaHasta] = useState<string>("");

  // Modales
  const [modalIngreso, setModalIngreso] = useState(false);
  const [modalEgreso, setModalEgreso] = useState(false);
  const [modalTransferencia, setModalTransferencia] = useState(false);
  const [movimientoAnular, setMovimientoAnular] = useState<MovimientoBancario | null>(null);

  // Selección para conciliación masiva
  const [seleccionados, setSeleccionados] = useState<Set<number>>(new Set());
  const [conciliandoLote, setConciliandoLote] = useState(false);

  // Filtrado de movimientos
  const filtrados = useMemo(() => {
    return movimientos.filter((m) => {
      if (cuentaFiltro !== "TODAS" && m.cuentaId !== cuentaFiltro) return false;
      if (tipoFiltro !== "TODOS" && m.tipo !== tipoFiltro) return false;
      if (categoriaFiltro !== "TODAS" && m.categoria !== categoriaFiltro) return false;
      if (conciliadoFiltro === "CONCILIADOS" && !m.conciliado) return false;
      if (conciliadoFiltro === "PENDIENTES" && m.conciliado) return false;
      if (conciliadoFiltro === "ANULADOS" && !m.anuladoEn) return false;
      if (conciliadoFiltro === "ACTIVOS" && m.anuladoEn) return false;
      if (fechaDesde && m.fecha < fechaDesde) return false;
      if (fechaHasta && m.fecha > fechaHasta) return false;

      if (busqueda.trim()) {
        const q = busqueda.toLowerCase().trim();
        const coincide =
          m.concepto.toLowerCase().includes(q) ||
          (m.tercero && m.tercero.toLowerCase().includes(q)) ||
          (m.referencia && m.referencia.toLowerCase().includes(q)) ||
          m.cuentaNombre.toLowerCase().includes(q);
        if (!coincide) return false;
      }
      return true;
    });
  }, [
    movimientos,
    cuentaFiltro,
    tipoFiltro,
    categoriaFiltro,
    conciliadoFiltro,
    busqueda,
    fechaDesde,
    fechaHasta,
  ]);

  // Manejo de selección masiva
  const seleccionables = useMemo(() => {
    return filtrados.filter((m) => !m.conciliado && !m.anuladoEn);
  }, [filtrados]);

  const todosSeleccionados =
    seleccionables.length > 0 && seleccionables.every((m) => seleccionados.has(m.id));

  function alternarTodos() {
    if (todosSeleccionados) {
      setSeleccionados(new Set());
    } else {
      setSeleccionados(new Set(seleccionables.map((m) => m.id)));
    }
  }

  function alternarUno(id: number) {
    setSeleccionados((prev) => {
      const nuevo = new Set(prev);
      if (nuevo.has(id)) nuevo.delete(id);
      else nuevo.add(id);
      return nuevo;
    });
  }

  async function conciliarSeleccionados() {
    if (seleccionados.size === 0) return;
    setConciliandoLote(true);
    try {
      await apiPost("/bancos/movimientos/conciliar", {
        movimientoIds: Array.from(seleccionados),
      });
      toast.success(`${seleccionados.size} movimiento(s) marcado(s) como conciliado(s)`);
      setSeleccionados(new Set());
      onActualizado();
    } catch (err) {
      toast.error("Error al conciliar en lote", {
        description: mensajeDeError(err, "Intenta de nuevo"),
      });
    } finally {
      setConciliandoLote(false);
    }
  }

  function limpiarFiltros() {
    setCuentaFiltro("TODAS");
    setTipoFiltro("TODOS");
    setCategoriaFiltro("TODAS");
    setConciliadoFiltro("TODOS");
    setBusqueda("");
    setFechaDesde("");
    setFechaHasta("");
  }

  return (
    <div className="space-y-4">
      {/* Botones de acción rápida */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            onClick={() => setModalIngreso(true)}
            size="sm"
            className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            <ArrowDownLeftIcon className="size-4" />
            Registrar Ingreso
          </Button>

          <Button
            onClick={() => setModalEgreso(true)}
            size="sm"
            variant="destructive"
            className="gap-1.5"
          >
            <ArrowUpRightIcon className="size-4" />
            Registrar Egreso
          </Button>

          <Button
            onClick={() => setModalTransferencia(true)}
            size="sm"
            variant="outline"
            className="gap-1.5 border-dashed"
          >
            <RepeatIcon className="size-4" />
            Transferir / Cambiar Divisas
          </Button>
        </div>

        {seleccionados.size > 0 && (
          <div className="flex items-center gap-2 rounded-lg bg-primary/10 px-3 py-1.5">
            <span className="text-xs font-medium">
              {seleccionados.size} seleccionado(s)
            </span>
            <Button
              onClick={conciliarSeleccionados}
              size="sm"
              disabled={conciliandoLote}
              className="gap-1 h-7 text-xs"
            >
              <CheckCircle2Icon className="size-3.5" />
              Conciliar seleccionados
            </Button>
          </div>
        )}
      </div>

      {/* Barra de filtros */}
      <Card>
        <CardContent className="p-3 sm:p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2.5">
            <div className="relative">
              <SearchIcon className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por concepto, tercero o ref..."
                className="pl-8 text-xs h-9"
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
              />
            </div>

            <Select value={cuentaFiltro} onValueChange={setCuentaFiltro}>
              <SelectTrigger className="h-9 text-xs">
                <SelectValue placeholder="Cuenta" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="TODAS">Todas las cuentas</SelectItem>
                {cuentas.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.nombre} ({c.moneda})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={tipoFiltro} onValueChange={setTipoFiltro}>
              <SelectTrigger className="h-9 text-xs">
                <SelectValue placeholder="Tipo de movimiento" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="TODOS">Todos los tipos</SelectItem>
                <SelectItem value="INGRESO">Ingresos</SelectItem>
                <SelectItem value="EGRESO">Egresos</SelectItem>
                <SelectItem value="TRANSFERENCIA_ENTRADA">Traspasos (Entrada)</SelectItem>
                <SelectItem value="TRANSFERENCIA_SALIDA">Traspasos (Salida)</SelectItem>
                <SelectItem value="AJUSTE">Ajustes</SelectItem>
              </SelectContent>
            </Select>

            <Select value={categoriaFiltro} onValueChange={setCategoriaFiltro}>
              <SelectTrigger className="h-9 text-xs">
                <SelectValue placeholder="Categoría" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="TODAS">Todas las categorías</SelectItem>
                {CATEGORIAS_MOVIMIENTO.map((cat) => (
                  <SelectItem key={cat.id} value={cat.id}>
                    {cat.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1.5">
                <span className="text-muted-foreground">Desde:</span>
                <Input
                  type="date"
                  className="h-8 w-32 text-xs"
                  value={fechaDesde}
                  onChange={(e) => setFechaDesde(e.target.value)}
                />
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-muted-foreground">Hasta:</span>
                <Input
                  type="date"
                  className="h-8 w-32 text-xs"
                  value={fechaHasta}
                  onChange={(e) => setFechaHasta(e.target.value)}
                />
              </div>

              <Select value={conciliadoFiltro} onValueChange={setConciliadoFiltro}>
                <SelectTrigger className="h-8 w-36 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="TODOS">Todos los estados</SelectItem>
                  <SelectItem value="PENDIENTES">Solo pendientes</SelectItem>
                  <SelectItem value="CONCILIADOS">Solo conciliados</SelectItem>
                  <SelectItem value="ACTIVOS">Solo activos (no anulados)</SelectItem>
                  <SelectItem value="ANULADOS">Solo anulados</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {(cuentaFiltro !== "TODAS" ||
              tipoFiltro !== "TODOS" ||
              categoriaFiltro !== "TODAS" ||
              conciliadoFiltro !== "TODOS" ||
              busqueda ||
              fechaDesde ||
              fechaHasta) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={limpiarFiltros}
                className="h-8 text-xs gap-1 text-muted-foreground hover:text-foreground"
              >
                <XIcon className="size-3" />
                Limpiar filtros
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Tabla de movimientos */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
          <span>
            Mostrando {filtrados.length} de {movimientos.length} movimientos
          </span>
          {seleccionables.length > 0 && (
            <button
              onClick={alternarTodos}
              className="text-primary hover:underline font-medium"
            >
              {todosSeleccionados
                ? "Deseleccionar todos"
                : `Seleccionar pendientes (${seleccionables.length})`}
            </button>
          )}
        </div>

        {filtrados.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-sm text-muted-foreground">
              No hay movimientos que coincidan con los filtros aplicados.
            </CardContent>
          </Card>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10 text-center">
                    <span className="sr-only">Seleccionar</span>
                  </TableHead>
                  <TableHead className="w-24">Fecha</TableHead>
                  <TableHead>Cuenta</TableHead>
                  <TableHead>Concepto / Tercero</TableHead>
                  <TableHead>Categoría / Método</TableHead>
                  <TableHead className="text-right">Monto</TableHead>
                  <TableHead className="text-right">Saldo</TableHead>
                  <TableHead className="w-24 text-center">Estado</TableHead>
                  <TableHead className="w-16 text-right">Acción</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtrados.map((m) => {
                  const esIngreso = m.monto > 0;
                  const esAnulado = Boolean(m.anuladoEn);
                  const sePuedeSeleccionar = !m.conciliado && !esAnulado;

                  return (
                    <TableRow
                      key={m.id}
                      className={`${esAnulado ? "opacity-50 bg-muted/20" : ""}`}
                    >
                      <TableCell className="text-center">
                        {sePuedeSeleccionar && (
                          <Checkbox
                            checked={seleccionados.has(m.id)}
                            onCheckedChange={() => alternarUno(m.id)}
                            aria-label={`Seleccionar movimiento ${m.id}`}
                          />
                        )}
                      </TableCell>

                      <TableCell className="whitespace-nowrap text-xs font-mono">
                        {formatDate(m.fecha)}
                      </TableCell>

                      <TableCell className="text-xs">
                        <span className="font-medium">{m.cuentaNombre}</span>
                        <span className="ml-1 text-[10px] text-muted-foreground font-mono">
                          ({m.cuentaMoneda})
                        </span>
                      </TableCell>

                      <TableCell className="max-w-xs">
                        <div className="text-xs font-medium truncate" title={m.concepto}>
                          {m.concepto}
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                          {m.tercero && <span>{m.tercero}</span>}
                          {m.referencia && (
                            <span className="font-mono">Ref: {m.referencia}</span>
                          )}
                        </div>
                      </TableCell>

                      <TableCell className="text-xs">
                        <div>
                          {CATEGORIAS_MOVIMIENTO.find((c) => c.id === m.categoria)?.label ??
                            m.categoria}
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          {METODOS_PAGO.find((p) => p.id === m.metodo)?.label ?? m.metodo}
                        </div>
                      </TableCell>

                      <TableCell className="text-right tabular-nums whitespace-nowrap">
                        <div
                          className={`text-xs font-semibold ${
                            esAnulado
                              ? "line-through text-muted-foreground"
                              : esIngreso
                              ? "text-emerald-600 dark:text-emerald-400"
                              : "text-rose-600 dark:text-rose-400"
                          }`}
                        >
                          {esIngreso ? "+" : ""}
                          {m.cuentaMoneda === "USD"
                            ? formatUsd(m.monto, 2)
                            : formatBs(m.monto)}
                        </div>
                        {m.cuentaMoneda === "VES" && m.montoUsd != null && (
                          <div className="text-[10px] text-muted-foreground">
                            ≈ {formatUsd(m.montoUsd, 2)}
                          </div>
                        )}
                      </TableCell>

                      <TableCell className="text-right tabular-nums text-xs whitespace-nowrap">
                        {m.cuentaMoneda === "USD"
                          ? formatUsd(m.saldoResultante, 2)
                          : formatBs(m.saldoResultante)}
                      </TableCell>

                      <TableCell className="text-center whitespace-nowrap">
                        {esAnulado ? (
                          <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                            Anulado
                          </Badge>
                        ) : m.conciliado ? (
                          <StatusBadge label="Conciliado" tone="success" className="text-[10px]" />
                        ) : (
                          <StatusBadge label="Pendiente" tone="warning" className="text-[10px]" />
                        )}
                      </TableCell>

                      <TableCell className="text-right">
                        {!esAnulado && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7 text-muted-foreground hover:text-destructive"
                            onClick={() => setMovimientoAnular(m)}
                            title="Anular movimiento"
                          >
                            <BanIcon className="size-3.5" />
                            <span className="sr-only">Anular movimiento {m.id}</span>
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* Modales de operación */}
      <MovimientoSimpleModal
        tipo="INGRESO"
        abierto={modalIngreso}
        onOpenChange={setModalIngreso}
        empresaId={empresaId}
        cuentas={cuentas}
        tasaBcv={tasaBcv}
        onGuardado={onActualizado}
      />

      <MovimientoSimpleModal
        tipo="EGRESO"
        abierto={modalEgreso}
        onOpenChange={setModalEgreso}
        empresaId={empresaId}
        cuentas={cuentas}
        tasaBcv={tasaBcv}
        onGuardado={onActualizado}
      />

      <TransferenciaModal
        abierto={modalTransferencia}
        onOpenChange={setModalTransferencia}
        empresaId={empresaId}
        cuentas={cuentas}
        tasaBcv={tasaBcv}
        onGuardado={onActualizado}
      />

      {movimientoAnular && (
        <AnularMovimientoDialog
          movimiento={movimientoAnular}
          onOpenChange={(abierto) => !abierto && setMovimientoAnular(null)}
          onGuardado={() => {
            setMovimientoAnular(null);
            onActualizado();
          }}
        />
      )}
    </div>
  );
}

// Modal unificado para Registrar Ingreso o Registrar Egreso
function MovimientoSimpleModal({
  tipo,
  abierto,
  onOpenChange,
  empresaId,
  cuentas,
  tasaBcv,
  onGuardado,
}: {
  tipo: "INGRESO" | "EGRESO";
  abierto: boolean;
  onOpenChange: (open: boolean) => void;
  empresaId: string;
  cuentas: CuentaTesoreria[];
  tasaBcv: number | null;
  onGuardado: () => void;
}) {
  const [cuentaId, setCuentaId] = useState<string>(
    () => cuentas.find((c) => c.activa)?.id ?? ""
  );
  const [fecha, setFecha] = useState<string>(new Date().toISOString().slice(0, 10));
  const [monto, setMonto] = useState<string>("");
  const [metodo, setMetodo] = useState<string>("TRANSFERENCIA");
  const [categoria, setCategoria] = useState<string>(
    tipo === "INGRESO" ? "COBRANZA_CLIENTES" : "GASTO_OPERATIVO"
  );
  const [concepto, setConcepto] = useState<string>("");
  const [tercero, setTercero] = useState<string>("");
  const [referencia, setReferencia] = useState<string>("");
  const [tasa, setTasa] = useState<string>(tasaBcv ? String(tasaBcv) : "");
  const [guardando, setGuardando] = useState(false);

  const cuentaIdEfectiva =
    cuentaId && cuentas.some((c) => c.id === cuentaId && c.activa)
      ? cuentaId
      : (cuentas.find((c) => c.activa)?.id ?? "");

  const cuentaSeleccionada = cuentas.find((c) => c.id === cuentaIdEfectiva);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!cuentaIdEfectiva) {
      toast.error("Selecciona una cuenta activa");
      return;
    }
    const montoNum = Math.abs(Number(monto.replace(",", ".")));
    if (!montoNum || montoNum <= 0) {
      toast.error("Ingresa un monto válido mayor a cero");
      return;
    }
    if (!concepto.trim()) {
      toast.error("El concepto del movimiento es obligatorio");
      return;
    }

    setGuardando(true);
    try {
      await apiPost("/bancos/movimientos", {
        empresaId,
        cuentaId: cuentaIdEfectiva,
        fecha,
        tipo,
        metodo,
        categoria,
        concepto: concepto.trim(),
        tercero: tercero.trim() || null,
        referencia: referencia.trim() || null,
        monto: tipo === "EGRESO" ? -montoNum : montoNum,
        tasa: tasa ? Number(tasa.replace(",", ".")) : null,
      });

      toast.success(
        tipo === "INGRESO" ? "Ingreso registrado con éxito" : "Egreso registrado con éxito"
      );
      onOpenChange(false);
      setMonto("");
      setConcepto("");
      setTercero("");
      setReferencia("");
      onGuardado();
    } catch (err) {
      toast.error(`Error al registrar ${tipo.toLowerCase()}`, {
        description: mensajeDeError(err, "Verifica los datos e intenta de nuevo"),
      });
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Dialog open={abierto} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md w-full max-h-[90vh] overflow-y-auto">
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {tipo === "INGRESO" ? (
                <>
                  <ArrowDownLeftIcon className="size-5 text-emerald-600" />
                  <span>Registrar Ingreso de Dinero</span>
                </>
              ) : (
                <>
                  <ArrowUpRightIcon className="size-5 text-rose-600" />
                  <span>Registrar Egreso de Dinero</span>
                </>
              )}
            </DialogTitle>
            <DialogDescription>
              {tipo === "INGRESO"
                ? "Registra una entrada en cuenta bancaria, cobranza o inyección de fondos."
                : "Registra una salida de dinero por pago operativo, compras o retiros."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Cuenta / Caja destino</Label>
              <Select value={cuentaIdEfectiva} onValueChange={setCuentaId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {cuentas
                    .filter((c) => c.activa)
                    .map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.nombre} ({c.moneda} - Saldo:{" "}
                        {c.moneda === "USD" ? formatUsd(c.saldoActual, 2) : formatBs(c.saldoActual)}
                        )
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div className="space-y-1">
                <Label>Fecha</Label>
                <Input
                  type="date"
                  value={fecha}
                  onChange={(e) => setFecha(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-1">
                <Label>Monto ({cuentaSeleccionada?.moneda ?? "USD"})</Label>
                <Input
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  value={monto}
                  onChange={(e) => setMonto(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div className="space-y-1">
                <Label>Método de pago</Label>
                <Select value={metodo} onValueChange={setMetodo}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {METODOS_PAGO.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label>Categoría</Label>
                <Select value={categoria} onValueChange={setCategoria}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIAS_MOVIMIENTO.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1">
              <Label>Concepto / Motivo *</Label>
              <Input
                placeholder="Ej. Cobranza Factura 1042, Pago servicio de internet"
                value={concepto}
                onChange={(e) => setConcepto(e.target.value)}
                required
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div className="space-y-1">
                <Label>Tercero (Cliente/Proveedor)</Label>
                <Input
                  placeholder="Nombre o razón social"
                  value={tercero}
                  onChange={(e) => setTercero(e.target.value)}
                />
              </div>

              <div className="space-y-1">
                <Label>Nro. de Referencia</Label>
                <Input
                  placeholder="Ej. 987654"
                  value={referencia}
                  onChange={(e) => setReferencia(e.target.value)}
                />
              </div>
            </div>

            {cuentaSeleccionada?.moneda === "VES" && (
              <div className="space-y-1 pt-1">
                <div className="flex items-center justify-between">
                  <Label>Tasa BCV de cálculo (opcional)</Label>
                  {tasaBcv && (
                    <button
                      type="button"
                      onClick={() => setTasa(String(tasaBcv))}
                      className="text-[11px] text-primary hover:underline"
                    >
                      Usar BCV ({formatNumero(tasaBcv, 2)})
                    </button>
                  )}
                </div>
                <Input
                  type="number"
                  step="0.0001"
                  placeholder={tasaBcv ? String(tasaBcv) : "Tasa de cambio"}
                  value={tasa}
                  onChange={(e) => setTasa(e.target.value)}
                />
              </div>
            )}
          </div>

          <DialogFooter className="gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={guardando}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={guardando}
              className={
                tipo === "INGRESO"
                  ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                  : ""
              }
            >
              {guardando ? "Registrando..." : `Confirmar ${tipo.toLowerCase()}`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// Modal para Transferencias y Cambio de Divisas
function TransferenciaModal({
  abierto,
  onOpenChange,
  empresaId,
  cuentas,
  tasaBcv,
  onGuardado,
}: {
  abierto: boolean;
  onOpenChange: (open: boolean) => void;
  empresaId: string;
  cuentas: CuentaTesoreria[];
  tasaBcv: number | null;
  onGuardado: () => void;
}) {
  const activas = cuentas.filter((c) => c.activa);
  const [origenId, setOrigenId] = useState<string>(activas[0]?.id ?? "");
  const [destinoId, setDestinoId] = useState<string>(
    activas.find((c) => c.id !== activas[0]?.id)?.id ?? ""
  );
  const [fecha, setFecha] = useState<string>(new Date().toISOString().slice(0, 10));
  const [monto, setMonto] = useState<string>("");
  const [concepto, setConcepto] = useState<string>("Traspaso entre cuentas");
  const [referencia, setReferencia] = useState<string>("");
  const [tasaPactada, setTasaPactada] = useState<string>(tasaBcv ? String(tasaBcv) : "");
  const [guardando, setGuardando] = useState(false);

  const origen = cuentas.find((c) => c.id === origenId);
  const destino = cuentas.find((c) => c.id === destinoId);

  // ¿Cambio de divisas?
  const esCambioDivisas = origen && destino && origen.moneda !== destino.moneda;

  // Cálculo del monto en destino estimado
  const montoNum = Math.abs(Number(monto.replace(",", "."))) || 0;
  const tasaNum = Number(tasaPactada.replace(",", ".")) || 0;

  const montoDestinoEstimado = useMemo(() => {
    if (!esCambioDivisas || !montoNum || !tasaNum) return null;
    if (origen?.moneda === "VES" && destino?.moneda === "USD") {
      return montoNum / tasaNum; // Bs / Tasa = USD
    }
    if (origen?.moneda === "USD" && destino?.moneda === "VES") {
      return montoNum * tasaNum; // USD * Tasa = Bs
    }
    return null;
  }, [esCambioDivisas, montoNum, tasaNum, origen, destino]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!origenId || !destinoId || origenId === destinoId) {
      toast.error("Selecciona cuentas distintas de origen y destino");
      return;
    }
    if (!montoNum || montoNum <= 0) {
      toast.error("Ingresa un monto válido");
      return;
    }
    if (esCambioDivisas && (!tasaNum || tasaNum <= 0)) {
      toast.error("Debes ingresar la tasa pactada para el cambio de divisas");
      return;
    }

    setGuardando(true);
    try {
      await apiPost("/bancos/transferencias", {
        empresaId,
        cuentaOrigenId: origenId,
        cuentaDestinoId: destinoId,
        fecha,
        monto: montoNum,
        concepto: concepto.trim() || "Traspaso entre cuentas",
        referencia: referencia.trim() || null,
        tasaPactada: esCambioDivisas ? tasaNum : null,
      });

      toast.success(
        esCambioDivisas
          ? "Operación de cambio de divisas registrada con éxito"
          : "Transferencia entre cuentas registrada con éxito"
      );
      onOpenChange(false);
      setMonto("");
      setReferencia("");
      onGuardado();
    } catch (err) {
      toast.error("Error al realizar la transferencia", {
        description: mensajeDeError(err, "Revisa los fondos y datos"),
      });
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Dialog open={abierto} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md w-full max-h-[90vh] overflow-y-auto">
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RepeatIcon className="size-5 text-primary" />
              <span>Transferir / Cambiar Divisas</span>
            </DialogTitle>
            <DialogDescription>
              Mueve fondos entre tus cuentas o realiza compra/venta de divisas con tasa pactada.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Cuenta Origen (de donde sale el dinero)</Label>
              <Select value={origenId} onValueChange={setOrigenId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {activas.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.nombre} ({c.moneda} - Saldo:{" "}
                      {c.moneda === "USD" ? formatUsd(c.saldoActual, 2) : formatBs(c.saldoActual)})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label>Cuenta Destino (a donde entra el dinero)</Label>
              <Select value={destinoId} onValueChange={setDestinoId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {activas
                    .filter((c) => c.id !== origenId)
                    .map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.nombre} ({c.moneda} - Saldo:{" "}
                        {c.moneda === "USD" ? formatUsd(c.saldoActual, 2) : formatBs(c.saldoActual)})
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            {esCambioDivisas && (
              <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-primary">
                  <ArrowUpDownIcon className="size-4" />
                  <span>
                    Cambio de divisas: {origen?.moneda} a {destino?.moneda}
                  </span>
                </div>

                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">Tasa pactada (Bs/USD) *</Label>
                    {tasaBcv && (
                      <button
                        type="button"
                        onClick={() => setTasaPactada(String(tasaBcv))}
                        className="text-[11px] text-primary hover:underline"
                      >
                        Tasa BCV ({formatNumero(tasaBcv, 2)})
                      </button>
                    )}
                  </div>
                  <Input
                    type="number"
                    step="0.0001"
                    placeholder="Ej. 52.45"
                    value={tasaPactada}
                    onChange={(e) => setTasaPactada(e.target.value)}
                    required
                  />
                </div>

                {montoDestinoEstimado != null && (
                  <div className="text-xs text-muted-foreground pt-1 border-t border-primary/20">
                    Se acreditarán aproximadamente:{" "}
                    <strong className="text-foreground font-mono">
                      {destino?.moneda === "USD"
                        ? formatUsd(montoDestinoEstimado, 2)
                        : formatBs(montoDestinoEstimado)}
                    </strong>{" "}
                    en {destino?.nombre}.
                  </div>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div className="space-y-1">
                <Label>Fecha</Label>
                <Input
                  type="date"
                  value={fecha}
                  onChange={(e) => setFecha(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-1">
                <Label>Monto a transferir ({origen?.moneda ?? "USD"})</Label>
                <Input
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  value={monto}
                  onChange={(e) => setMonto(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label>Concepto</Label>
              <Input
                placeholder="Traspaso de fondos o cambio de divisas"
                value={concepto}
                onChange={(e) => setConcepto(e.target.value)}
              />
            </div>

            <div className="space-y-1">
              <Label>Nro. de Referencia / Comprobante</Label>
              <Input
                placeholder="Opcional"
                value={referencia}
                onChange={(e) => setReferencia(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter className="gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={guardando}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={guardando}>
              {guardando ? "Procesando..." : "Confirmar transferencia"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// Dialogo de confirmación para anular movimiento con motivo
function AnularMovimientoDialog({
  movimiento,
  onOpenChange,
  onGuardado,
}: {
  movimiento: MovimientoBancario;
  onOpenChange: (open: boolean) => void;
  onGuardado: () => void;
}) {
  const [motivo, setMotivo] = useState("");
  const [anulando, setAnulando] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!motivo.trim()) {
      toast.error("Debes indicar un motivo de anulación");
      return;
    }

    setAnulando(true);
    try {
      await apiPost(`/bancos/movimientos/${movimiento.id}/anular`, {
        motivo: motivo.trim(),
      });
      toast.success("Movimiento anulado correctamente. Se generó el contra-asiento.");
      onOpenChange(false);
      onGuardado();
    } catch (err) {
      toast.error("No se pudo anular el movimiento", {
        description: mensajeDeError(err, "Intenta de nuevo"),
      });
    } finally {
      setAnulando(false);
    }
  }

  return (
    <Dialog open={true} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md w-full">
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertCircleIcon className="size-5" />
              <span>Anular Movimiento Bancario #{movimiento.id}</span>
            </DialogTitle>
            <DialogDescription>
              Esta acción revertirá el saldo de la cuenta {movimiento.cuentaNombre} generando un
              contra-asiento de auditoría. No se borrará del historial.
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-lg bg-muted/40 p-3 space-y-1.5 text-xs">
            <div>
              <span className="text-muted-foreground">Concepto:</span> {movimiento.concepto}
            </div>
            <div>
              <span className="text-muted-foreground">Monto:</span>{" "}
              <strong className="font-mono">
                {movimiento.cuentaMoneda === "USD"
                  ? formatUsd(movimiento.monto, 2)
                  : formatBs(movimiento.monto)}
              </strong>
            </div>
            <div>
              <span className="text-muted-foreground">Fecha:</span> {formatDate(movimiento.fecha)}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="motivo-anulacion">Motivo de la anulación *</Label>
            <Textarea
              id="motivo-anulacion"
              placeholder="Ej. Error en monto digitado, pago cancelado por el banco..."
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              rows={3}
              required
            />
          </div>

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={anulando}
            >
              Cancelar
            </Button>
            <Button type="submit" variant="destructive" disabled={anulando}>
              {anulando ? "Anulando..." : "Confirmar anulación"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
