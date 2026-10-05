"use client";

import { useState, useTransition } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeftIcon, ChevronRightIcon, DownloadIcon, Loader2Icon, SearchIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { API_URL } from "@/lib/api-client";
import { queryCenso, type FiltrosCenso, type ListaCensos } from "@/lib/censo";
import { formatDateTime, formatNumero } from "@/lib/constants";

const LeafletMap = dynamic(() => import("@/components/map/leaflet-map").then((m) => m.LeafletMap), {
  ssr: false,
  loading: () => <div className="h-72 w-full animate-pulse rounded-lg bg-muted" />,
});
const PuntoCenso = dynamic(() => import("@/components/map/punto-censo").then((m) => m.PuntoCenso), { ssr: false });

const TODOS = "";

function Selector({
  etiqueta,
  valor,
  opciones,
  onCambio,
}: {
  etiqueta: string;
  valor: string;
  opciones: string[];
  onCambio: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
      {etiqueta}
      <select
        value={valor}
        onChange={(e) => onCambio(e.target.value)}
        className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground"
      >
        <option value={TODOS}>Todos</option>
        {opciones.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

/** La lista de censos del ADMIN, con filtros que viven en la URL (la página
 * se vuelve a pedir al servidor con cada cambio). */
export function ListaDeCensos({ datos, filtros }: { datos: ListaCensos; filtros: FiltrosCenso }) {
  const router = useRouter();
  const [actualizando, startTransition] = useTransition();
  const [busqueda, setBusqueda] = useState(filtros.q);

  function aplicar(cambios: Partial<FiltrosCenso>) {
    const nuevos = { ...filtros, pagina: 1, ...cambios };
    startTransition(() => router.replace(`/censo?${queryCenso(nuevos)}`, { scroll: false }));
  }

  const hayFiltros =
    !!filtros.desde || !!filtros.hasta || !!filtros.q || filtros.encuestador.length + filtros.tipoCliente.length + filtros.empresa.length > 0;
  const paginas = Math.max(1, Math.ceil(datos.total / datos.porPagina));
  const centro: [number, number] = datos.puntos.length ? [datos.puntos[0].lat, datos.puntos[0].lng] : [10.49, -66.88];
  const limites = datos.puntos.length > 1 ? datos.puntos.map((p) => [p.lat, p.lng] as [number, number]) : undefined;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-3 py-4">
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              aplicar({ q: busqueda });
            }}
          >
            <label className="flex min-w-56 flex-1 flex-col gap-1 text-xs text-muted-foreground">
              Buscar
              <span className="relative">
                <SearchIcon className="absolute top-2.5 left-2.5 size-4" />
                <Input
                  value={busqueda}
                  onChange={(e) => setBusqueda(e.target.value)}
                  placeholder="Comercio, RIF, código o teléfono"
                  className="pl-8"
                />
              </span>
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Desde
              <Input type="date" value={filtros.desde ?? ""} onChange={(e) => aplicar({ desde: e.target.value || null })} />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Hasta
              <Input type="date" value={filtros.hasta ?? ""} onChange={(e) => aplicar({ hasta: e.target.value || null })} />
            </label>
            <Selector
              etiqueta="Encuestador"
              valor={filtros.encuestador[0] ?? TODOS}
              opciones={datos.opciones.encuestador}
              onCambio={(v) => aplicar({ encuestador: v ? [v] : [] })}
            />
            <Selector
              etiqueta="Tipo de cliente"
              valor={filtros.tipoCliente[0] ?? TODOS}
              opciones={datos.opciones.tipoCliente}
              onCambio={(v) => aplicar({ tipoCliente: v ? [v] : [] })}
            />
            <Selector
              etiqueta="Empresa"
              valor={filtros.empresa[0] ?? TODOS}
              opciones={datos.opciones.empresa}
              onCambio={(v) => aplicar({ empresa: v ? [v] : [] })}
            />
            <Button type="submit" variant="outline">
              <SearchIcon /> Buscar
            </Button>
            {hayFiltros && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setBusqueda("");
                  aplicar({ desde: null, hasta: null, encuestador: [], tipoCliente: [], empresa: [], q: "" });
                }}
              >
                <XIcon /> Limpiar
              </Button>
            )}
            {actualizando && <Loader2Icon className="mb-2.5 size-4 animate-spin text-muted-foreground" />}
          </form>
        </CardContent>
      </Card>

      {datos.puntos.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Dónde se censó</CardTitle>
          </CardHeader>
          <CardContent>
            <LeafletMap center={centro} zoom={12} bounds={limites} className="h-72">
              {datos.puntos.map((p) => (
                <PuntoCenso key={p.id} punto={p} />
              ))}
            </LeafletMap>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
          <CardTitle>
            {formatNumero(datos.total)} censo{datos.total === 1 ? "" : "s"}
          </CardTitle>
          {datos.total > 0 && (
            <Button variant="outline" asChild>
              <a href={`${API_URL}/censo/exportar.xlsx?${queryCenso(filtros, false)}`}>
                <DownloadIcon /> Descargar Excel
              </a>
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {datos.censos.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {hayFiltros ? "Ningún censo coincide con los filtros." : "Todavía no se ha enviado ningún censo."}
            </p>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Comercio</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Empresa</TableHead>
                    <TableHead>Ruta</TableHead>
                    <TableHead>Encuestador</TableHead>
                    <TableHead className="text-right">Fotos</TableHead>
                    <TableHead>Recibido</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {datos.censos.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell>
                        <Link href={`/censo/${c.id}`} className="font-medium underline-offset-4 hover:underline">
                          {c.nombreComercio ?? "Sin nombre"}
                        </Link>
                        <span className="block text-xs text-muted-foreground">
                          {[c.rif && `RIF ${c.rif}`, c.telefono].filter(Boolean).join(" · ")}
                        </span>
                      </TableCell>
                      <TableCell>{c.tipoCliente ?? "—"}</TableCell>
                      <TableCell>{c.empresa ?? "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{c.ruta ?? "—"}</TableCell>
                      <TableCell>
                        {c.encuestador ?? "—"}
                        <span className="block text-xs text-muted-foreground">{c.usuario}</span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{c.fotos}</TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">{formatDateTime(c.recibidoEn)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {paginas > 1 && (
                <div className="flex items-center justify-end gap-2 pt-3 text-sm">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={filtros.pagina <= 1}
                    onClick={() => aplicar({ pagina: filtros.pagina - 1 })}
                  >
                    <ChevronLeftIcon /> Anterior
                  </Button>
                  <span className="text-muted-foreground tabular-nums">
                    Página {filtros.pagina} de {paginas}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={filtros.pagina >= paginas}
                    onClick={() => aplicar({ pagina: filtros.pagina + 1 })}
                  >
                    Siguiente <ChevronRightIcon />
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
