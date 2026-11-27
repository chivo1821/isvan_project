"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2Icon, SearchIcon, UserCheckIcon, UsersIcon } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiGet, apiPut, mensajeDeError } from "@/lib/api-client";
import type { ClienteFiscal, ListaPrecio } from "@/lib/administrativo";

type FiltroClientes = "EN_LISTA" | "SIN_LISTA" | "TODOS";

export function ListaClientesDialog({
  empresaId,
  lista,
  onActualizado,
}: {
  empresaId: string;
  lista: ListaPrecio;
  onActualizado: () => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [filtro, setFiltro] = useState<FiltroClientes>("EN_LISTA");
  const [buscar, setBuscar] = useState("");
  const [clientes, setClientes] = useState<ClienteFiscal[]>([]);
  const [cargando, setCargando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [seleccionados, setSeleccionados] = useState<string[]>([]);

  useEffect(() => {
    if (!abierto) return;
    let activo = true;
    const params = new URLSearchParams({ empresaId });
    if (filtro === "EN_LISTA") params.set("listaPrecio", lista.codigo);
    else if (filtro === "SIN_LISTA") params.set("listaPrecio", "SIN_LISTA");
    if (buscar.trim()) params.set("buscar", buscar.trim());

    const timer = setTimeout(() => {
      setCargando(true);
      apiGet<ClienteFiscal[]>(`/catalogo/clientes?${params.toString()}`)
        .then((res) => {
          if (!activo) return;
          setClientes(res);
          setSeleccionados([]);
        })
        .catch(() => {
          if (activo) setClientes([]);
        })
        .finally(() => {
          if (activo) setCargando(false);
        });
    }, 200);

    return () => {
      activo = false;
      clearTimeout(timer);
    };
  }, [abierto, empresaId, filtro, buscar, lista.codigo]);

  const todosSeleccionados = useMemo(
    () => clientes.length > 0 && seleccionados.length === clientes.length,
    [clientes.length, seleccionados.length]
  );

  function toggleTodos(checked: boolean) {
    setSeleccionados(checked ? clientes.map((c) => c.id) : []);
  }

  function toggleUno(id: string, checked: boolean) {
    setSeleccionados((prev) => (checked ? [...prev, id] : prev.filter((x) => x !== id)));
  }

  async function aplicarAsignacion(clienteIds: string[], codigoLista: string | null) {
    if (clienteIds.length === 0) return;
    setGuardando(true);
    try {
      const res = await apiPut<{ actualizados: number; listaPrecioCodigo: string | null }>(
        "/catalogo/clientes/lista-precio",
        {
          empresaId,
          clienteIds,
          listaPrecioCodigo: codigoLista,
        }
      );
      toast.success(
        codigoLista
          ? `${res.actualizados} cliente(s) asignados a Lista ${codigoLista}`
          : `${res.actualizados} cliente(s) quitados de la lista`
      );
      setSeleccionados([]);
      // Recargar vista actual
      const params = new URLSearchParams({ empresaId });
      if (filtro === "EN_LISTA") params.set("listaPrecio", lista.codigo);
      else if (filtro === "SIN_LISTA") params.set("listaPrecio", "SIN_LISTA");
      if (buscar.trim()) params.set("buscar", buscar.trim());
      const actualizados = await apiGet<ClienteFiscal[]>(`/catalogo/clientes?${params.toString()}`);
      setClientes(actualizados);
      onActualizado();
    } catch (err) {
      toast.error("No se pudo actualizar la lista del cliente", {
        description: mensajeDeError(err, "Intenta de nuevo"),
      });
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Dialog open={abierto} onOpenChange={setAbierto}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-1.5 px-2.5 text-xs">
          <UsersIcon className="size-3.5" />
          <span>Clientes</span>
          <Badge variant="secondary" className="h-4 px-1.5 text-[10px] tabular-nums">
            {lista.clientes}
          </Badge>
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="text-base">
            Clientes con precios de {lista.codigo} — {lista.nombre}
          </DialogTitle>
          <DialogDescription className="text-xs">
            Asigna aquí qué clientes pertenecen a este segmento. Al cotizar o facturar se aplicarán los precios de esta
            lista automáticamente.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1">
            <Button
              type="button"
              size="sm"
              variant={filtro === "EN_LISTA" ? "default" : "outline"}
              className="h-7 text-xs"
              onClick={() => setFiltro("EN_LISTA")}
            >
              En lista {lista.codigo} ({lista.clientes})
            </Button>
            <Button
              type="button"
              size="sm"
              variant={filtro === "SIN_LISTA" ? "default" : "outline"}
              className="h-7 text-xs"
              onClick={() => setFiltro("SIN_LISTA")}
            >
              Sin lista asignada
            </Button>
            <Button
              type="button"
              size="sm"
              variant={filtro === "TODOS" ? "default" : "outline"}
              className="h-7 text-xs"
              onClick={() => setFiltro("TODOS")}
            >
              Todos los clientes
            </Button>
          </div>

          <div className="relative w-full sm:w-64">
            <SearchIcon className="absolute left-2.5 top-2 size-3.5 text-muted-foreground" />
            <Input
              className="h-8 pl-8 text-xs"
              placeholder="Buscar por nombre, código o RIF..."
              value={buscar}
              onChange={(e) => setBuscar(e.target.value)}
            />
          </div>
        </div>

        {seleccionados.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs">
            <span className="font-medium">
              {seleccionados.length} cliente(s) seleccionado(s)
            </span>
            <div className="flex items-center gap-2">
              {filtro !== "EN_LISTA" && (
                <Button
                  size="sm"
                  className="h-7 gap-1 text-xs"
                  disabled={guardando}
                  onClick={() => aplicarAsignacion(seleccionados, lista.codigo)}
                >
                  <UserCheckIcon className="size-3.5" />
                  Asignar a Lista {lista.codigo}
                </Button>
              )}
              {filtro === "EN_LISTA" && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  disabled={guardando}
                  onClick={() => aplicarAsignacion(seleccionados, null)}
                >
                  Quitar de Lista {lista.codigo}
                </Button>
              )}
            </div>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-border">
          {cargando ? (
            <div className="flex items-center justify-center py-10 text-xs text-muted-foreground">
              <Loader2Icon className="mr-2 size-4 animate-spin" /> Cargando clientes...
            </div>
          ) : clientes.length === 0 ? (
            <div className="py-10 text-center text-xs text-muted-foreground">
              No hay clientes en esta vista.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="text-xs">
                  <TableHead className="w-10">
                    <Checkbox
                      checked={todosSeleccionados}
                      onCheckedChange={(v) => toggleTodos(v === true)}
                      aria-label="Seleccionar todos"
                    />
                  </TableHead>
                  <TableHead>Código</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Ruta</TableHead>
                  <TableHead>Lista actual</TableHead>
                  <TableHead className="text-right">Acción</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="text-xs">
                {clientes.map((c) => {
                  const enEsta = c.listaPrecioCodigo === lista.codigo;
                  const marcado = seleccionados.includes(c.id);
                  return (
                    <TableRow key={c.id}>
                      <TableCell>
                        <Checkbox
                          checked={marcado}
                          onCheckedChange={(v) => toggleUno(c.id, v === true)}
                          aria-label={`Seleccionar ${c.nombre}`}
                        />
                      </TableCell>
                      <TableCell className="tabular-nums text-muted-foreground">{c.codigo}</TableCell>
                      <TableCell className="font-medium">
                        <div>{c.razonSocial ?? c.nombre}</div>
                        {c.ciudad && <div className="text-[11px] text-muted-foreground">{c.ciudad}</div>}
                      </TableCell>
                      <TableCell>{c.rutaVenta ?? "—"}</TableCell>
                      <TableCell>
                        {c.listaPrecioCodigo ? (
                          <Badge variant={enEsta ? "default" : "secondary"} className="text-[10px]">
                            Lista {c.listaPrecioCodigo}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">Sin lista</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {enEsta ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs text-muted-foreground"
                            disabled={guardando}
                            onClick={() => aplicarAsignacion([c.id], null)}
                          >
                            Quitar
                          </Button>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs"
                            disabled={guardando}
                            onClick={() => aplicarAsignacion([c.id], lista.codigo)}
                          >
                            Asignar a {lista.codigo}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => setAbierto(false)}>
            Cerrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
