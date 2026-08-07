import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
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
import { RouteOptimizerSection } from "@/components/modules/despachos/route-optimizer-section";
import { VehiculoSugeridoSection } from "@/components/modules/despachos/vehiculo-sugerido-section";
import { ESTADO_DESPACHO_META, ESTADO_VEHICULO_META, TIPO_VEHICULO_META, formatDateTime } from "@/lib/constants";
import { getDespachoConDetalle } from "@/lib/mock-data";

export default async function DespachoDetallePage({ params }: PageProps<"/despachos/[id]">) {
  const { id } = await params;
  const despacho = getDespachoConDetalle(id);
  if (!despacho) notFound();

  return (
    <div className="space-y-6">
      <PageHeader
        title={despacho.numero}
        subtitle={`Creado el ${formatDateTime(despacho.fechaCreacion)} por ${despacho.creadoPor.nombre}${
          despacho.venta ? ` · desde la venta ${despacho.venta.numero}` : " · despacho manual"
        }`}
        actions={<StatusBadge {...ESTADO_DESPACHO_META[despacho.estado]} />}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Origen</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p className="font-medium text-foreground">{despacho.origen.nombre}</p>
            <p className="text-muted-foreground">{despacho.origen.tipo}</p>
            <p className="text-muted-foreground">
              {despacho.origen.direccion}, {despacho.origen.ciudad}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Destino</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p className="font-medium text-foreground">{despacho.destinoCliente.nombre}</p>
            <p className="text-muted-foreground">
              {despacho.destinoCliente.codigo} · {despacho.destinoCliente.tipo}
            </p>
            <p className="text-muted-foreground">
              {despacho.destinoCliente.direccion}, {despacho.destinoCliente.ciudad}
            </p>
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
              </TableRow>
            </TableHeader>
            <TableBody>
              {despacho.itemsConProducto.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <Link href={`/inventario/${item.producto.id}`} className="hover:underline">
                      {item.producto.nombre}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right">{item.cantidad}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Vehículo asignado</CardTitle>
        </CardHeader>
        <CardContent>
          {despacho.vehiculo ? (
            <div className="flex items-center justify-between text-sm">
              <div>
                <p className="font-medium text-foreground">
                  {despacho.vehiculo.placa} — {TIPO_VEHICULO_META[despacho.vehiculo.tipo].label}
                </p>
                <p className="text-muted-foreground">{despacho.vehiculo.conductorNombre ?? "Sin conductor asignado"}</p>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge {...ESTADO_VEHICULO_META[despacho.vehiculo.estado]} />
                <Link href={`/flota/${despacho.vehiculo.id}`} className="text-sm text-primary hover:underline">
                  Ver vehículo
                </Link>
              </div>
            </div>
          ) : (
            <VehiculoSugeridoSection despachoId={despacho.id} />
          )}
        </CardContent>
      </Card>

      <RouteOptimizerSection despacho={despacho} />

      {despacho.aprobaciones.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Historial de aprobación</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {despacho.aprobaciones.map((ap) => (
              <div key={ap.id} className="rounded-lg border border-border p-3 text-sm">
                <div className="flex items-center justify-between">
                  <StatusBadge
                    label={ap.accion === "APROBADA" ? "Aprobado" : "Rechazado"}
                    tone={ap.accion === "APROBADA" ? "success" : "destructive"}
                  />
                  <span className="text-xs text-muted-foreground">{formatDateTime(ap.fecha)}</span>
                </div>
                {ap.comentario && <p className="mt-2 text-muted-foreground">{ap.comentario}</p>}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
