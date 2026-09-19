"use client";

import { useState } from "react";
import { SearchIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/shared/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatNumero, formatUsd } from "@/lib/constants";
import type { ParadaDelivery } from "@/lib/delivery";

const TRAMO = 50;

function paraBuscar(texto: string) {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Una fila por entrega pagable: el respaldo del pago, para revisarlo con el
 * motorizado. Se paga una vez por parada, aunque lleve varios documentos. */
export function DetalleParadas({ paradas }: { paradas: ParadaDelivery[] }) {
  const [busqueda, setBusqueda] = useState("");
  const [visibles, setVisibles] = useState(TRAMO);

  const termino = paraBuscar(busqueda.trim());
  const filtradas = termino
    ? paradas.filter((p) =>
        paraBuscar(`${p.clienteNombre} ${p.clienteCodigo} ${p.rutaNumero} ${p.conductor ?? ""} ${p.numeros}`).includes(
          termino
        )
      )
    : paradas;

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle>Detalle de entregas</CardTitle>
        <div className="relative w-full sm:w-64">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar cliente, ruta o documento"
            aria-label="Buscar en el detalle de entregas"
            className="h-8 pl-8"
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {filtradas.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {paradas.length === 0 ? "Sin entregas en el período." : "Ninguna entrega coincide con la búsqueda."}
          </p>
        ) : (
          <div className="max-h-[32rem] overflow-auto rounded-lg border border-border">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-card">
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Motorizado</TableHead>
                  <TableHead>Ruta</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead className="text-right">Documentos</TableHead>
                  <TableHead className="text-right">Km</TableHead>
                  <TableHead>Rango</TableHead>
                  <TableHead className="text-right">Monto</TableHead>
                  <TableHead>Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtradas.slice(0, visibles).map((p) => (
                  <TableRow key={`${p.rutaId}-${p.clienteId}`}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(p.fecha)}</TableCell>
                    <TableCell>{p.conductor ?? <span className="text-muted-foreground">{p.placa}</span>}</TableCell>
                    <TableCell className="text-muted-foreground">{p.rutaNumero}</TableCell>
                    <TableCell>
                      <span className="font-medium">{p.clienteNombre}</span>
                      <span className="block text-xs text-muted-foreground">
                        {p.clienteCodigo} · {p.ciudad}
                      </span>
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground" title={p.numeros}>
                      {formatNumero(p.despachos)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {p.km == null ? (
                        <span className="text-warning">sin calcular</span>
                      ) : (
                        <span title={p.fuenteKm === "estimada" ? "Distancia estimada (el servicio de rutas no respondió)" : "Distancia por la red vial"}>
                          {formatNumero(p.km, 1)}
                          {p.fuenteKm === "estimada" && " *"}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{p.rango ?? "—"}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {p.montoUsd == null ? "—" : formatUsd(p.montoUsd, 2)}
                    </TableCell>
                    <TableCell>
                      <StatusBadge
                        label={p.liquidada ? "Pagado" : "Pendiente"}
                        tone={p.liquidada ? "success" : "warning"}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>
            {formatNumero(Math.min(visibles, filtradas.length))} de {formatNumero(filtradas.length)} entregas. El «*»
            marca distancias estimadas, no por la red vial.
          </span>
          {filtradas.length > visibles && (
            <Button variant="ghost" size="sm" onClick={() => setVisibles((v) => v + TRAMO)}>
              Mostrar más
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
