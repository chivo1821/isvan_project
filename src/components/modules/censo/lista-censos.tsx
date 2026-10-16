"use client";

import Link from "next/link";
import { ChevronLeftIcon, ChevronRightIcon, DownloadIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { API_URL } from "@/lib/api-client";
import { queryCenso, type FiltrosCenso, type ListaCensos } from "@/lib/censo";
import { formatDateTime, formatNumero } from "@/lib/constants";
import { hayFiltrosCenso, useAplicarFiltros } from "./filtros-censo";

/** La pestaña Registros del tablero: los censos uno por uno, con su Excel.
 * Los filtros están arriba del tablero (filtros-censo.tsx). */
export function ListaDeCensos({ datos, filtros }: { datos: ListaCensos; filtros: FiltrosCenso }) {
  const { aplicar } = useAplicarFiltros(filtros);
  const hayFiltros = hayFiltrosCenso(filtros);
  const paginas = Math.max(1, Math.ceil(datos.total / datos.porPagina));

  return (
    <div className="space-y-4">
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
