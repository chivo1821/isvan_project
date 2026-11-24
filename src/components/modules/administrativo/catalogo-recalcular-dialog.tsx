"use client";

import { useMemo, useState } from "react";
import { CalculatorIcon, CheckIcon, Loader2Icon, SparklesIcon } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiPost, mensajeDeError } from "@/lib/api-client";
import { formatNumero, formatPct, formatUsd } from "@/lib/constants";
import type { BaseCosto, ListaPrecio, MetodoMargen, PrecioProducto } from "@/lib/administrativo";

type ItemRecalculo = {
  productoId: string;
  codigo: number;
  nombre: string;
  costoBaseUsd: number;
  precioAnteriorUsd: number | null;
  nuevoPrecioUsd: number;
  margenPct: number;
  utilidadUsd: number;
};

export function RecalcularPreciosDialog({
  lista,
  grupos,
  onPreciosActualizados,
}: {
  lista: ListaPrecio;
  grupos: string[];
  onPreciosActualizados: () => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [baseCosto, setBaseCosto] = useState<BaseCosto>(lista.baseCostoPorDefecto ?? "PROMEDIO");
  const [metodoMargen, setMetodoMargen] = useState<MetodoMargen>(lista.metodoMargen ?? "SOBRE_VENTA");
  const [margenPct, setMargenPct] = useState<string>(
    lista.margenObjetivoPct != null ? String(lista.margenObjetivoPct) : "25"
  );
  const [grupo, setGrupo] = useState<string>("todos");

  const [previsualizando, setPrevisualizando] = useState(false);
  const [aplicando, setAplicando] = useState(false);
  const [vistaPrevia, setVistaPrevia] = useState<ItemRecalculo[] | null>(null);
  const [omitidosSinCosto, setOmitidosSinCosto] = useState<number>(0);

  async function ejecutar(confirmar: boolean) {
    const pct = parseFloat(margenPct.replace(",", "."));
    if (Number.isNaN(pct) || pct <= 0) {
      toast.error("Ingresa un porcentaje de margen válido mayor a cero");
      return;
    }

    if (confirmar) setAplicando(true);
    else setPrevisualizando(true);

    try {
      const cuerpo = {
        baseCosto,
        metodoMargen,
        margenPct: pct,
        grupo: grupo === "todos" ? null : grupo,
        confirmar,
      };

      type RespuestaRecalculo =
        | (Partial<ItemRecalculo> & { id?: string; costo?: number; precioCajaUsd?: number | null; precioCalculado?: number })[]
        | {
            actualizados?: number;
            omitidosSinCosto?: number;
            precios?: ItemRecalculo[];
            renglones?: ItemRecalculo[];
            cambios?: ItemRecalculo[];
          };

      const res = await apiPost<RespuestaRecalculo>(`/catalogo/listas/${lista.id}/recalcular-precios`, cuerpo);

      if (confirmar) {
        const count = Array.isArray(res)
          ? res.length
          : res?.actualizados ?? res?.renglones?.length ?? vistaPrevia?.length ?? 0;
        const omitidos = Array.isArray(res) ? 0 : res?.omitidosSinCosto ?? 0;
        if (count === 0 && omitidos > 0) {
          toast.warning(`No se actualizó ningún precio (${omitidos} producto(s) sin costo en la base elegida)`);
        } else {
          toast.success(`Precios recalculados y aplicados a la lista (${count} productos)`);
        }
        setAbierto(false);
        setVistaPrevia(null);
        setOmitidosSinCosto(0);
        onPreciosActualizados();
      } else {
        // Normalizar la respuesta de vista previa: puede ser array directo o estar bajo una llave
        let items: ItemRecalculo[] = [];
        const omitidos = Array.isArray(res) ? 0 : res?.omitidosSinCosto ?? 0;
        if (Array.isArray(res)) {
          items = res.map((r) => ({
            productoId: r.productoId ?? r.id ?? "",
            codigo: r.codigo ?? 0,
            nombre: r.nombre ?? "",
            costoBaseUsd: r.costoBaseUsd ?? r.costo ?? 0,
            precioAnteriorUsd: r.precioAnteriorUsd ?? r.precioCajaUsd ?? null,
            nuevoPrecioUsd: r.nuevoPrecioUsd ?? r.precioCalculado ?? r.precioCajaUsd ?? 0,
            margenPct: r.margenPct ?? pct,
            utilidadUsd: r.utilidadUsd ?? 0,
          }));
        } else if (res?.precios && Array.isArray(res.precios)) {
          items = res.precios;
        } else if (res?.renglones && Array.isArray(res.renglones)) {
          items = res.renglones;
        } else if (res?.cambios && Array.isArray(res.cambios)) {
          items = res.cambios;
        }
        setVistaPrevia(items);
        setOmitidosSinCosto(omitidos);
        if (items.length === 0 && omitidos > 0) {
          toast.warning(`0 productos calculados: ${omitidos} producto(s) no tienen costo cargado en esta base`, {
            description:
              "Carga una entrada con costo en Inventario, define el Costo Presupuestario o pulsa «Traer del extracto» para importar el último costo.",
          });
        } else {
          toast.info(
            `${items.length} productos calculados${omitidos > 0 ? ` (${omitidos} omitidos sin costo)` : ""}`
          );
        }
      }
    } catch (err) {
      toast.error(confirmar ? "No se pudieron aplicar los precios" : "No se pudo generar la vista previa", {
        description: mensajeDeError(err, "Verifica los parámetros"),
      });
    } finally {
      setPrevisualizando(false);
      setAplicando(false);
    }
  }

  return (
    <Dialog
      open={abierto}
      onOpenChange={(v) => {
        setAbierto(v);
        if (!v) setVistaPrevia(null);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
          <SparklesIcon className="size-3.5 text-amber-500" />
          Calcular precios desde costo
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] sm:max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <CalculatorIcon className="size-4 text-primary" />
            Calcular Precios Automáticos desde Costo
          </DialogTitle>
          <DialogDescription className="text-xs">
            Lista: <strong>{lista.codigo} — {lista.nombre}</strong>. Genera los precios de venta en USD según el margen deseado.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2 text-sm">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="rec-base">Base de costo a utilizar</Label>
              <Select value={baseCosto} onValueChange={(v) => setBaseCosto(v as BaseCosto)}>
                <SelectTrigger id="rec-base" className="h-8 text-xs sm:text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PROMEDIO">Costo Promedio (SENIAT - Fiscal)</SelectItem>
                  <SelectItem value="ULTIMO">Último Costo (Reposición)</SelectItem>
                  <SelectItem value="PRESUPUESTARIO">Costo Presupuestario</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="rec-metodo">Método de cálculo de margen</Label>
              <Select value={metodoMargen} onValueChange={(v) => setMetodoMargen(v as MetodoMargen)}>
                <SelectTrigger id="rec-metodo" className="h-8 text-xs sm:text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="SOBRE_VENTA">Margen sobre Venta: (P - C) / P</SelectItem>
                  <SelectItem value="SOBRE_COSTO">Margen sobre Costo (Markup): (P - C) / C</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="rec-pct">Margen deseado (%)</Label>
              <Input
                id="rec-pct"
                type="text"
                inputMode="decimal"
                className="h-8 text-xs sm:text-sm"
                value={margenPct}
                onChange={(e) => setMargenPct(e.target.value)}
                placeholder="ej. 25"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="rec-grupo">Grupo de productos</Label>
              <select
                id="rec-grupo"
                className="h-8 w-full rounded-md border border-input bg-transparent px-2.5 text-xs sm:text-sm"
                value={grupo}
                onChange={(e) => setGrupo(e.target.value)}
              >
                <option value="todos">Todos los grupos del catálogo</option>
                {grupos.map((g) => (
                  <option key={g} value={g}>
                    Grupo: {g}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => ejecutar(false)}
              disabled={previsualizando || aplicando}
              className="gap-1.5 text-xs"
            >
              {previsualizando && <Loader2Icon className="size-3.5 animate-spin" />}
              Previsualizar cambios
            </Button>
          </div>

          {/* Tabla de Vista Previa */}
          {vistaPrevia && (
            <div className="space-y-2 rounded-lg border border-border p-3 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold text-foreground">
                  Vista Previa ({vistaPrevia.length} productos calculados
                  {omitidosSinCosto > 0 ? ` · ${omitidosSinCosto} sin costo` : ""})
                </p>
                <span className="text-[11px] text-muted-foreground">
                  Base: {baseCosto} · Método: {metodoMargen}
                </span>
              </div>

              {vistaPrevia.length === 0 ? (
                <p className="py-4 text-center text-muted-foreground">
                  {omitidosSinCosto > 0
                    ? `${omitidosSinCosto} producto(s) omitidos porque no tienen costo cargado en la base ${baseCosto}. Registra una entrada con costo en Inventario, define el Costo Presupuestario o pulsa «Traer del extracto» en Productos.`
                    : "No se encontraron productos para recalcular en este grupo o con costos mayores a cero."}
                </p>
              ) : (
                <div className="max-h-56 overflow-y-auto rounded border border-border">
                  <Table>
                    <TableHeader className="bg-muted/40 text-[11px]">
                      <TableRow>
                        <TableHead>Código</TableHead>
                        <TableHead>Producto</TableHead>
                        <TableHead className="text-right">Costo Base</TableHead>
                        <TableHead className="text-right">Precio Actual</TableHead>
                        <TableHead className="text-right font-bold text-foreground">Nuevo Precio</TableHead>
                        <TableHead className="text-right">Margen</TableHead>
                        <TableHead className="text-right">Utilidad</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody className="text-xs">
                      {vistaPrevia.slice(0, 50).map((item) => (
                        <TableRow key={item.productoId}>
                          <TableCell className="font-mono text-muted-foreground">{item.codigo}</TableCell>
                          <TableCell className="font-medium">{item.nombre}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatUsd(item.costoBaseUsd, 2)}</TableCell>
                          <TableCell className="text-right tabular-nums text-muted-foreground">
                            {item.precioAnteriorUsd != null ? formatUsd(item.precioAnteriorUsd, 2) : "—"}
                          </TableCell>
                          <TableCell className="text-right font-bold tabular-nums text-primary">
                            {formatUsd(item.nuevoPrecioUsd, 2)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatNumero(item.margenPct, 1)}%
                          </TableCell>
                          <TableCell className="text-right tabular-nums font-medium text-emerald-600 dark:text-emerald-400">
                            +{formatUsd(item.utilidadUsd, 2)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="flex-row flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={() => setAbierto(false)} disabled={aplicando}>
            Cancelar
          </Button>
          <Button onClick={() => ejecutar(true)} disabled={aplicando || previsualizando}>
            {aplicando ? <Loader2Icon className="mr-1.5 size-4 animate-spin" /> : <CheckIcon className="mr-1.5 size-4" />}
            Confirmar y aplicar precios
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
