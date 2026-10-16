import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { METODO_PAGO_LABEL, TIPO_DOCUMENTO_LABEL, type EstadoDeCuenta } from "@/lib/cobranzas";
import { formatDate, formatUsd } from "@/lib/constants";

/** Estado de cuenta: cargos (facturas y notas de entrega), abonos
 * (devoluciones y pagos verificados) y el saldo después de cada uno. */
export function MovimientosTabla({
  estado,
  conSaldoInicial,
  nombreCliente,
}: {
  estado: EstadoDeCuenta;
  conSaldoInicial: boolean;
  nombreCliente?: (empresa: string, codigo: string) => string | undefined;
}) {
  if (estado.movimientos.length === 0 && !conSaldoInicial) {
    return <p className="py-6 text-center text-sm text-muted-foreground">No hay movimientos en este período.</p>;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Fecha</TableHead>
          <TableHead>Concepto</TableHead>
          <TableHead className="text-right">Cargo</TableHead>
          <TableHead className="text-right">Abono</TableHead>
          <TableHead className="text-right">Saldo</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {conSaldoInicial && (
          <TableRow className="bg-muted/40">
            <TableCell />
            <TableCell className="font-medium">Saldo al inicio del período</TableCell>
            <TableCell />
            <TableCell />
            <TableCell className="text-right font-medium tabular-nums">{formatUsd(estado.saldoInicialUsd, 2)}</TableCell>
          </TableRow>
        )}
        {estado.movimientos.map((m, i) => (
          <TableRow key={`${m.tipo}-${m.referencia}-${i}`}>
            <TableCell className="tabular-nums whitespace-nowrap">{formatDate(m.fecha)}</TableCell>
            <TableCell>
              <span className="font-medium">
                {m.tipo === "PAGO" ? `Pago ${m.metodo ? METODO_PAGO_LABEL[m.metodo].toLowerCase() : ""}` : TIPO_DOCUMENTO_LABEL[m.tipo] ?? m.tipo}
              </span>{" "}
              <span className="text-muted-foreground">{m.referencia}</span>
              {nombreCliente && (
                <span className="block text-xs text-muted-foreground">{nombreCliente(m.empresa, m.codigoCliente)}</span>
              )}
            </TableCell>
            <TableCell className="text-right tabular-nums">{m.cargoUsd ? formatUsd(m.cargoUsd, 2) : ""}</TableCell>
            <TableCell className="text-right tabular-nums text-success">{m.abonoUsd ? formatUsd(m.abonoUsd, 2) : ""}</TableCell>
            <TableCell className="text-right tabular-nums">{formatUsd(m.saldoUsd, 2)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
      <TableFooter>
        <TableRow>
          <TableCell colSpan={4} className="font-semibold">
            Saldo al cierre
          </TableCell>
          <TableCell className="text-right font-semibold tabular-nums">{formatUsd(estado.saldoFinalUsd, 2)}</TableCell>
        </TableRow>
      </TableFooter>
    </Table>
  );
}
