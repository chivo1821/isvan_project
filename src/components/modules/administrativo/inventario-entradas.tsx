"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDownLeftIcon, ArrowUpRightIcon, FileSpreadsheetIcon, Loader2Icon, PlusIcon, UploadIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiPost, apiPostForm, mensajeDeError } from "@/lib/api-client";
import { formatNumero, formatUsd } from "@/lib/constants";
import type { Existencia, Producto } from "@/lib/administrativo";

type Almacen = { id: string; nombre: string };

type VistaExcel = {
  renglones: {
    fila: number;
    codigo: number;
    nombre: string;
    cajas: number;
    costoUsd?: number | null;
    lote: string | null;
    vencimiento: string | null;
  }[];
  problemas: { fila: number; motivo: string }[];
};

export function EntradasYRetiros({
  empresaId,
  almacenes,
  existencias,
  productos,
}: {
  empresaId: string;
  almacenes: Almacen[];
  existencias: Existencia[];
  productos: Producto[];
}) {
  const router = useRouter();

  // --- Entrada Manual ---
  const [manualAlmacenId, setManualAlmacenId] = useState(almacenes[0]?.id ?? "");
  const [manualProductoId, setManualProductoId] = useState(productos[0]?.id ?? "");
  const [manualCajas, setManualCajas] = useState("");
  const [manualCostoUsd, setManualCostoUsd] = useState("");
  const [manualCostoBs, setManualCostoBs] = useState("");
  const [manualProveedor, setManualProveedor] = useState("");
  const [manualFactura, setManualFactura] = useState("");
  const [manualLote, setManualLote] = useState("");
  const [manualVence, setManualVence] = useState("");
  const [manualRef, setManualRef] = useState("Compra nacional");
  const [guardandoManual, setGuardandoManual] = useState(false);

  // --- Retiro / Autoconsumo ---
  const [retiroTipo, setRetiroTipo] = useState<"RETIRO" | "AUTOCONSUMO">("RETIRO");
  const [retiroAlmacenId, setRetiroAlmacenId] = useState(almacenes[0]?.id ?? "");
  const [retiroLoteId, setRetiroLoteId] = useState("");
  const [retiroCajas, setRetiroCajas] = useState("");
  const [retiroMotivo, setRetiroMotivo] = useState("");
  const [guardandoRetiro, setGuardandoRetiro] = useState(false);

  // --- Excel ---
  const [excelAlmacenId, setExcelAlmacenId] = useState(almacenes[0]?.id ?? "");
  const [excelArchivo, setExcelArchivo] = useState<File | null>(null);
  const [excelReferencia, setExcelReferencia] = useState("Recepción de mercancía");
  const [excelVista, setExcelVista] = useState<VistaExcel | null>(null);
  const [procesandoExcel, setProcesandoExcel] = useState(false);

  // Opciones de lotes para retiro
  const opcionesRetiro = useMemo(() => {
    return existencias
      .filter((e) => e.almacenId === retiroAlmacenId)
      .flatMap((e) =>
        e.lotes.map((l) => ({
          ...l,
          productoId: e.productoId,
          nombre: e.nombre,
          codigo: e.codigo,
        }))
      );
  }, [existencias, retiroAlmacenId]);

  const loteElegido = opcionesRetiro.find((o) => o.loteId === retiroLoteId);

  // Handler de Entrada Manual
  async function registrarEntradaManual() {
    const cajasNum = parseFloat(manualCajas.replace(",", "."));
    if (!cajasNum || cajasNum <= 0) {
      toast.error("Indica una cantidad de cajas válida mayor a cero");
      return;
    }
    const costoUsdNum = manualCostoUsd ? parseFloat(manualCostoUsd.replace(",", ".")) : null;
    const costoBsNum = manualCostoBs ? parseFloat(manualCostoBs.replace(",", ".")) : null;

    setGuardandoManual(true);
    try {
      await apiPost("/inventario/entradas", {
        empresaId,
        almacenId: manualAlmacenId,
        referencia: manualRef.trim() || "Entrada manual",
        proveedor: manualProveedor.trim() || null,
        numeroFacturaCompra: manualFactura.trim() || null,
        items: [
          {
            productoId: manualProductoId,
            cajas: cajasNum,
            costoCajaUsd: costoUsdNum,
            costoCajaBs: costoBsNum,
            lote: manualLote.trim() || null,
            vencimiento: manualVence || null,
          },
        ],
      });

      toast.success("Entrada registrada con éxito");
      setManualCajas("");
      setManualCostoUsd("");
      setManualCostoBs("");
      setManualLote("");
      setManualVence("");
      setManualFactura("");
      router.refresh();
    } catch (err) {
      toast.error("No se pudo registrar la entrada", {
        description: mensajeDeError(err, "Revisa los campos del formulario"),
      });
    } finally {
      setGuardandoManual(false);
    }
  }

  // Handler de Retiro / Autoconsumo
  async function registrarRetiro() {
    if (!loteElegido) {
      toast.error("Selecciona el lote a retirar");
      return;
    }
    const cajasNum = parseFloat(retiroCajas.replace(",", "."));
    if (!cajasNum || cajasNum <= 0) {
      toast.error("Indica una cantidad de cajas mayor a cero");
      return;
    }
    if (cajasNum > loteElegido.cajas) {
      toast.error(`La cantidad no puede superar las existencias del lote (${loteElegido.cajas} cajas)`);
      return;
    }
    if (retiroMotivo.trim().length < 3) {
      toast.error("Indica el motivo detallado de la operación");
      return;
    }

    setGuardandoRetiro(true);
    try {
      await apiPost("/inventario/retiros", {
        empresaId,
        almacenId: retiroAlmacenId,
        tipo: retiroTipo,
        motivo: retiroMotivo.trim(),
        items: [
          {
            productoId: loteElegido.productoId,
            loteId: loteElegido.loteId,
            cajas: cajasNum,
          },
        ],
        // Compatibilidad con endpoints que reciban plano
        productoId: loteElegido.productoId,
        loteId: loteElegido.loteId,
        cajas: cajasNum,
      });

      toast.success(`${retiroTipo === "RETIRO" ? "Retiro" : "Autoconsumo"} procesado (descargado a CPP)`);
      setRetiroCajas("");
      setRetiroMotivo("");
      setRetiroLoteId("");
      router.refresh();
    } catch (err) {
      toast.error("No se pudo procesar el retiro", {
        description: mensajeDeError(err, "Intenta de nuevo"),
      });
    } finally {
      setGuardandoRetiro(false);
    }
  }

  // Handler de Excel
  async function enviarExcel(confirmar: boolean, f: File | null = excelArchivo) {
    if (!f) return;
    setProcesandoExcel(true);
    const form = new FormData();
    form.append("archivo", f);
    const q = new URLSearchParams({
      empresaId,
      almacenId: excelAlmacenId,
      referencia: excelReferencia,
      confirmar: String(confirmar),
    });
    try {
      const r = await apiPostForm<VistaExcel>(`/inventario/entradas/excel?${q}`, form);
      if (confirmar) {
        toast.success(`${r.renglones.length} renglón(es) cargados al inventario`);
        setExcelVista(null);
        setExcelArchivo(null);
        router.refresh();
      } else {
        setExcelVista(r);
      }
    } catch (err) {
      toast.error("Error al procesar el Excel", {
        description: mensajeDeError(err, "Revisa el formato del archivo"),
      });
    } finally {
      setProcesandoExcel(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Panel 1: Entrada Manual Valorada */}
        <Card className="border-border">
          <CardHeader>
            <div className="flex items-center gap-2">
              <span className="flex size-7 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-600">
                <ArrowDownLeftIcon className="size-4" />
              </span>
              <div>
                <CardTitle className="text-base">Entrada Manual Valorada</CardTitle>
                <CardDescription className="text-xs">
                  Recepción de compras con costo por caja para actualizar Costo Promedio y Último Costo
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="ent-almacen">Almacén destino</Label>
                <select
                  id="ent-almacen"
                  className="h-8 w-full rounded-md border border-input bg-transparent px-2.5 text-xs sm:text-sm"
                  value={manualAlmacenId}
                  onChange={(e) => setManualAlmacenId(e.target.value)}
                >
                  {almacenes.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.nombre}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="ent-ref">Referencia / Motivo</Label>
                <Input
                  id="ent-ref"
                  className="h-8 text-xs sm:text-sm"
                  value={manualRef}
                  onChange={(e) => setManualRef(e.target.value)}
                  placeholder="ej. Compra nacional"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="ent-prov">Proveedor (opcional)</Label>
                <Input
                  id="ent-prov"
                  className="h-8 text-xs sm:text-sm"
                  value={manualProveedor}
                  onChange={(e) => setManualProveedor(e.target.value)}
                  placeholder="ej. Distribuidora Polar C.A."
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ent-fact">Nº Factura de compra</Label>
                <Input
                  id="ent-fact"
                  className="h-8 text-xs sm:text-sm"
                  value={manualFactura}
                  onChange={(e) => setManualFactura(e.target.value)}
                  placeholder="ej. 0004812"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ent-prod">Producto</Label>
              <select
                id="ent-prod"
                className="h-8 w-full rounded-md border border-input bg-transparent px-2.5 text-xs sm:text-sm"
                value={manualProductoId}
                onChange={(e) => setManualProductoId(e.target.value)}
              >
                {productos.map((p) => (
                  <option key={p.id} value={p.id}>
                    #{p.codigo} — {p.nombre} ({p.unidadesPorCaja} und/caja)
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="ent-cajas">Cajas</Label>
                <Input
                  id="ent-cajas"
                  type="text"
                  inputMode="decimal"
                  className="h-8 text-xs sm:text-sm"
                  value={manualCajas}
                  onChange={(e) => setManualCajas(e.target.value)}
                  placeholder="0.00"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ent-costo-usd">Costo / caja (USD)</Label>
                <Input
                  id="ent-costo-usd"
                  type="text"
                  inputMode="decimal"
                  className="h-8 text-xs sm:text-sm"
                  value={manualCostoUsd}
                  onChange={(e) => setManualCostoUsd(e.target.value)}
                  placeholder="0.00"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ent-costo-bs">Costo / caja (Bs, opc.)</Label>
                <Input
                  id="ent-costo-bs"
                  type="text"
                  inputMode="decimal"
                  className="h-8 text-xs sm:text-sm"
                  value={manualCostoBs}
                  onChange={(e) => setManualCostoBs(e.target.value)}
                  placeholder="0.00"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="ent-lote">Número de Lote (opcional)</Label>
                <Input
                  id="ent-lote"
                  className="h-8 text-xs sm:text-sm"
                  value={manualLote}
                  onChange={(e) => setManualLote(e.target.value)}
                  placeholder="ej. L-2026-09"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ent-vence">Fecha Vencimiento (opcional)</Label>
                <Input
                  id="ent-vence"
                  type="date"
                  className="h-8 text-xs sm:text-sm"
                  value={manualVence}
                  onChange={(e) => setManualVence(e.target.value)}
                />
              </div>
            </div>

            <Button
              className="w-full sm:w-auto"
              onClick={registrarEntradaManual}
              disabled={guardandoManual || !manualProductoId || !manualCajas}
            >
              {guardandoManual ? (
                <Loader2Icon className="mr-2 size-4 animate-spin" />
              ) : (
                <PlusIcon className="mr-2 size-4" />
              )}
              Registrar entrada
            </Button>
          </CardContent>
        </Card>

        {/* Panel 2: Retiro / Autoconsumo */}
        <Card className="border-border">
          <CardHeader>
            <div className="flex items-center gap-2">
              <span className="flex size-7 items-center justify-center rounded-md bg-amber-500/10 text-amber-600">
                <ArrowUpRightIcon className="size-4" />
              </span>
              <div>
                <CardTitle className="text-base">Retiro o Autoconsumo</CardTitle>
                <CardDescription className="text-xs">
                  Descarga física y contable al Costo Promedio Ponderado vigente (Art. 177 RISLR)
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="ret-tipo">Tipo de movimiento</Label>
                <Select value={retiroTipo} onValueChange={(v) => setRetiroTipo(v as "RETIRO" | "AUTOCONSUMO")}>
                  <SelectTrigger id="ret-tipo" className="h-8 text-xs sm:text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="RETIRO">Retiro (Merma, Avería, Pérdida)</SelectItem>
                    <SelectItem value="AUTOCONSUMO">Autoconsumo / Uso Interno</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="ret-almacen">Almacén origen</Label>
                <select
                  id="ret-almacen"
                  className="h-8 w-full rounded-md border border-input bg-transparent px-2.5 text-xs sm:text-sm"
                  value={retiroAlmacenId}
                  onChange={(e) => {
                    setRetiroAlmacenId(e.target.value);
                    setRetiroLoteId("");
                  }}
                >
                  {almacenes.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.nombre}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ret-lote">Producto y lote a descargar</Label>
              <select
                id="ret-lote"
                className="h-8 w-full rounded-md border border-input bg-transparent px-2.5 text-xs sm:text-sm"
                value={retiroLoteId}
                onChange={(e) => setRetiroLoteId(e.target.value)}
              >
                <option value="">Selecciona producto y lote...</option>
                {opcionesRetiro.map((o) => (
                  <option key={o.loteId} value={o.loteId}>
                    #{o.codigo} {o.nombre} — Lote: {o.lote} ({formatNumero(o.cajas, 2)} cajas disp.)
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ret-cajas">Cajas a descargar</Label>
              <Input
                id="ret-cajas"
                type="text"
                inputMode="decimal"
                className="h-8 text-xs sm:text-sm"
                value={retiroCajas}
                onChange={(e) => setRetiroCajas(e.target.value)}
                placeholder={loteElegido ? `Máx: ${loteElegido.cajas}` : "0.00"}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ret-motivo">Motivo justificado (obligatorio)</Label>
              <Input
                id="ret-motivo"
                className="h-8 text-xs sm:text-sm"
                value={retiroMotivo}
                onChange={(e) => setRetiroMotivo(e.target.value)}
                placeholder="ej. Muestra comercial, merma por rotura de empaque..."
              />
            </div>

            <Button
              variant="secondary"
              className="w-full sm:w-auto"
              onClick={registrarRetiro}
              disabled={guardandoRetiro || !loteElegido || !retiroCajas || retiroMotivo.trim().length < 3}
            >
              {guardandoRetiro && <Loader2Icon className="mr-2 size-4 animate-spin" />}
              Procesar {retiroTipo === "RETIRO" ? "retiro" : "autoconsumo"}
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Panel 3: Carga Masiva desde Excel */}
      <Card className="border-border">
        <CardHeader>
          <div className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-md bg-blue-500/10 text-blue-600">
              <FileSpreadsheetIcon className="size-4" />
            </span>
            <div>
              <CardTitle className="text-base">Carga Masiva desde Excel</CardTitle>
              <CardDescription className="text-xs">
                Importación rápida para conteo inicial o recepción de compras por lote
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Formato de columnas soportado:{" "}
            <span className="font-semibold text-foreground">
              Código del producto (A) | Cajas (B) | Lote (C, opcional) | Vencimiento (D, dd/mm/aaaa, opcional) | Costo USD (E, opcional)
            </span>
            .
          </p>

          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="exc-alm" className="text-xs">
                Almacén
              </Label>
              <select
                id="exc-alm"
                className="h-8 rounded-md border border-input bg-transparent px-2.5 text-xs sm:text-sm"
                value={excelAlmacenId}
                onChange={(e) => setExcelAlmacenId(e.target.value)}
              >
                {almacenes.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.nombre}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <Label htmlFor="exc-ref" className="text-xs">
                Referencia
              </Label>
              <Input
                id="exc-ref"
                className="h-8 w-48 text-xs sm:text-sm"
                value={excelReferencia}
                onChange={(e) => setExcelReferencia(e.target.value)}
              />
            </div>

            <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-input bg-muted/20 px-3 text-xs sm:text-sm hover:bg-muted/40">
              <UploadIcon className="size-3.5" />
              {excelArchivo ? excelArchivo.name : "Seleccionar .xlsx"}
              <input
                type="file"
                accept=".xlsx"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  setExcelArchivo(f);
                  setExcelVista(null);
                  if (f) enviarExcel(false, f);
                }}
              />
            </label>

            {procesandoExcel && (
              <span className="flex items-center text-xs text-muted-foreground">
                <Loader2Icon className="mr-1 size-3.5 animate-spin" /> Procesando archivo...
              </span>
            )}
          </div>

          {excelVista && (
            <div className="space-y-3 rounded-lg border border-border bg-muted/10 p-3 text-xs sm:text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">
                  {excelVista.renglones.length} renglón(es) listos
                  {excelVista.problemas.length > 0 && (
                    <span className="text-destructive font-semibold">
                      {" "}· {excelVista.problemas.length} con problemas
                    </span>
                  )}
                </p>
                <Button
                  size="sm"
                  onClick={() => enviarExcel(true)}
                  disabled={excelVista.problemas.length > 0 || excelVista.renglones.length === 0 || procesandoExcel}
                >
                  Confirmar entrada al inventario
                </Button>
              </div>

              {excelVista.problemas.length > 0 && (
                <div className="max-h-32 overflow-y-auto rounded bg-destructive/10 p-2 text-xs text-destructive space-y-1">
                  {excelVista.problemas.slice(0, 15).map((p) => (
                    <p key={p.fila}>
                      Fila {p.fila}: {p.motivo}
                    </p>
                  ))}
                  {excelVista.problemas.length > 15 && (
                    <p className="font-medium">... y {excelVista.problemas.length - 15} errores más.</p>
                  )}
                </div>
              )}

              {excelVista.renglones.length > 0 && (
                <div className="max-h-48 overflow-y-auto rounded border border-border">
                  <Table>
                    <TableHeader>
                      <TableRow className="text-xs">
                        <TableHead>Código</TableHead>
                        <TableHead>Producto</TableHead>
                        <TableHead className="text-right">Cajas</TableHead>
                        <TableHead>Lote</TableHead>
                        <TableHead>Vencimiento</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody className="text-xs">
                      {excelVista.renglones.slice(0, 50).map((r) => (
                        <TableRow key={r.fila}>
                          <TableCell className="tabular-nums font-mono text-muted-foreground">{r.codigo}</TableCell>
                          <TableCell className="font-medium">{r.nombre}</TableCell>
                          <TableCell className="text-right font-semibold tabular-nums">{formatNumero(r.cajas, 2)}</TableCell>
                          <TableCell>{r.lote ?? "—"}</TableCell>
                          <TableCell>{r.vencimiento ? String(r.vencimiento) : "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
