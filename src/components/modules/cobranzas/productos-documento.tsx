import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { DetalleDocumento } from "@/lib/cobranzas";
import { formatBs, formatNumero, formatUsd } from "@/lib/constants";

/** Las líneas de una factura o nota de entrega (extracto de ventas), con el
 * total al pie. La usan cobranzas y el portal del cliente. */
export function ProductosDocumento({ productos }: { productos: DetalleDocumento["productos"] }) {
  if (productos.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        No hay líneas de venta para este documento (no viene del extracto o su carga se revirtió).
      </p>
    );
  }
  const totalUsd = productos.reduce((s, p) => s + p.montoUsd, 0);
  const totalBs = productos.reduce((s, p) => s + p.montoBs, 0);
  const unidades = productos.reduce((s, p) => s + p.unidades, 0);

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Producto</TableHead>
          <TableHead className="hidden text-right md:table-cell">Cajas</TableHead>
          <TableHead className="text-right">Unidades</TableHead>
          <TableHead className="hidden text-right sm:table-cell">Precio unit.</TableHead>
          <TableHead className="text-right">Total USD</TableHead>
          <TableHead className="hidden text-right lg:table-cell">Total Bs</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {productos.map((p, i) => (
          <TableRow key={`${p.codigo}-${i}`}>
            <TableCell>
              <span className="font-medium">{p.producto}</span>
              <span className="block text-xs text-muted-foreground">
                {p.codigo}
                {p.grupo && ` · ${p.grupo}`}
              </span>
            </TableCell>
            <TableCell className="hidden text-right tabular-nums md:table-cell">{formatNumero(p.cajas, 2)}</TableCell>
            <TableCell className="text-right tabular-nums">{formatNumero(p.unidades)}</TableCell>
            <TableCell className="hidden text-right tabular-nums sm:table-cell">
              {p.precioUnitarioUsd != null ? formatUsd(p.precioUnitarioUsd, 2) : "—"}
            </TableCell>
            <TableCell className="text-right font-medium tabular-nums">{formatUsd(p.montoUsd, 2)}</TableCell>
            <TableCell className="hidden text-right tabular-nums lg:table-cell">{formatBs(p.montoBs)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
      <TableFooter>
        <TableRow>
          <TableCell className="font-semibold">Total del documento</TableCell>
          <TableCell className="hidden md:table-cell" />
          <TableCell className="text-right tabular-nums">{formatNumero(unidades)}</TableCell>
          <TableCell className="hidden sm:table-cell" />
          <TableCell className="text-right font-semibold tabular-nums">{formatUsd(totalUsd, 2)}</TableCell>
          <TableCell className="hidden text-right font-semibold tabular-nums lg:table-cell">{formatBs(totalBs)}</TableCell>
        </TableRow>
      </TableFooter>
    </Table>
  );
}
