import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { AprobacionDespachoActions } from "@/components/modules/despachos/aprobacion-actions";
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
import { CATEGORIA_PRODUCTO_META, ESTADO_DESPACHO_META } from "@/lib/constants";
import { getDespachoConDetalle, getUsuarioActualRaw } from "@/lib/mock-data";

export default async function AprobacionDespachoDetallePage({ params }: PageProps<"/despachos/aprobacion/[id]">) {
  const { id } = await params;
  const [despacho, usuarioActual] = await Promise.all([getDespachoConDetalle(id), getUsuarioActualRaw()]);
  if (!despacho) notFound();

  const requiereCadenaFrio = despacho.itemsConProducto.some((item) => item.producto.requiereCadenaFrio);

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Aprobación — ${despacho.numero}`}
        subtitle={`${despacho.origen.nombre} → ${despacho.destinoCliente.nombre}`}
        actions={<StatusBadge {...ESTADO_DESPACHO_META[despacho.estado]} />}
      />

      <Card>
        <CardHeader>
          <CardTitle>Productos</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Producto</TableHead>
                <TableHead>Categoría</TableHead>
                <TableHead className="text-right">Cantidad</TableHead>
                <TableHead>Cadena de frío</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {despacho.itemsConProducto.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>{item.producto.nombre}</TableCell>
                  <TableCell>
                    <StatusBadge {...CATEGORIA_PRODUCTO_META[item.producto.categoria]} />
                  </TableCell>
                  <TableCell className="text-right">
                    {item.cantidad}
                    {item.cantidadSolicitada !== item.cantidad && (
                      <span className="ml-1 text-xs text-warning">(de {item.cantidadSolicitada} pedidos)</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {item.producto.requiereCadenaFrio ? (
                      <StatusBadge tone="info" label="Requerida" />
                    ) : (
                      <StatusBadge tone="neutral" label="No requerida" />
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {requiereCadenaFrio && (
            <p className="mt-3 text-xs text-muted-foreground">
              Este despacho incluye productos con cadena de frío — verifica que el vehículo asignado esté
              refrigerado antes de aprobar.
            </p>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between rounded-lg border border-border bg-card p-4">
        <Link href={`/despachos/${despacho.id}`} className="text-sm text-muted-foreground hover:underline">
          Ver despacho completo →
        </Link>
        <AprobacionDespachoActions
          despachoId={despacho.id}
          despachoNumero={despacho.numero}
          destinoNombre={despacho.destinoCliente.nombre}
          usuarioId={usuarioActual.id}
        />
      </div>
    </div>
  );
}
