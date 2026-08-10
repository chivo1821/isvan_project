import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangleIcon, TruckIcon } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
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
  ESTADO_FACTURA_META,
  ESTADO_VENTA_META,
  formatBs,
  formatCurrency,
  formatDate,
  formatDateTime,
} from "@/lib/constants";
import { getFacturasByCliente, getVentaConDetalle } from "@/lib/mock-data";

export default async function VentaDetallePage({ params }: PageProps<"/ventas/[id]">) {
  const { id } = await params;
  const venta = await getVentaConDetalle(id);
  if (!venta) notFound();

  const facturas = await getFacturasByCliente(venta.cliente.codigo);
  const facturasPendientes = facturas.filter((f) => f.estado === "PENDIENTE" || f.estado === "VENCIDA");

  return (
    <div className="space-y-6">
      <PageHeader
        title={venta.numero}
        subtitle={`Registrada el ${formatDate(venta.fecha)} por ${venta.vendedor.nombre}`}
        actions={<StatusBadge {...ESTADO_VENTA_META[venta.estado]} />}
      />

      {venta.estado === "EN_REVISION" && (
        <Alert variant="destructive">
          <AlertTriangleIcon />
          <AlertTitle>Esta venta está en revisión</AlertTitle>
          <AlertDescription>
            El cliente tiene facturas pendientes o vencidas. La venta no genera despacho hasta que un aprobador la
            revise.{" "}
            <Link href={`/ventas/revision/${venta.id}`}>Ir a revisión</Link>
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Cliente</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            <p className="font-medium text-foreground">{venta.cliente.nombre}</p>
            <p className="text-muted-foreground">{venta.cliente.codigo}</p>
            <p className="text-muted-foreground">{venta.cliente.tipo}</p>
            <p className="text-muted-foreground">
              {venta.cliente.direccion}, {venta.cliente.ciudad}
            </p>
            {venta.cliente.telefono && <p className="text-muted-foreground">{venta.cliente.telefono}</p>}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Facturas del cliente</CardTitle>
          </CardHeader>
          <CardContent>
            {facturas.length === 0 ? (
              <p className="text-sm text-muted-foreground">Este cliente no tiene facturas registradas.</p>
            ) : (
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
                  {facturas.map((f) => (
                    <TableRow key={f.id}>
                      <TableCell>{f.numero}</TableCell>
                      <TableCell>{formatDate(f.fechaEmision)}</TableCell>
                      <TableCell>{formatDate(f.fechaVencimiento)}</TableCell>
                      <TableCell>
                        <div className="flex flex-col items-start gap-1">
                          <StatusBadge {...ESTADO_FACTURA_META[f.estado]} />
                          {f.fechaPago && (
                            <StatusBadge
                              tone={f.pagoAprobado ? "success" : "warning"}
                              label={f.pagoAprobado ? "Pago aprobado" : "Pago sin aprobar"}
                            />
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right leading-tight">
                        <p>{formatCurrency(f.monto)}</p>
                        <p className="text-xs text-muted-foreground">{formatBs(f.monto, f.tasaBcv)}</p>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            {facturasPendientes.length > 0 && (
              <p className="mt-3 text-xs text-muted-foreground">
                {facturasPendientes.length} factura{facturasPendientes.length !== 1 && "s"} pendiente(s) o
                vencida(s) — esto es lo que dispara la revisión de la venta.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Productos</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Producto</TableHead>
                <TableHead className="text-right">Cantidad</TableHead>
                <TableHead className="text-right">Precio unitario</TableHead>
                <TableHead className="text-right">Subtotal</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {venta.itemsConProducto.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <Link href={`/inventario/${item.producto.id}`} className="hover:underline">
                      {item.producto.nombre}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right">{item.cantidad}</TableCell>
                  <TableCell className="text-right leading-tight">
                    <p>{formatCurrency(item.precioUnitario)}</p>
                    <p className="text-xs text-muted-foreground">{formatBs(item.precioUnitario, venta.tasaBcv)}</p>
                  </TableCell>
                  <TableCell className="text-right leading-tight">
                    <p>{formatCurrency(item.subtotal)}</p>
                    <p className="text-xs text-muted-foreground">{formatBs(item.subtotal, venta.tasaBcv)}</p>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="mt-3 flex items-baseline justify-end gap-1.5 border-t border-border pt-3">
            <span className="text-sm font-medium text-muted-foreground">Total:</span>
            <span className="text-sm font-bold text-foreground">{formatCurrency(venta.total)}</span>
            <span className="text-xs text-muted-foreground">({formatBs(venta.total, venta.tasaBcv)})</span>
          </div>
        </CardContent>
      </Card>

      {venta.revisiones.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Historial de revisión</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {venta.revisiones.map((rev) => (
              <div key={rev.id} className="rounded-lg border border-border p-3 text-sm">
                <div className="flex items-center justify-between">
                  <StatusBadge
                    label={rev.accion === "APROBADA" ? "Aprobada" : "Rechazada"}
                    tone={rev.accion === "APROBADA" ? "success" : "destructive"}
                  />
                  <span className="text-xs text-muted-foreground">{formatDateTime(rev.fecha)}</span>
                </div>
                {rev.comentario && <p className="mt-2 text-muted-foreground">{rev.comentario}</p>}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {venta.despacho && (
        <Card>
          <CardHeader>
            <CardTitle>Despacho generado</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm">
              <TruckIcon className="size-4 text-muted-foreground" />
              <span className="font-medium">{venta.despacho.numero}</span>
            </div>
            <Button variant="outline" size="sm" asChild>
              <Link href={`/despachos/${venta.despacho.id}`}>Ver despacho</Link>
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
