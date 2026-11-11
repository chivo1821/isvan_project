"use client";

import { useState } from "react";
import { ListIcon } from "lucide-react";
import { StatusBadge } from "@/components/shared/status-badge";
import { FiltroMultiple, type OpcionFiltro } from "@/components/modules/indicadores/barra-filtros";
import { DespachosVendedorLista } from "@/components/modules/vendedor/despachos-vendedor";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Tone } from "@/lib/constants";
import { EMPRESAS } from "@/lib/indicadores";
import { categoriaDespacho, type CategoriaDespacho, type DespachoLista } from "@/lib/vendedor";

/** Las mismas categorías que ve el vendedor, en palabras de la oficina. */
export const CATEGORIA_ESTATUS_META: Record<CategoriaDespacho, { label: string; tone: Tone }> = {
  pendiente: { label: "Por despachar", tone: "warning" },
  cargado: { label: "Cargado en un viaje", tone: "info" },
  en_camino: { label: "En tránsito", tone: "primary" },
  entregado: { label: "Entregado", tone: "success" },
  otro: { label: "Rechazado o cancelado", tone: "destructive" },
};

const AYUDA: Record<CategoriaDespacho, string> = {
  pendiente: "Todavía sin viaje, o esperando aprobación",
  cargado: "En un viaje que aún no sale del almacén",
  en_camino: "En un viaje que ya salió",
  entregado: "Últimos 30 días",
  otro: "Últimos 30 días",
};

const ORDEN: CategoriaDespacho[] = ["pendiente", "cargado", "en_camino", "entregado", "otro"];

// Los clientes que no están en ventas no tienen ruta de venta.
const SIN_RUTA = "__sin_ruta__";
const rutaDe = (d: DespachoLista) => d.rutaVenta ?? SIN_RUTA;

/** Las rutas de venta de los despachos, en orden numérico (2 antes que 10). */
function opcionesDeRuta(despachos: DespachoLista[]): OpcionFiltro[] {
  const rutas = [...new Set(despachos.map(rutaDe))];
  rutas.sort((a, b) => (a === SIN_RUTA ? 1 : b === SIN_RUTA ? -1 : a.localeCompare(b, "es", { numeric: true })));
  return rutas.map((r) => ({ valor: r, etiqueta: r === SIN_RUTA ? "Sin ruta de venta" : r }));
}

/** Cuántos despachos hay en cada estatus, por empresa, y la lista de cada
 * uno con lo mismo que ve el vendedor en "Mis despachos". */
export function EstatusDespachos({ despachos: todos }: { despachos: DespachoLista[] }) {
  const [abierto, setAbierto] = useState<CategoriaDespacho | "todos" | null>(null);
  // Por la ruta de venta del cliente: la tienen todos los despachos, también
  // los que todavía no están en un viaje.
  const [rutas, setRutas] = useState<string[]>([]);
  const opcionesRuta = opcionesDeRuta(todos);
  const despachos = rutas.length === 0 ? todos : todos.filter((d) => rutas.includes(rutaDe(d)));
  const elegidas = rutas.map((r) => (r === SIN_RUTA ? "sin ruta de venta" : `ruta ${r}`)).join(", ");

  const conteo = new Map<string, number>();
  for (const d of despachos) {
    const c = categoriaDespacho(d);
    conteo.set(`${c}|${d.empresa}`, (conteo.get(`${c}|${d.empresa}`) ?? 0) + 1);
    conteo.set(c, (conteo.get(c) ?? 0) + 1);
  }
  const n = (clave: string) => conteo.get(clave) ?? 0;
  // Rechazados y cancelados solo si hay alguno: casi nunca hay.
  const filas = ORDEN.filter((c) => c !== "otro" || n(c) > 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Estatus de los despachos</CardTitle>
        <CardDescription>Lo abierto, y lo entregado en los últimos 30 días</CardDescription>
        <CardAction className="flex flex-wrap items-center justify-end gap-2">
          <FiltroMultiple
            etiqueta="Ruta"
            todos="Todas las rutas"
            opciones={opcionesRuta}
            seleccion={rutas}
            onCambiar={setRutas}
          />
          <Button variant="ghost" size="sm" onClick={() => setAbierto("todos")}>
            <ListIcon />
            Ver todos
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Estatus</TableHead>
                {EMPRESAS.map((e) => (
                  <TableHead key={e} className="text-right">
                    {e}
                  </TableHead>
                ))}
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="w-px" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filas.map((c) => (
                <TableRow key={c}>
                  <TableCell>
                    <StatusBadge {...CATEGORIA_ESTATUS_META[c]} />
                    <span className="mt-0.5 block text-xs text-muted-foreground">{AYUDA[c]}</span>
                  </TableCell>
                  {EMPRESAS.map((e) => (
                    <TableCell key={e} className="text-right tabular-nums">
                      {n(`${c}|${e}`)}
                    </TableCell>
                  ))}
                  <TableCell className="text-right font-semibold tabular-nums">{n(c)}</TableCell>
                  <TableCell>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={n(c) === 0}
                      onClick={() => setAbierto(c)}
                      aria-label={`Ver el detalle de ${CATEGORIA_ESTATUS_META[c].label.toLowerCase()}`}
                    >
                      Ver detalle
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell className="font-medium">Total</TableCell>
                {EMPRESAS.map((e) => (
                  <TableCell key={e} className="text-right tabular-nums">
                    {despachos.filter((d) => d.empresa === e).length}
                  </TableCell>
                ))}
                <TableCell className="text-right font-semibold tabular-nums">{despachos.length}</TableCell>
                <TableCell />
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      </CardContent>

      <Dialog open={abierto !== null} onOpenChange={(v) => !v && setAbierto(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>
              {abierto && abierto !== "todos" ? CATEGORIA_ESTATUS_META[abierto].label : "Todos los despachos"}
            </DialogTitle>
            <DialogDescription>
              Lo mismo que ve el vendedor en «Mis despachos», de{" "}
              {rutas.length === 0 ? "todos los clientes" : `los clientes de: ${elegidas}`}. El nombre
              del cliente abre el despacho.
            </DialogDescription>
          </DialogHeader>
          {abierto && (
            <DespachosVendedorLista
              key={`${abierto}|${rutas.join(",")}`}
              despachos={despachos}
              filtroInicial={abierto}
              etiquetas={CATEGORIA_ESTATUS_META}
              enlace={(d) => `/despachos/${d.id}`}
              mostrarOtros={n("otro") > 0}
              vacio={
                rutas.length === 0
                  ? "No hay despachos abiertos ni entregados en los últimos 30 días."
                  : "No hay despachos de esas rutas abiertos ni entregados en los últimos 30 días."
              }
            />
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
