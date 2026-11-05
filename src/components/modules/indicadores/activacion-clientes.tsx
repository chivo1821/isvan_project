"use client";

import { useState } from "react";
import { SearchIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatNumero, formatPct, formatUsd } from "@/lib/constants";
import { formatFecha, type ActivacionClientes as Activacion, type ListaActivacion } from "@/lib/indicadores";
import { ItemMovil, ListaMovil } from "./item-movil";

// Las listas pueden tener cientos de clientes: se dibujan de a tramos.
const TRAMO = 100;

const EXPLICACION: Record<string, string> = {
  atendidos: "Compraron en el período con los filtros elegidos. Ordenados por venta neta.",
  menos2:
    "No compraron en el período, pero su última compra fue hace menos de 2 semanas (pasa cuando el período es corto).",
  de2a4: "Su última compra fue hace 2 a 4 semanas.",
  de4a8: "Su última compra fue hace 4 a 8 semanas.",
  mas8: "Llevan más de 8 semanas sin comprar.",
  nunca:
    "Son clientes de la cartera que nunca compraron lo que marcan los filtros de grupo, producto o tipo de documento.",
};

function paraBuscar(texto: string) {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function TablaLista({
  lista,
  busqueda,
  textoAnterior,
}: {
  lista: ListaActivacion;
  busqueda: string;
  textoAnterior: string;
}) {
  const [visibles, setVisibles] = useState(TRAMO);
  const atendidos = lista.clave === "atendidos";
  const termino = paraBuscar(busqueda.trim());
  const filtrados = termino
    ? lista.clientes.filter((c) => paraBuscar(`${c.nombre} ${c.codigo} ${c.ruta}`).includes(termino))
    : lista.clientes;

  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">{EXPLICACION[lista.clave]}</p>
      {filtrados.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {lista.total === 0 ? "Ningún cliente en esta lista." : "Ningún cliente coincide con la búsqueda."}
        </p>
      ) : (
        <>
          <ListaMovil key={termino}>
            {filtrados.map((c) => (
              <ItemMovil
                key={c.codigo}
                nombre={c.nombre}
                detalle={[c.codigo, c.ruta, c.tipo].filter(Boolean).join(" · ")}
                valor={
                  atendidos
                    ? formatUsd(c.ventaPeriodo)
                    : c.diasSinCompra != null
                      ? `${formatNumero(c.diasSinCompra)} días`
                      : "—"
                }
                valorDetalle={
                  <>
                    {atendidos
                      ? `${formatNumero(c.documentos)} doc.`
                      : c.ultimaCompra
                        ? `últ. ${formatFecha(c.ultimaCompra)}`
                        : "sin compras"}
                    {c.ventaAnterior ? (
                      <span className="block" title={textoAnterior}>
                        antes {formatUsd(c.ventaAnterior)}
                      </span>
                    ) : null}
                  </>
                }
              />
            ))}
          </ListaMovil>
          <div className="hidden max-h-[28rem] overflow-auto rounded-lg border border-border sm:block">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-card">
                <TableRow>
                  <TableHead>Código</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Ruta</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead className="text-right">Última compra</TableHead>
                  {atendidos ? (
                    <>
                      <TableHead className="text-right">Documentos</TableHead>
                      <TableHead className="text-right">Venta en el período</TableHead>
                    </>
                  ) : (
                    <TableHead className="text-right">Días sin compra</TableHead>
                  )}
                  <TableHead className="text-right" title={textoAnterior}>
                    Venta período anterior
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtrados.slice(0, visibles).map((c) => (
                  <TableRow key={c.codigo}>
                    <TableCell className="text-muted-foreground tabular-nums">{c.codigo}</TableCell>
                    <TableCell className="font-medium">{c.nombre}</TableCell>
                    <TableCell>{c.ruta}</TableCell>
                    <TableCell className="text-muted-foreground">{c.tipo}</TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {c.ultimaCompra ? formatFecha(c.ultimaCompra) : "—"}
                    </TableCell>
                    {atendidos ? (
                      <>
                        <TableCell className="text-right tabular-nums">{formatNumero(c.documentos)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatUsd(c.ventaPeriodo)}</TableCell>
                      </>
                    ) : (
                      <TableCell className="text-right tabular-nums">
                        {c.diasSinCompra != null ? formatNumero(c.diasSinCompra) : "—"}
                      </TableCell>
                    )}
                    <TableCell className="text-right text-muted-foreground tabular-nums">
                      {c.ventaAnterior ? formatUsd(c.ventaAnterior) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
      {filtrados.length > visibles && (
        <div className="hidden items-center justify-between gap-2 text-xs text-muted-foreground sm:flex">
          <span>
            Se muestran {formatNumero(visibles)} de {formatNumero(filtrados.length)}.
          </span>
          <Button variant="ghost" size="sm" onClick={() => setVisibles((v) => v + TRAMO)}>
            Mostrar {formatNumero(Math.min(TRAMO, filtrados.length - visibles))} más
          </Button>
        </div>
      )}
    </div>
  );
}

/** Activación de la cartera: qué clientes compraron en el período y cuánto
 * llevan sin comprar los que no (ver activacion en
 * backend/app/services/indicadores_venta.py). */
export function ActivacionClientes({ activacion }: { activacion: Activacion }) {
  const [busqueda, setBusqueda] = useState("");
  const [listaVista, setListaVista] = useState("atendidos");
  const { cartera, atendidos, noAtendidos, pctActivacion, comparacion } = activacion;
  const textoAnterior = `Venta neta del ${formatFecha(comparacion.desde)} al ${formatFecha(comparacion.hasta)}`;

  return (
    <Card>
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Activación de clientes</CardTitle>
            <p className="text-sm text-muted-foreground">
              Cartera: clientes con alguna compra hasta el final del período, con los filtros de ruta, tipo de cliente
              y cliente. Los días sin compra se cuentan hasta hoy o, si el período ya terminó, hasta su último día.
            </p>
          </div>
          <div className="relative w-full sm:w-64">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar cliente o código"
              aria-label="Buscar cliente en las listas de activación"
              className="h-8 pl-8"
            />
          </div>
        </div>
        {cartera > 0 && (
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
              <span>
                <span className="text-lg font-semibold text-foreground">{formatPct(pctActivacion)}</span>{" "}
                <span className="text-muted-foreground">
                  de activación: {formatNumero(atendidos)} de {formatNumero(cartera)} clientes atendidos
                </span>
              </span>
              <span className="text-muted-foreground">{formatNumero(noAtendidos)} sin compra en el período</span>
            </div>
            <Progress value={(pctActivacion ?? 0) * 100} className="h-2" aria-label="Porcentaje de activación" />
          </div>
        )}
      </CardHeader>
      <CardContent>
        {cartera === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No hay clientes en la cartera con estos filtros.</p>
        ) : (
          <Tabs value={listaVista} onValueChange={setListaVista}>
            {/* Seis pestañas largas no caben en el teléfono: ahí se elige la
                lista con un desplegable. */}
            <Select value={listaVista} onValueChange={setListaVista}>
              <SelectTrigger className="w-full sm:hidden" aria-label="Lista de clientes">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {activacion.listas.map((lista) => (
                  <SelectItem key={lista.clave} value={lista.clave} disabled={lista.total === 0}>
                    {lista.etiqueta} ({formatNumero(lista.total)})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <TabsList className="hidden flex-wrap justify-start group-data-horizontal/tabs:h-auto sm:inline-flex">
              {activacion.listas.map((lista) => (
                <TabsTrigger
                  key={lista.clave}
                  value={lista.clave}
                  disabled={lista.total === 0}
                  className="h-7 flex-none"
                >
                  {lista.etiqueta} ({formatNumero(lista.total)})
                </TabsTrigger>
              ))}
            </TabsList>
            {activacion.listas.map((lista) => (
              <TabsContent key={lista.clave} value={lista.clave} className="pt-2">
                <TablaLista lista={lista} busqueda={busqueda} textoAnterior={textoAnterior} />
              </TabsContent>
            ))}
          </Tabs>
        )}
      </CardContent>
    </Card>
  );
}
