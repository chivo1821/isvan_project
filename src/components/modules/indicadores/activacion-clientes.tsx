"use client";

import { useState } from "react";
import { SearchIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatNumero, formatPct, formatUsd } from "@/lib/constants";
import { formatFecha, type ActivacionClientes as Activacion, type ListaActivacion } from "@/lib/indicadores";

// Las listas pueden tener cientos de clientes: se dibujan de a tramos.
const TRAMO = 100;

const EXPLICACION: Record<string, string> = {
  atendidos: "Compraron en el período con los filtros elegidos. Ordenados por venta neta.",
  menos2:
    "No compraron en el período, pero su última compra fue hace menos de 2 semanas (pasa cuando el período es corto).",
  de2a4: "Su última compra fue hace 2 a 4 semanas, contado hasta el último día del período.",
  de4a8: "Su última compra fue hace 4 a 8 semanas, contado hasta el último día del período.",
  mas8: "Llevan más de 8 semanas sin comprar, contado hasta el último día del período.",
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
        <div className="max-h-[28rem] overflow-auto rounded-lg border border-border">
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
      )}
      {filtrados.length > visibles && (
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
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
              y cliente. Los días sin compra se cuentan hasta el último día del período.
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
          <Tabs defaultValue="atendidos">
            <div className="overflow-x-auto">
              <TabsList>
                {activacion.listas.map((lista) => (
                  <TabsTrigger key={lista.clave} value={lista.clave} disabled={lista.total === 0}>
                    {lista.etiqueta} ({formatNumero(lista.total)})
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>
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
