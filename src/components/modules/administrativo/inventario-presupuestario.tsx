"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckIcon, Edit3Icon, FilterIcon, Loader2Icon, Settings2Icon, SlidersIcon } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiPost, mensajeDeError } from "@/lib/api-client";
import { formatNumero, formatUsd } from "@/lib/constants";
import type { ModoPresupuestario, Producto } from "@/lib/administrativo";
import { CostoPresupuestarioDialog } from "./inventario-costo-dialog";

export function CostoPresupuestarioPanel({
  empresaId,
  productos,
}: {
  empresaId: string;
  productos: Producto[];
}) {
  const router = useRouter();

  // Filtros de tabla
  const [buscar, setBuscar] = useState("");
  const [grupoFiltro, setGrupoFiltro] = useState("todos");

  // Configuración masiva
  const [masivoGrupo, setMasivoGrupo] = useState("todos");
  const [masivoModo, setMasivoModo] = useState<ModoPresupuestario>("SOBRE_PROMEDIO");
  const [masivoPct, setMasivoPct] = useState("10");
  const [masivoMonto, setMasivoMonto] = useState("");
  const [dialogMasivoAbierto, setDialogMasivoAbierto] = useState(false);
  const [guardandoMasivo, setGuardandoMasivo] = useState(false);

  // Lista de grupos únicos
  const grupos = useMemo(() => {
    const set = new Set<string>();
    for (const p of productos) {
      if (p.grupo) set.add(p.grupo);
    }
    return Array.from(set).sort();
  }, [productos]);

  // Productos filtrados
  const filtrados = useMemo(() => {
    const t = buscar.trim().toLowerCase();
    return productos.filter((p) => {
      if (grupoFiltro !== "todos" && p.grupo !== grupoFiltro) return false;
      if (!t) return true;
      return `${p.codigo} ${p.nombre} ${p.grupo ?? ""}`.toLowerCase().includes(t);
    });
  }, [productos, buscar, grupoFiltro]);

  // Cantidad de productos afectados por la regla masiva
  const productosAfectados = useMemo(() => {
    if (masivoGrupo === "todos") return productos.length;
    return productos.filter((p) => p.grupo === masivoGrupo).length;
  }, [productos, masivoGrupo]);

  // Aplicar masivo
  async function aplicarMasivo() {
    setGuardandoMasivo(true);
    try {
      const pctNum = parseFloat(masivoPct.replace(",", ".")) || 0;
      const montoNum = parseFloat(masivoMonto.replace(",", ".")) || null;

      await apiPost("/inventario/costos-presupuestarios/masivo", {
        empresaId,
        grupo: masivoGrupo === "todos" ? null : masivoGrupo,
        modo: masivoModo,
        porcentaje: masivoModo !== "MANUAL" ? pctNum : null,
        porcentajePresupuestario: masivoModo !== "MANUAL" ? pctNum : null,
        costoPresupuestarioCajaUsd: masivoModo === "MANUAL" ? montoNum : null,
      });

      toast.success(
        `Costo presupuestario actualizado en lote para ${productosAfectados} producto(s)`
      );
      setDialogMasivoAbierto(false);
      router.refresh();
    } catch (err) {
      toast.error("No se pudo aplicar la configuración masiva", {
        description: mensajeDeError(err, "Intenta de nuevo"),
      });
    } finally {
      setGuardandoMasivo(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Tarjeta de Configuración Masiva por Grupo */}
      <Card className="border-border">
        <CardHeader>
          <div className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-md bg-amber-500/10 text-amber-600">
              <SlidersIcon className="size-4" />
            </span>
            <div>
              <CardTitle className="text-base">Fijación Masiva de Costos Presupuestarios</CardTitle>
              <CardDescription className="text-xs">
                Aplica una regla de cálculo sobre toda la empresa o un grupo específico de productos
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="masivo-grupo">Grupo destino</Label>
              <select
                id="masivo-grupo"
                className="h-8 w-full rounded-md border border-input bg-transparent px-2.5 text-xs sm:text-sm"
                value={masivoGrupo}
                onChange={(e) => setMasivoGrupo(e.target.value)}
              >
                <option value="todos">Todos los productos ({productos.length})</option>
                {grupos.map((g) => (
                  <option key={g} value={g}>
                    {g} ({productos.filter((p) => p.grupo === g).length} productos)
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="masivo-modo">Método de cálculo</Label>
              <Select value={masivoModo} onValueChange={(v) => setMasivoModo(v as ModoPresupuestario)}>
                <SelectTrigger id="masivo-modo" className="h-8 text-xs sm:text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="SOBRE_PROMEDIO">Sobre Costo Promedio (CPP + %)</SelectItem>
                  <SelectItem value="SOBRE_ULTIMO">Sobre Último Costo (+ %)</SelectItem>
                  <SelectItem value="MANUAL">Monto fijo en USD</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {masivoModo === "MANUAL" ? (
              <div className="space-y-1.5">
                <Label htmlFor="masivo-monto">Monto fijo (USD / caja)</Label>
                <Input
                  id="masivo-monto"
                  type="text"
                  inputMode="decimal"
                  className="h-8 text-xs sm:text-sm"
                  value={masivoMonto}
                  onChange={(e) => setMasivoMonto(e.target.value)}
                  placeholder="0.00"
                />
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label htmlFor="masivo-pct">Porcentaje adicional (%)</Label>
                <Input
                  id="masivo-pct"
                  type="text"
                  inputMode="decimal"
                  className="h-8 text-xs sm:text-sm"
                  value={masivoPct}
                  onChange={(e) => setMasivoPct(e.target.value)}
                  placeholder="ej. 10"
                />
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <p className="text-xs text-muted-foreground">
              Afectará a <span className="font-semibold text-foreground">{productosAfectados}</span> producto(s). Los
              productos con cálculo porcentual se mantendrán sincronizados automáticamente ante nuevas entradas.
            </p>

            <Dialog open={dialogMasivoAbierto} onOpenChange={setDialogMasivoAbierto}>
              <DialogTrigger asChild>
                <Button size="sm" className="gap-1.5">
                  <Settings2Icon className="size-3.5" /> Aplicar regla masiva
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>Confirmar actualización masiva</DialogTitle>
                  <DialogDescription>
                    ¿Deseas aplicar la regla de costo presupuestario ({masivoModo}{" "}
                    {masivoModo !== "MANUAL" ? `+${masivoPct}%` : `$${masivoMonto}`}) a los{" "}
                    <strong>{productosAfectados}</strong> producto(s) seleccionados?
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter className="flex-row justify-end gap-2">
                  <Button variant="outline" onClick={() => setDialogMasivoAbierto(false)}>
                    Cancelar
                  </Button>
                  <Button onClick={aplicarMasivo} disabled={guardandoMasivo}>
                    {guardandoMasivo && <Loader2Icon className="mr-1.5 size-4 animate-spin" />}
                    Confirmar y aplicar
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardContent>
      </Card>

      {/* Tabla detallada por producto */}
      <div className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <Input
            className="w-full sm:w-72"
            placeholder="Buscar en catálogo..."
            value={buscar}
            onChange={(e) => setBuscar(e.target.value)}
            aria-label="Buscar producto"
          />
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="h-9 max-w-full rounded-md border border-input bg-transparent px-2.5 text-xs sm:text-sm"
              value={grupoFiltro}
              onChange={(e) => setGrupoFiltro(e.target.value)}
              aria-label="Filtrar por grupo"
            >
              <option value="todos">Todos los grupos</option>
              {grupos.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              {filtrados.length} productos
            </span>
          </div>
        </div>

        <div className="overflow-x-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30 text-xs">
                <TableHead className="w-16">Código</TableHead>
                <TableHead>Producto</TableHead>
                <TableHead>Grupo</TableHead>
                <TableHead className="text-right">Último Costo</TableHead>
                <TableHead className="text-right">Promedio SENIAT</TableHead>
                <TableHead>Modo Presupuestario</TableHead>
                <TableHead className="text-right">Costo Presupuestario</TableHead>
                <TableHead className="text-right">Acción</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="text-xs sm:text-sm">
              {filtrados.map((p) => {
                const modo = p.modoPresupuestario ?? "MANUAL";
                const u = p.unidadesPorCaja || 1;
                return (
                  <TableRow key={p.id} className="hover:bg-muted/20">
                    <TableCell className="font-mono text-muted-foreground tabular-nums">
                      {p.codigo}
                    </TableCell>
                    <TableCell className="font-medium text-foreground">
                      {p.nombre}
                      <span className="block text-[11px] text-muted-foreground">{u} und/caja</span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{p.grupo ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatUsd(p.ultimoCostoCajaUsd, 2)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatUsd(p.costoPromedioCajaUsd, 2)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[11px] font-normal">
                        {modo === "MANUAL"
                          ? "Manual"
                          : modo === "SOBRE_ULTIMO"
                          ? `Último +${p.porcentajePresupuestario ?? 0}%`
                          : `Promedio +${p.porcentajePresupuestario ?? 0}%`}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-semibold text-foreground">
                      {formatUsd(p.costoPresupuestarioCajaUsd, 2)}
                      {u > 1 && p.costoPresupuestarioCajaUsd != null && (
                        <span className="block text-[11px] font-normal text-muted-foreground">
                          {formatUsd(p.costoPresupuestarioCajaUsd / u, 2)}/und
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      <CostoPresupuestarioDialog
                        productoId={p.id}
                        codigo={p.codigo}
                        nombre={p.nombre}
                        ultimoCostoUsd={p.ultimoCostoCajaUsd}
                        costoPromedioUsd={p.costoPromedioCajaUsd}
                        costoPresupuestarioActualUsd={p.costoPresupuestarioCajaUsd}
                        modoActual={p.modoPresupuestario}
                        porcentajeActual={p.porcentajePresupuestario}
                        onActualizado={() => router.refresh()}
                      >
                        <Button variant="ghost" size="sm" className="h-7 text-xs">
                          <Edit3Icon className="mr-1 size-3" /> Configurar
                        </Button>
                      </CostoPresupuestarioDialog>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
