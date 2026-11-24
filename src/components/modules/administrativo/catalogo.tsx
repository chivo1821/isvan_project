"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangleIcon, CheckCircle2Icon, RefreshCwIcon, SearchIcon, UploadIcon } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiGet, apiPost, apiPostForm, apiPut, mensajeDeError } from "@/lib/api-client";
import { formatNumero, formatUsd } from "@/lib/constants";
import { IMPUESTO, type ClienteFiscal, type ListaPrecio, type PrecioProducto, type Producto } from "@/lib/administrativo";
import { ListaConfigDialog } from "./catalogo-lista-config";
import { RecalcularPreciosDialog } from "./catalogo-recalcular-dialog";

const VACIO = {
  codigo: "",
  nombre: "",
  grupo: "",
  codigoProveedor: "",
  unidadesPorCaja: "1",
  litrosPorUnidad: "",
  pesoCajaKg: "",
  impuestoCodigo: "IVA_GENERAL",
  requiereFrio: true,
  manejaLote: true,
  activo: true,
};

function ProductoDialog({ empresaId, producto, children }: { empresaId: string; producto?: Producto; children: React.ReactNode }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const inicial = producto
    ? {
        ...producto,
        codigo: String(producto.codigo),
        grupo: producto.grupo ?? "",
        codigoProveedor: producto.codigoProveedor ?? "",
        unidadesPorCaja: String(producto.unidadesPorCaja),
        litrosPorUnidad: producto.litrosPorUnidad?.toString() ?? "",
        pesoCajaKg: producto.pesoCajaKg?.toString() ?? "",
      }
    : VACIO;
  const [d, setD] = useState(inicial);
  const cambiar = (c: string, v: unknown) => setD((x) => ({ ...x, [c]: v }));

  async function guardar() {
    const cuerpo = {
      codigo: Number(d.codigo),
      nombre: d.nombre,
      grupo: d.grupo || null,
      codigoProveedor: d.codigoProveedor || null,
      unidadesPorCaja: Number(d.unidadesPorCaja || 1),
      litrosPorUnidad: d.litrosPorUnidad ? Number(d.litrosPorUnidad) : null,
      pesoCajaKg: d.pesoCajaKg ? Number(d.pesoCajaKg) : null,
      impuestoCodigo: d.impuestoCodigo,
      requiereFrio: d.requiereFrio,
      manejaLote: d.manejaLote,
      activo: d.activo,
    };
    try {
      if (producto) await apiPut(`/catalogo/productos/${producto.id}`, cuerpo);
      else await apiPost(`/catalogo/productos?empresaId=${empresaId}`, cuerpo);
      toast.success(producto ? "Producto actualizado" : "Producto creado");
      setAbierto(false);
      router.refresh();
    } catch (err) {
      toast.error("No se pudo guardar", { description: mensajeDeError(err, "Revisa los datos") });
    }
  }

  const campo = (c: keyof typeof VACIO, label: string, props: React.ComponentProps<typeof Input> = {}) => (
    <div className="space-y-1.5">
      <Label htmlFor={`p-${c}`}>{label}</Label>
      <Input id={`p-${c}`} value={String(d[c])} onChange={(e) => cambiar(c, e.target.value)} {...props} />
    </div>
  );

  return (
    <Dialog open={abierto} onOpenChange={(v) => { setAbierto(v); if (v) setD(inicial); }}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{producto ? `Editar ${producto.nombre}` : "Nuevo producto"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          {campo("codigo", "Código (el del sistema de ventas)", { inputMode: "numeric", disabled: !!producto })}
          {campo("nombre", "Nombre")}
          {campo("grupo", "Grupo")}
          {campo("codigoProveedor", "Código del proveedor")}
          {campo("unidadesPorCaja", "Unidades por caja", { inputMode: "numeric" })}
          {campo("litrosPorUnidad", "Litros por unidad", { inputMode: "decimal" })}
          {campo("pesoCajaKg", "Peso de la caja (kg)", { inputMode: "decimal" })}
          <div className="space-y-1.5">
            <Label htmlFor="p-impuesto">Impuesto</Label>
            <select
              id="p-impuesto"
              className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm"
              value={d.impuestoCodigo}
              onChange={(e) => cambiar("impuestoCodigo", e.target.value)}
            >
              {Object.entries(IMPUESTO).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex flex-wrap gap-4 text-sm">
          {(["requiereFrio", "manejaLote", "activo"] as const).map((c) => (
            <label key={c} className="flex items-center gap-2">
              <Checkbox checked={d[c]} onCheckedChange={(v) => cambiar(c, v === true)} />
              {{ requiereFrio: "Requiere frío", manejaLote: "Maneja lote y vencimiento", activo: "Activo" }[c]}
            </label>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setAbierto(false)}>
            Cancelar
          </Button>
          <Button onClick={guardar} disabled={!d.codigo || !d.nombre}>
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ProductosTabla({ empresaId, productos }: { empresaId: string; productos: Producto[] }) {
  const router = useRouter();
  const [buscar, setBuscar] = useState("");
  const [sincronizando, setSincronizando] = useState(false);
  const filtrados = useMemo(() => {
    const t = buscar.trim().toLowerCase();
    return t ? productos.filter((p) => `${p.codigo} ${p.nombre} ${p.grupo ?? ""}`.toLowerCase().includes(t)) : productos;
  }, [buscar, productos]);

  async function sincronizar() {
    setSincronizando(true);
    try {
      const r = await apiPost<{ productos: number; listas: number; clientes: number }>(
        `/catalogo/sincronizar?empresaId=${empresaId}`
      );
      toast.success("Catálogo al día con el extracto de ventas", {
        description: `${r.productos} producto(s), ${r.listas} lista(s) y ${r.clientes} cliente(s) completados`,
      });
      router.refresh();
    } catch (err) {
      toast.error("No se pudo sincronizar", { description: mensajeDeError(err, "Intenta de nuevo") });
    } finally {
      setSincronizando(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="w-64"
          placeholder="Buscar por código, nombre o grupo"
          value={buscar}
          onChange={(e) => setBuscar(e.target.value)}
          aria-label="Buscar producto"
        />
        <ProductoDialog empresaId={empresaId}>
          <Button>Nuevo producto</Button>
        </ProductoDialog>
        <Button variant="outline" onClick={sincronizar} disabled={sincronizando}>
          <RefreshCwIcon className={sincronizando ? "animate-spin" : undefined} />
          Traer del extracto de ventas
        </Button>
        <span className="text-sm text-muted-foreground">
          {formatNumero(filtrados.length)} de {formatNumero(productos.length)}
        </span>
      </div>
      <div className="overflow-x-auto rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Código</TableHead>
              <TableHead>Producto</TableHead>
              <TableHead>Grupo</TableHead>
              <TableHead className="text-right">Und/caja</TableHead>
              <TableHead>Impuesto</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="text-right">Acción</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtrados.slice(0, 300).map((p) => (
              <TableRow key={p.id}>
                <TableCell className="tabular-nums font-mono text-muted-foreground">{p.codigo}</TableCell>
                <TableCell className="font-medium">{p.nombre}</TableCell>
                <TableCell>{p.grupo ?? "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{p.unidadesPorCaja}</TableCell>
                <TableCell>{IMPUESTO[p.impuestoCodigo] ?? p.impuestoCodigo}</TableCell>
                <TableCell>{p.activo ? "Activo" : "Inactivo"}</TableCell>
                <TableCell className="text-right">
                  <ProductoDialog empresaId={empresaId} producto={p}>
                    <Button variant="ghost" size="sm">
                      Editar
                    </Button>
                  </ProductoDialog>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

export function PreciosListas({ empresaId, listas }: { empresaId: string; listas: ListaPrecio[] }) {
  const router = useRouter();
  const [listaId, setListaId] = useState(listas[0]?.id ?? "");
  const [precios, setPrecios] = useState<PrecioProducto[]>([]);
  const [cambios, setCambios] = useState<Record<string, string>>({});
  const [nueva, setNueva] = useState({ codigo: "", nombre: "" });
  const [buscar, setBuscar] = useState("");
  const [cargandoPrecios, setCargandoPrecios] = useState(false);

  const listaActual = useMemo(() => listas.find((l) => l.id === listaId), [listas, listaId]);

  function cargarPrecios(id: string) {
    if (!id) return;
    setCargandoPrecios(true);
    apiGet<PrecioProducto[]>(`/catalogo/listas/${id}/precios`)
      .then((p) => {
        setPrecios(p);
        setCambios({});
      })
      .catch(() => setPrecios([]))
      .finally(() => setCargandoPrecios(false));
  }

  useEffect(() => {
    if (!listaId) return;
    let activo = true;
    apiGet<PrecioProducto[]>(`/catalogo/listas/${listaId}/precios`)
      .then((p) => {
        if (!activo) return;
        setPrecios(p);
        setCambios({});
      })
      .catch(() => {
        if (activo) setPrecios([]);
      });
    return () => {
      activo = false;
    };
  }, [listaId]);

  const grupos = useMemo(() => {
    const set = new Set<string>();
    for (const p of precios) {
      if (p.grupo) set.add(p.grupo);
    }
    return Array.from(set).sort();
  }, [precios]);

  const filtrados = useMemo(() => {
    const t = buscar.trim().toLowerCase();
    if (!t) return precios;
    return precios.filter((p) => `${p.codigo} ${p.nombre} ${p.grupo ?? ""}`.toLowerCase().includes(t));
  }, [precios, buscar]);

  async function guardar() {
    const lista = Object.entries(cambios)
      .filter(([, v]) => v.trim() !== "")
      .map(([productoId, v]) => ({ productoId, precioCajaUsd: Number(v.replace(",", ".")) }));
    if (lista.some((p) => Number.isNaN(p.precioCajaUsd))) return toast.error("Hay un precio que no es un número");
    try {
      await apiPut(`/catalogo/listas/${listaId}/precios`, { precios: lista });
      toast.success(`${lista.length} precio(s) guardados`);
      cargarPrecios(listaId);
      router.refresh();
    } catch (err) {
      toast.error("No se pudieron guardar", { description: mensajeDeError(err, "Intenta de nuevo") });
    }
  }

  async function subirExcel(archivo: File) {
    const form = new FormData();
    form.append("archivo", archivo);
    try {
      const r = await apiPostForm<{ guardados: number; problemas: { fila: number; motivo: string }[] }>(
        `/catalogo/listas/${listaId}/precios/excel`,
        form
      );
      toast.success(`${r.guardados} precio(s) cargados del Excel`, {
        description: r.problemas.length
          ? `${r.problemas.length} fila(s) con problemas, p. ej. fila ${r.problemas[0].fila}: ${r.problemas[0].motivo}`
          : undefined,
      });
      cargarPrecios(listaId);
      router.refresh();
    } catch (err) {
      toast.error("No se pudo leer el Excel", { description: mensajeDeError(err, "Revisa el archivo") });
    }
  }

  async function crearLista() {
    try {
      const l = await apiPost<ListaPrecio>(`/catalogo/listas?empresaId=${empresaId}`, nueva);
      toast.success(`Lista ${l.codigo} creada`);
      setNueva({ codigo: "", nombre: "" });
      router.refresh();
      setListaId(l.id);
    } catch (err) {
      toast.error("No se pudo crear la lista", { description: mensajeDeError(err, "Revisa el código") });
    }
  }

  // Base de costo seleccionada por la lista (o default PROMEDIO)
  const baseCosto = listaActual?.baseCostoPorDefecto ?? "PROMEDIO";
  const metodoMargen = listaActual?.metodoMargen ?? "SOBRE_VENTA";
  const margenObjetivo = listaActual?.margenObjetivoPct ?? null;

  return (
    <div className="space-y-4">
      {/* Barra superior de selección y acciones de lista */}
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3 sm:p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="lista" className="text-xs">
                Lista de precio activa
              </Label>
              <select
                id="lista"
                className="h-8 max-w-full rounded-md border border-input bg-transparent px-2.5 text-xs sm:text-sm"
                value={listaId}
                onChange={(e) => setListaId(e.target.value)}
              >
                {listas.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.codigo} — {l.nombre} ({l.clientes} clientes)
                  </option>
                ))}
              </select>
            </div>

            {listaActual && (
              <>
                <ListaConfigDialog
                  key={`cfg-${listaActual.id}`}
                  lista={listaActual}
                  onActualizado={() => router.refresh()}
                />
                <RecalcularPreciosDialog
                  key={`rec-${listaActual.id}`}
                  lista={listaActual}
                  grupos={grupos}
                  onPreciosActualizados={() => cargarPrecios(listaId)}
                />
              </>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {listaId && (
              <>
                <Button size="sm" onClick={guardar} disabled={Object.keys(cambios).length === 0} className="h-8 text-xs">
                  Guardar {Object.keys(cambios).length > 0 ? `(${Object.keys(cambios).length})` : ""} cambios
                </Button>
                <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-input bg-muted/20 px-2.5 text-xs hover:bg-muted/40">
                  <UploadIcon className="size-3.5" /> Importar Excel
                  <input
                    type="file"
                    accept=".xlsx"
                    className="sr-only"
                    onChange={(e) => e.target.files?.[0] && subirExcel(e.target.files[0])}
                  />
                </label>
              </>
            )}
          </div>
        </div>

        {/* Resumen de configuración de la lista activa */}
        {listaActual && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground pt-1 border-t border-border/60">
            <span>
              Base de costo: <strong className="text-foreground">{baseCosto}</strong>
            </span>
            <span>
              Método de margen:{" "}
              <strong className="text-foreground">
                {metodoMargen === "SOBRE_VENTA" ? "Sobre Venta" : "Sobre Costo (Markup)"}
              </strong>
            </span>
            <span>
              Margen objetivo:{" "}
              <strong className="text-foreground">
                {margenObjetivo != null ? `${margenObjetivo}%` : "No fijado"}
              </strong>
            </span>
          </div>
        )}
      </div>

      {/* Creación rápida de nueva lista */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="relative w-full sm:w-72">
          <SearchIcon className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
          <Input
            className="h-8 pl-8 text-xs"
            placeholder="Buscar por código o producto en la lista..."
            value={buscar}
            onChange={(e) => setBuscar(e.target.value)}
          />
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <Input
            className="h-8 w-20 text-xs"
            placeholder="Cód."
            value={nueva.codigo}
            onChange={(e) => setNueva({ ...nueva, codigo: e.target.value })}
            aria-label="Código de la lista nueva"
          />
          <Input
            className="h-8 w-36 text-xs"
            placeholder="Nombre de lista"
            value={nueva.nombre}
            onChange={(e) => setNueva({ ...nueva, nombre: e.target.value })}
            aria-label="Nombre de la lista nueva"
          />
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            onClick={crearLista}
            disabled={!nueva.codigo || !nueva.nombre}
          >
            Nueva lista
          </Button>
        </div>
      </div>

      {/* Tabla y tarjetas responsivas */}
      {listaId ? (
        filtrados.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
            No se encontraron productos en esta lista de precios.
          </div>
        ) : (
          <>
            {/* Vista móvil compacta (< sm / 390px) */}
            <div className="space-y-3 sm:hidden">
              {filtrados.map((p) => {
                const precioActual = p.precioCajaUsd;
                const tieneCambio = cambios[p.id] !== undefined;
                const nuevoPrecioNum = tieneCambio
                  ? parseFloat(cambios[p.id].replace(",", "."))
                  : precioActual;

                // Determinar costo base del producto
                const costoBase =
                  baseCosto === "ULTIMO"
                    ? p.ultimoCostoCajaUsd
                    : baseCosto === "PRESUPUESTARIO"
                    ? p.costoPresupuestarioCajaUsd
                    : p.costoPromedioCajaUsd;

                // Calcular utilidad y margen en tiempo real
                let margenCalc = p.margenPct;
                let utilidadCalc =
                  baseCosto === "ULTIMO"
                    ? p.utilidadUltimoUsd
                    : baseCosto === "PRESUPUESTARIO"
                    ? p.utilidadPresupuestarioUsd
                    : p.utilidadPromedioUsd;
                let esBajoCosto = p.bajoCosto;
                let esBajoMargen = p.bajoMargenObjetivo;

                if (nuevoPrecioNum != null && costoBase != null && costoBase > 0) {
                  utilidadCalc = nuevoPrecioNum - costoBase;
                  margenCalc =
                    metodoMargen === "SOBRE_COSTO"
                      ? ((nuevoPrecioNum - costoBase) / costoBase) * 100
                      : ((nuevoPrecioNum - costoBase) / nuevoPrecioNum) * 100;
                  esBajoCosto = nuevoPrecioNum < costoBase;
                  esBajoMargen = margenObjetivo != null && margenCalc < margenObjetivo;
                }

                return (
                  <div key={p.id} className="rounded-lg border border-border bg-card p-3 text-xs space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <span className="font-semibold text-foreground block">{p.nombre}</span>
                        <span className="text-muted-foreground">
                          #{p.codigo} · {p.grupo ?? "Sin grupo"}
                        </span>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        {esBajoCosto ? (
                          <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                            Bajo costo
                          </Badge>
                        ) : esBajoMargen ? (
                          <Badge variant="outline" className="border-amber-500 text-amber-600 text-[10px] px-1.5 py-0">
                            Bajo margen
                          </Badge>
                        ) : precioActual != null ? (
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                            OK
                          </Badge>
                        ) : null}
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-1 rounded bg-muted/30 p-2 text-center text-[11px]">
                      <div>
                        <span className="text-[10px] text-muted-foreground block">Último Costo</span>
                        <span className="tabular-nums">{formatUsd(p.ultimoCostoCajaUsd, 2)}</span>
                      </div>
                      <div>
                        <span className="text-[10px] text-muted-foreground block">CPP SENIAT</span>
                        <span className="tabular-nums">{formatUsd(p.costoPromedioCajaUsd, 2)}</span>
                      </div>
                      <div>
                        <span className="text-[10px] text-muted-foreground block">Presupuestario</span>
                        <span className="tabular-nums">{formatUsd(p.costoPresupuestarioCajaUsd, 2)}</span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-2 pt-1">
                      <div className="space-y-0.5">
                        <span className="text-muted-foreground text-[11px]">Precio Venta (USD):</span>
                        <div className="font-bold tabular-nums text-foreground">
                          {precioActual == null ? "Sin precio" : formatUsd(precioActual, 2)}
                        </div>
                        {margenCalc != null && (
                          <span className="text-[10px] text-muted-foreground block">
                            Margen: {formatNumero(margenCalc, 1)}% · Utilidad: {formatUsd(utilidadCalc, 2)}
                          </span>
                        )}
                      </div>

                      <div className="w-32">
                        <Input
                          className="h-8 text-xs tabular-nums text-right"
                          inputMode="decimal"
                          value={cambios[p.id] ?? ""}
                          placeholder={precioActual?.toString() ?? "0.00"}
                          onChange={(e) => setCambios((c) => ({ ...c, [p.id]: e.target.value }))}
                          aria-label={`Nuevo precio para ${p.nombre}`}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Vista escritorio (>= sm) */}
            <div className="hidden sm:block max-h-[34rem] overflow-auto rounded-lg border border-border">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-card shadow-xs">
                  <TableRow className="text-xs">
                    <TableHead className="w-16">Código</TableHead>
                    <TableHead className="min-w-[180px]">Producto</TableHead>
                    <TableHead className="text-right">Último Costo</TableHead>
                    <TableHead className="text-right">Promedio SENIAT</TableHead>
                    <TableHead className="text-right">Presupuestario</TableHead>
                    <TableHead className="text-right">Precio Actual</TableHead>
                    <TableHead className="w-32 text-right">Nuevo Precio ($)</TableHead>
                    <TableHead className="text-right">Margen (%)</TableHead>
                    <TableHead className="text-right">Utilidad ($)</TableHead>
                    <TableHead className="text-center">Alerta</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="text-xs">
                  {filtrados.map((p) => {
                    const precioActual = p.precioCajaUsd;
                    const tieneCambio = cambios[p.id] !== undefined;
                    const nuevoPrecioNum = tieneCambio
                      ? parseFloat(cambios[p.id].replace(",", "."))
                      : precioActual;

                    // Costo base según lista
                    const costoBase =
                      baseCosto === "ULTIMO"
                        ? p.ultimoCostoCajaUsd
                        : baseCosto === "PRESUPUESTARIO"
                        ? p.costoPresupuestarioCajaUsd
                        : p.costoPromedioCajaUsd;

                    // Derivación en tiempo real
                    let margenCalc = p.margenPct;
                    let utilidadCalc =
                      baseCosto === "ULTIMO"
                        ? p.utilidadUltimoUsd
                        : baseCosto === "PRESUPUESTARIO"
                        ? p.utilidadPresupuestarioUsd
                        : p.utilidadPromedioUsd;
                    let esBajoCosto = p.bajoCosto;
                    let esBajoMargen = p.bajoMargenObjetivo;

                    if (nuevoPrecioNum != null && costoBase != null && costoBase > 0) {
                      utilidadCalc = nuevoPrecioNum - costoBase;
                      margenCalc =
                        metodoMargen === "SOBRE_COSTO"
                          ? ((nuevoPrecioNum - costoBase) / costoBase) * 100
                          : ((nuevoPrecioNum - costoBase) / nuevoPrecioNum) * 100;
                      esBajoCosto = nuevoPrecioNum < costoBase;
                      esBajoMargen = margenObjetivo != null && margenCalc < margenObjetivo;
                    }

                    return (
                      <TableRow key={p.id} className="hover:bg-muted/20">
                        <TableCell className="font-mono text-muted-foreground tabular-nums">
                          {p.codigo}
                        </TableCell>
                        <TableCell className="font-medium">
                          {p.nombre}
                          <span className="block text-[10px] text-muted-foreground">
                            {p.grupo ?? "Sin grupo"} · {p.unidadesPorCaja} und/caja
                          </span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {formatUsd(p.ultimoCostoCajaUsd, 2)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground font-medium">
                          {formatUsd(p.costoPromedioCajaUsd, 2)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {formatUsd(p.costoPresupuestarioCajaUsd, 2)}
                        </TableCell>
                        <TableCell className="text-right font-semibold tabular-nums text-foreground">
                          {precioActual == null ? (
                            <span className="text-muted-foreground font-normal">sin precio</span>
                          ) : (
                            formatUsd(precioActual, 2)
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <Input
                            className="h-7 text-xs tabular-nums text-right font-medium"
                            inputMode="decimal"
                            value={cambios[p.id] ?? ""}
                            placeholder={precioActual?.toString() ?? ""}
                            onChange={(e) => setCambios((c) => ({ ...c, [p.id]: e.target.value }))}
                            aria-label={`Precio de ${p.nombre}`}
                          />
                        </TableCell>
                        <TableCell className="text-right tabular-nums font-medium">
                          {margenCalc != null ? (
                            <span
                              className={
                                esBajoCosto
                                  ? "text-destructive font-bold"
                                  : esBajoMargen
                                  ? "text-amber-600 font-semibold"
                                  : "text-foreground"
                              }
                            >
                              {formatNumero(margenCalc, 1)}%
                            </span>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums font-medium">
                          {utilidadCalc != null ? (
                            <span
                              className={
                                utilidadCalc < 0
                                  ? "text-destructive font-bold"
                                  : "text-emerald-600 dark:text-emerald-400"
                              }
                            >
                              {utilidadCalc >= 0 ? "+" : ""}
                              {formatUsd(utilidadCalc, 2)}
                            </span>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          {esBajoCosto ? (
                            <Badge variant="destructive" className="text-[10px] px-1.5 py-0 gap-1">
                              <AlertTriangleIcon className="size-2.5" /> Bajo costo
                            </Badge>
                          ) : esBajoMargen ? (
                            <Badge
                              variant="outline"
                              className="border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-300 text-[10px] px-1.5 py-0 gap-1"
                            >
                              <AlertTriangleIcon className="size-2.5 text-amber-500" /> Bajo margen
                            </Badge>
                          ) : precioActual != null ? (
                            <span className="text-emerald-600 dark:text-emerald-400 text-xs font-semibold">
                              ✓
                            </span>
                          ) : (
                            <span className="text-muted-foreground/40">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </>
        )
      ) : (
        <p className="text-sm text-muted-foreground">
          Todavía no hay listas: tráelas del extracto de ventas o crea una.
        </p>
      )}
    </div>
  );
}

function FichaDialog({ cliente, onGuardado }: { cliente: ClienteFiscal; onGuardado: () => void }) {
  const [abierto, setAbierto] = useState(false);
  const inicial = {
    rifCedula: cliente.rifCedula ?? "",
    razonSocial: cliente.razonSocial ?? cliente.nombre,
    domicilioFiscal: cliente.domicilioFiscal ?? "",
    contribuyenteEspecial: cliente.contribuyenteEspecial,
    porcentajeRetencionIva: cliente.porcentajeRetencionIva ?? 75,
    limiteCreditoUsd: cliente.limiteCreditoUsd?.toString() ?? "",
    diasCredito: cliente.diasCredito?.toString() ?? "",
    rutaVenta: cliente.rutaVenta ?? "",
    tipoVenta: cliente.tipoVenta ?? "",
    listaPrecioCodigo: cliente.listaPrecioCodigo ?? "",
  };
  const [d, setD] = useState(inicial);
  const cambiar = (c: string, v: unknown) => setD((x) => ({ ...x, [c]: v }));
  async function guardar() {
    try {
      await apiPut(`/catalogo/clientes/${cliente.id}/ficha`, {
        ...d,
        rifCedula: d.rifCedula || null,
        domicilioFiscal: d.domicilioFiscal || null,
        porcentajeRetencionIva: d.contribuyenteEspecial ? Number(d.porcentajeRetencionIva) : null,
        limiteCreditoUsd: d.limiteCreditoUsd ? Number(d.limiteCreditoUsd) : null,
        diasCredito: d.diasCredito ? Number(d.diasCredito) : null,
        rutaVenta: d.rutaVenta || null,
        tipoVenta: d.tipoVenta || null,
        listaPrecioCodigo: d.listaPrecioCodigo || null,
      });
      toast.success("Ficha guardada");
      setAbierto(false);
      onGuardado();
    } catch (err) {
      toast.error("No se pudo guardar", { description: mensajeDeError(err, "Revisa los datos") });
    }
  }
  const campo = (c: keyof typeof inicial, label: string) => (
    <div className="space-y-1.5">
      <Label htmlFor={`f-${c}`}>{label}</Label>
      <Input id={`f-${c}`} value={String(d[c])} onChange={(e) => cambiar(c, e.target.value)} />
    </div>
  );
  return (
    <Dialog open={abierto} onOpenChange={(v) => { setAbierto(v); if (v) setD(inicial); }}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          Ficha
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ficha fiscal de {cliente.nombre}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          {campo("rifCedula", "RIF o cédula")}
          {campo("razonSocial", "Razón social")}
          {campo("domicilioFiscal", "Domicilio fiscal")}
          {campo("limiteCreditoUsd", "Límite de crédito (USD)")}
          {campo("diasCredito", "Días de crédito")}
          {campo("listaPrecioCodigo", "Lista de precio")}
          {campo("rutaVenta", "Ruta de venta")}
          {campo("tipoVenta", "Tipo de cliente")}
        </div>
        <label className="flex flex-wrap items-center gap-2 text-sm">
          <Checkbox checked={d.contribuyenteEspecial} onCheckedChange={(v) => cambiar("contribuyenteEspecial", v === true)} />
          Contribuyente especial (retiene IVA)
          {d.contribuyenteEspecial && (
            <select
              className="h-8 rounded-md border border-input bg-transparent px-2"
              value={d.porcentajeRetencionIva}
              onChange={(e) => cambiar("porcentajeRetencionIva", Number(e.target.value))}
            >
              <option value={75}>75 %</option>
              <option value={100}>100 %</option>
            </select>
          )}
        </label>
        <DialogFooter>
          <Button variant="outline" onClick={() => setAbierto(false)}>
            Cancelar
          </Button>
          <Button onClick={guardar}>Guardar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ClientesFichas({ empresaId }: { empresaId: string }) {
  const [buscar, setBuscar] = useState("");
  const [clientes, setClientes] = useState<ClienteFiscal[]>([]);
  const cargar = (t: string) =>
    apiGet<ClienteFiscal[]>(
      `/catalogo/clientes?empresaId=${empresaId}${t ? `&buscar=${encodeURIComponent(t)}` : ""}`
    )
      .then(setClientes)
      .catch(() => setClientes([]));
  useEffect(() => {
    cargar("");
  }, [empresaId]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="space-y-3">
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          cargar(buscar.trim());
        }}
      >
        <Input
          className="w-full flex-1 sm:w-72 sm:flex-none"
          placeholder="Buscar por nombre, código o RIF"
          value={buscar}
          onChange={(e) => setBuscar(e.target.value)}
          aria-label="Buscar cliente"
        />
        <Button type="submit" variant="outline">
          Buscar
        </Button>
      </form>
      <div className="overflow-x-auto rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Código</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>RIF</TableHead>
              <TableHead>Lista</TableHead>
              <TableHead>Ruta</TableHead>
              <TableHead>Crédito</TableHead>
              <TableHead className="text-right">Acción</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {clientes.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="text-muted-foreground">{c.codigo}</TableCell>
                <TableCell className="font-medium">{c.razonSocial ?? c.nombre}</TableCell>
                <TableCell className={c.rifCedula ? undefined : "text-warning"}>{c.rifCedula ?? "falta"}</TableCell>
                <TableCell>{c.listaPrecioCodigo ?? "—"}</TableCell>
                <TableCell>{c.rutaVenta ?? "—"}</TableCell>
                <TableCell className="tabular-nums">
                  {c.limiteCreditoUsd != null ? `${formatUsd(c.limiteCreditoUsd)} · ${c.diasCredito ?? 0} días` : "—"}
                </TableCell>
                <TableCell className="text-right">
                  <FichaDialog cliente={c} onGuardado={() => cargar(buscar.trim())} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
