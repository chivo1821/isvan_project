"use client";

import { useState } from "react";
import Link from "next/link";
import { PackageSearchIcon, SearchIcon } from "lucide-react";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { coincideBusqueda } from "@/lib/busqueda";
import { documentoDespacho, estadoDeParada, formatDate, formatHora, type Tone } from "@/lib/constants";
import {
  CATEGORIA_DESPACHO_META,
  categoriaDespacho,
  type CategoriaDespacho,
  type DespachoLista,
} from "@/lib/vendedor";

const FILTROS: CategoriaDespacho[] = ["pendiente", "cargado", "en_camino", "entregado"];

/** Despachos de los clientes del vendedor, solo para mirar: ¿ya se cargó?,
 * ¿ya salió?, ¿ya llegó? Pensado para el teléfono. El resumen del ADMIN usa
 * la misma lista con todos los clientes, sus propias etiquetas y un enlace
 * al despacho. */
export function DespachosVendedorLista({
  despachos,
  filtroInicial = "todos",
  etiquetas = CATEGORIA_DESPACHO_META,
  enlace,
  mostrarOtros = false,
  vacio = "No hay despachos de tus clientes en los últimos 30 días.",
}: {
  despachos: DespachoLista[];
  filtroInicial?: CategoriaDespacho | "todos";
  etiquetas?: Record<CategoriaDespacho, { label: string; tone: Tone }>;
  /** A dónde lleva el nombre del cliente (el detalle completo del despacho). */
  enlace?: (d: DespachoLista) => string;
  /** Un botón más para los rechazados y cancelados. */
  mostrarOtros?: boolean;
  vacio?: string;
}) {
  const [filtro, setFiltro] = useState<CategoriaDespacho | "todos">(filtroInicial);
  const [busqueda, setBusqueda] = useState("");

  const conCategoria = despachos.map((d) => ({ ...d, categoria: categoriaDespacho(d) }));
  const conteo = (c: CategoriaDespacho) => conCategoria.filter((d) => d.categoria === c).length;
  const filtros: CategoriaDespacho[] = mostrarOtros ? [...FILTROS, "otro"] : FILTROS;
  const visibles = conCategoria.filter(
    (d) =>
      (filtro === "todos" || d.categoria === filtro) &&
      coincideBusqueda(busqueda, [d.clienteNombre, d.clienteCodigo, documentoDespacho(d), d.numeroDocumento, d.numero])
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant={filtro === "todos" ? "default" : "outline"} onClick={() => setFiltro("todos")}>
          Todos ({conCategoria.length})
        </Button>
        {filtros.map((c) => (
          <Button
            key={c}
            size="sm"
            variant={filtro === c ? "default" : "outline"}
            onClick={() => setFiltro(filtro === c ? "todos" : c)}
          >
            {etiquetas[c].label} ({conteo(c)})
          </Button>
        ))}
      </div>

      <div className="relative">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar por cliente, código o documento"
          aria-label="Buscar despachos"
          className="pl-8"
        />
      </div>

      {visibles.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
            <PackageSearchIcon className="size-8" />
            {despachos.length === 0 ? vacio : "Ningún despacho coincide con el filtro."}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {visibles.map((d) => (
            <Card key={d.id}>
              <CardContent className="space-y-2 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    {enlace ? (
                      <Link href={enlace(d)} className="block truncate font-medium text-foreground hover:underline">
                        {d.clienteNombre}
                      </Link>
                    ) : (
                      <p className="truncate font-medium text-foreground">{d.clienteNombre}</p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      Cód. {d.clienteCodigo}
                      {d.rutaVenta && ` · Ruta ${d.rutaVenta}`} · {documentoDespacho(d)}
                    </p>
                  </div>
                  <StatusBadge {...etiquetas[d.categoria]} />
                </div>
                <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
                  {d.rutaNumero ? (
                    <>
                      Viaje {d.rutaNumero}
                      {d.vehiculoPlaca && ` · ${d.vehiculoPlaca}`}
                      <StatusBadge {...estadoDeParada(d)} />
                    </>
                  ) : (
                    "Todavía sin viaje asignado"
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Creado el {formatDate(d.fechaCreacion)}
                  {d.llegadaEn && ` · llegada ${formatHora(d.llegadaEn)}`}
                  {d.entregadoEn && ` · entrega ${formatHora(d.entregadoEn)}`}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
