"use client";

import { useState } from "react";
import { SearchIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/shared/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatNumero, formatUsd } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { ParadaDelivery } from "@/lib/delivery";
import { NoSePagaDialog, VolverAPendienteButton } from "./no-se-paga";

const TRAMO = 50;

/** Las pendientes de la misma ruta y moto que `p`: para marcar la ruta entera. */
function pendientesDeLaRuta(paradas: ParadaDelivery[], p: ParadaDelivery) {
  return paradas.filter(
    (q) =>
      q.rutaId === p.rutaId &&
      q.vehiculoId === p.vehiculoId &&
      !q.liquidada &&
      !q.excluida &&
      q.montoUsd != null
  );
}

function paraBuscar(texto: string) {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Una fila por entrega pagable: el respaldo del pago, para revisarlo con el
 * motorizado. Se paga una vez por parada, aunque lleve varios documentos. */
function estadoDe(p: ParadaDelivery) {
  if (p.liquidada) return { label: "Pagado", tone: "success" as const };
  if (p.excluida) return { label: "No se paga", tone: "neutral" as const };
  return { label: "Pendiente", tone: "warning" as const };
}

export function DetalleParadas({
  paradas,
  conMotorizado = true,
  acciones = false,
}: {
  paradas: ParadaDelivery[];
  /** false en el estado de cuenta del propio repartidor: todas son suyas. */
  conMotorizado?: boolean;
  /** Marcar «no se paga» o volver a pendiente (solo el tablero del ADMIN). */
  acciones?: boolean;
}) {
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
                  {conMotorizado && <TableHead>Motorizado</TableHead>}
                  <TableHead>Ruta</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead className="text-right">Documentos</TableHead>
                  <TableHead className="text-right">Km</TableHead>
                  <TableHead>Rango</TableHead>
                  <TableHead className="text-right">Monto</TableHead>
                  <TableHead>Estado</TableHead>
                  {acciones && <TableHead className="w-0" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtradas.slice(0, visibles).map((p) => {
                  const estado = estadoDe(p);
                  return (
                  <TableRow
                    key={`${p.rutaId}-${p.clienteId}-${p.vehiculoId}`}
                    className={p.excluida ? "text-muted-foreground" : undefined}
                  >
                    <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(p.fecha)}</TableCell>
                    {conMotorizado && (
                      <TableCell>{p.conductor ?? <span className="text-muted-foreground">{p.placa}</span>}</TableCell>
                    )}
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
                    <TableCell className={cn("text-right font-medium tabular-nums", p.excluida && "line-through")}>
                      {p.montoUsd == null ? "—" : formatUsd(p.montoUsd, 2)}
                    </TableCell>
                    <TableCell>
                      <StatusBadge label={estado.label} tone={estado.tone} />
                      {p.excluida && p.motivoExclusion && (
                        <span className="mt-0.5 block max-w-48 text-xs text-muted-foreground">{p.motivoExclusion}</span>
                      )}
                    </TableCell>
                    {acciones && (
                      <TableCell className="text-right">
                        {p.excluida ? (
                          <VolverAPendienteButton parada={p} />
                        ) : !p.liquidada && p.montoUsd != null ? (
                          <NoSePagaDialog parada={p} deLaRuta={pendientesDeLaRuta(paradas, p)} />
                        ) : null}
                      </TableCell>
                    )}
                  </TableRow>
                  );
                })}
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
