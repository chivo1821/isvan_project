import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { convertirUsdABs, formatBsAmount, formatBs, formatCurrency, formatDate } from "@/lib/constants";
import { getFacturasPendientesByCliente, getVentasEnRevision } from "@/lib/mock-data";

export default async function RevisionVentasPage() {
  const ventasSinFacturas = await getVentasEnRevision();
  const ventas = await Promise.all(
    ventasSinFacturas.map(async (venta) => ({
      venta,
      facturas: await getFacturasPendientesByCliente(venta.cliente.codigo),
    }))
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Revisión de ventas"
        subtitle="Ventas pendientes de aprobación porque el cliente tiene facturas pendientes o vencidas"
        helpText="Esta cola es independiente de la aprobación de despachos. Una venta debe pasar por aquí antes de generar su despacho, solo si el cliente tiene deuda."
      />
      <Card>
        <CardContent>
          {ventas.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No hay ventas pendientes de revisión.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>N° Venta</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Facturas pendientes</TableHead>
                  <TableHead>Monto adeudado</TableHead>
                  <TableHead className="text-right">Total de la venta</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ventas.map(({ venta, facturas }) => {
                  const montoAdeudado = facturas.reduce((sum, f) => sum + f.monto, 0);
                  // Cada factura puede tener su propia tasa BCV "congelada"; se suma el
                  // Bs ya convertido de cada una en vez de aplicar una sola tasa al total.
                  const montoAdeudadoBs = facturas.reduce((sum, f) => sum + convertirUsdABs(f.monto, f.tasaBcv), 0);
                  return (
                    <TableRow key={venta.id} className="cursor-pointer">
                      <TableCell className="font-medium">
                        <Link href={`/ventas/revision/${venta.id}`} className="hover:underline">
                          {venta.numero}
                        </Link>
                      </TableCell>
                      <TableCell>
                        {venta.cliente.nombre}
                        <span className="ml-1.5 text-xs text-muted-foreground">{venta.cliente.codigo}</span>
                      </TableCell>
                      <TableCell>{formatDate(venta.fecha)}</TableCell>
                      <TableCell>
                        <StatusBadge tone="warning" label={`${facturas.length} factura(s)`} />
                      </TableCell>
                      <TableCell className="leading-tight">
                        <p>{formatCurrency(montoAdeudado)}</p>
                        <p className="text-xs text-muted-foreground">{formatBsAmount(montoAdeudadoBs)}</p>
                      </TableCell>
                      <TableCell className="text-right font-medium leading-tight">
                        <p>{formatCurrency(venta.total)}</p>
                        <p className="text-xs font-normal text-muted-foreground">{formatBs(venta.total, venta.tasaBcv)}</p>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
