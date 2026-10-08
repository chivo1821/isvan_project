import { StatusBadge } from "@/components/shared/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ESTADO_DOCUMENTO_META, nombreDocumento, type Documento } from "@/lib/cobranzas";
import { formatDate, formatUsd } from "@/lib/constants";

/** Facturas y notas de entrega con lo abonado y lo que falta. En el
 * teléfono se ocultan las columnas secundarias (fecha, monto, abonado): el
 * saldo y el estado son lo que importa. */
export function DocumentosTabla({
  documentos,
  mostrarCliente = false,
  vacio = "No hay documentos.",
}: {
  documentos: (Documento & { nombreCliente?: string })[];
  mostrarCliente?: boolean;
  vacio?: string;
}) {
  if (documentos.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">{vacio}</p>;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Documento</TableHead>
          <TableHead className="hidden sm:table-cell">Fecha</TableHead>
          <TableHead>Vence</TableHead>
          <TableHead className="hidden text-right md:table-cell">Monto</TableHead>
          <TableHead className="hidden text-right md:table-cell">Abonado</TableHead>
          <TableHead className="text-right">Saldo</TableHead>
          <TableHead>Estado</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {documentos.map((d) => {
          const meta = ESTADO_DOCUMENTO_META[d.estado];
          return (
            <TableRow key={d.id}>
              <TableCell>
                <span className="font-medium">{nombreDocumento(d)}</span>
                {mostrarCliente && d.nombreCliente && (
                  <span className="block text-xs text-muted-foreground">
                    {d.nombreCliente} · {d.empresa}
                  </span>
                )}
              </TableCell>
              <TableCell className="hidden tabular-nums sm:table-cell">{formatDate(d.fecha)}</TableCell>
              <TableCell className="tabular-nums">
                {formatDate(d.vence)}
                {d.diasAtraso > 0 && <span className="block text-xs text-destructive">{d.diasAtraso} días de atraso</span>}
              </TableCell>
              <TableCell className="hidden text-right tabular-nums md:table-cell">{formatUsd(d.montoUsd, 2)}</TableCell>
              <TableCell className="hidden text-right tabular-nums md:table-cell">{formatUsd(d.abonadoUsd, 2)}</TableCell>
              <TableCell className="text-right font-semibold tabular-nums">{formatUsd(d.saldoUsd, 2)}</TableCell>
              <TableCell>
                <StatusBadge label={meta.label} tone={meta.tone} />
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
