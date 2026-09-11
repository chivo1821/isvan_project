import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatNumero, formatPct, formatUsd } from "@/lib/constants";
import type { Desglose, Dimension, FilaDesglose } from "@/lib/indicadores";

const PESTANAS: { dimension: Dimension; label: string; columna: string; conCodigo?: boolean }[] = [
  { dimension: "ruta", label: "Ruta", columna: "Ruta" },
  { dimension: "grupo", label: "Grupo", columna: "Grupo de producto" },
  { dimension: "tipo_cliente", label: "Tipo de cliente", columna: "Tipo de cliente" },
  { dimension: "producto", label: "Producto", columna: "Producto", conCodigo: true },
  { dimension: "cliente", label: "Cliente", columna: "Cliente", conCodigo: true },
];

function margen(fila: FilaDesglose) {
  // Sin ningún producto con costo el margen sería la venta entera: se dice
  // que no hay costo en vez de mostrar un 100 % que no es real.
  if (fila.ventaSinCosto >= fila.ventaNeta * 0.999) return <span className="text-muted-foreground">sin costo</span>;
  return (
    <span title={fila.ventaSinCosto > 0 ? `Incluye ${formatUsd(fila.ventaSinCosto)} de venta sin costo` : undefined}>
      {formatPct(fila.margenPct)}
      {fila.ventaSinCosto > 0 && <span className="text-warning">*</span>}
    </span>
  );
}

function TablaDimension({
  desglose,
  columna,
  conCodigo,
  total,
  mostrarClientes,
}: {
  desglose: Desglose;
  columna: string;
  conCodigo?: boolean;
  total: number;
  mostrarClientes: boolean;
}) {
  if (desglose.filas.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">Sin ventas en este período.</p>;
  }
  return (
    <div className="space-y-2">
      <div className="max-h-[28rem] overflow-auto rounded-lg border border-border">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-card">
            <TableRow>
              <TableHead>{columna}</TableHead>
              <TableHead className="text-right">Venta neta</TableHead>
              <TableHead className="text-right">Part.</TableHead>
              <TableHead className="text-right">Devol.</TableHead>
              <TableHead className="text-right">Litros</TableHead>
              <TableHead className="text-right">Margen</TableHead>
              {mostrarClientes && <TableHead className="text-right">Clientes</TableHead>}
              <TableHead className="text-right">Ticket</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {desglose.filas.map((fila) => (
              <TableRow key={fila.clave}>
                <TableCell className="max-w-72">
                  <span className="block truncate font-medium" title={fila.nombre}>
                    {fila.nombre}
                  </span>
                  {conCodigo && (
                    <span className="text-xs text-muted-foreground">
                      {fila.clave}
                      {fila.detalle && ` · ${fila.detalle}`}
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">{formatUsd(fila.ventaNeta)}</TableCell>
                <TableCell className="text-right text-muted-foreground tabular-nums">
                  {formatPct(total ? fila.ventaNeta / total : null)}
                </TableCell>
                <TableCell className="text-right tabular-nums">{formatPct(fila.pctDevolucion)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatNumero(fila.litros)}</TableCell>
                <TableCell className="text-right tabular-nums">{margen(fila)}</TableCell>
                {mostrarClientes && (
                  <TableCell className="text-right tabular-nums">{formatNumero(fila.clientes)}</TableCell>
                )}
                <TableCell className="text-right tabular-nums">{formatUsd(fila.ticketPromedio)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-muted-foreground">
        {desglose.totalGrupos > desglose.filas.length &&
          `Los ${desglose.filas.length} que más venden, de ${formatNumero(desglose.totalGrupos)}. `}
        Part. = participación en la venta neta del período. Devol. = devoluciones sobre la venta bruta.
        {desglose.filas.some((f) => f.ventaSinCosto > 0 && f.ventaSinCosto < f.ventaNeta * 0.999) &&
          " * El margen incluye venta de productos sin costo cargado."}
      </p>
    </div>
  );
}

export function DesgloseTabla({ desgloses, total }: { desgloses: Record<Dimension, Desglose>; total: number }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Desglose</CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="ruta">
          <div className="overflow-x-auto">
            <TabsList>
              {PESTANAS.map((p) => (
                <TabsTrigger key={p.dimension} value={p.dimension}>
                  {p.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
          {PESTANAS.map((p) => (
            <TabsContent key={p.dimension} value={p.dimension} className="pt-2">
              <TablaDimension
                desglose={desgloses[p.dimension]}
                columna={p.columna}
                conCodigo={p.conCodigo}
                total={total}
                mostrarClientes={p.dimension !== "cliente"}
              />
            </TabsContent>
          ))}
        </Tabs>
      </CardContent>
    </Card>
  );
}
