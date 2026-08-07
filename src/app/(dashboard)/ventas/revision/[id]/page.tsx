import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { RevisionActions } from "@/components/modules/ventas/revision-actions";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  convertirUsdABs,
  ESTADO_FACTURA_META,
  ESTADO_VENTA_META,
  formatBs,
  formatBsAmount,
  formatCurrency,
  formatDate,
} from "@/lib/constants";
import { getFacturasPendientesByCliente, getVentaConDetalle } from "@/lib/mock-data";

export default async function RevisionVentaDetallePage({ params }: PageProps<"/ventas/revision/[id]">) {
  const { id } = await params;
  const venta = getVentaConDetalle(id);
  if (!venta) notFound();

  const facturasPendientes = getFacturasPendientesByCliente(venta.cliente.codigo);
  const montoAdeudado = facturasPendientes.reduce((sum, f) => sum + f.monto, 0);
  const montoAdeudadoBs = facturasPendientes.reduce((sum, f) => sum + convertirUsdABs(f.monto, f.tasaBcv), 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Revisión — ${venta.numero}`}
        subtitle={`Cliente: ${venta.cliente.nombre} (${venta.cliente.codigo})`}
        actions={<StatusBadge {...ESTADO_VENTA_META[venta.estado]} />}
      />

      <Card>
        <CardHeader>
          <CardTitle>Facturas pendientes y vencidas</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>N° Factura</TableHead>
                <TableHead>Emisión</TableHead>
                <TableHead>Vencimiento</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Monto</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {facturasPendientes.map((f) => (
                <TableRow key={f.id}>
                  <TableCell>{f.numero}</TableCell>
                  <TableCell>{formatDate(f.fechaEmision)}</TableCell>
                  <TableCell>{formatDate(f.fechaVencimiento)}</TableCell>
                  <TableCell>
                    <StatusBadge {...ESTADO_FACTURA_META[f.estado]} />
                  </TableCell>
                  <TableCell className="text-right leading-tight">
                    <p>{formatCurrency(f.monto)}</p>
                    <p className="text-xs text-muted-foreground">{formatBs(f.monto, f.tasaBcv)}</p>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="mt-3 flex items-baseline justify-end gap-1.5 border-t border-border pt-3">
            <span className="text-sm font-medium text-muted-foreground">Total adeudado:</span>
            <span className="text-sm font-bold text-destructive">{formatCurrency(montoAdeudado)}</span>
            <span className="text-xs text-muted-foreground">({formatBsAmount(montoAdeudadoBs)})</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Detalle de la venta</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Producto</TableHead>
                <TableHead className="text-right">Cantidad</TableHead>
                <TableHead className="text-right">Subtotal</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {venta.itemsConProducto.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>{item.producto.nombre}</TableCell>
                  <TableCell className="text-right">{item.cantidad}</TableCell>
                  <TableCell className="text-right leading-tight">
                    <p>{formatCurrency(item.subtotal)}</p>
                    <p className="text-xs text-muted-foreground">{formatBs(item.subtotal, venta.tasaBcv)}</p>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="mt-3 flex items-baseline justify-end gap-1.5 border-t border-border pt-3">
            <span className="text-sm font-medium text-muted-foreground">Total de la venta:</span>
            <span className="text-sm font-bold text-foreground">{formatCurrency(venta.total)}</span>
            <span className="text-xs text-muted-foreground">({formatBs(venta.total, venta.tasaBcv)})</span>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between rounded-lg border border-border bg-card p-4">
        <div className="text-sm text-muted-foreground">
          <Link href={`/ventas/${venta.id}`} className="hover:underline">
            Ver venta completa →
          </Link>
        </div>
        <RevisionActions ventaNumero={venta.numero} clienteNombre={venta.cliente.nombre} />
      </div>
    </div>
  );
}
