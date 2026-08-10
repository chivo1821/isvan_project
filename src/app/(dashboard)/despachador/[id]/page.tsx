import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SeguimientoDetalleMap } from "@/components/modules/seguimiento/seguimiento-detalle-map";
import { DespachadorActions } from "@/components/modules/despachador/despachador-actions";
import { ESTADO_DESPACHO_META, TIPO_VEHICULO_META } from "@/lib/constants";
import { getDespachoConDetalle } from "@/lib/mock-data";

export default async function DespachadorDetallePage({ params }: PageProps<"/despachador/[id]">) {
  const { id } = await params;
  const despacho = await getDespachoConDetalle(id);
  if (!despacho) notFound();

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${despacho.numero} — ${despacho.destinoCliente.nombre}`}
        subtitle={`${despacho.origen.nombre} → ${despacho.destinoCliente.direccion}, ${despacho.destinoCliente.ciudad}`}
        actions={<StatusBadge {...ESTADO_DESPACHO_META[despacho.estado]} />}
      />

      {despacho.ruta.length > 0 ? (
        <SeguimientoDetalleMap ruta={despacho.ruta} className="h-[32rem]" />
      ) : (
        <Card>
          <CardContent className="flex h-[32rem] items-center justify-center text-center text-sm text-muted-foreground">
            Este despacho todavía no tiene una ruta calculada. Pídele a quien lo aprobó que la calcule desde
            el detalle del despacho antes de salir.
          </CardContent>
        </Card>
      )}

      <div className="flex flex-col items-start justify-between gap-4 rounded-lg border border-border bg-card p-4 sm:flex-row sm:items-center">
        <div className="space-y-1 text-sm text-muted-foreground">
          {despacho.vehiculo ? (
            <p>
              <span className="font-medium text-foreground">{despacho.vehiculo.placa}</span> —{" "}
              {TIPO_VEHICULO_META[despacho.vehiculo.tipo].label}
              {despacho.vehiculo.conductorNombre && ` · ${despacho.vehiculo.conductorNombre}`}
            </p>
          ) : (
            <p>Sin vehículo asignado todavía.</p>
          )}
          {despacho.distanciaEstimadaKm != null && despacho.tiempoEstimadoMin != null && (
            <p>
              {despacho.distanciaEstimadaKm.toLocaleString("es-VE")} km · ~{despacho.tiempoEstimadoMin} min estimados
            </p>
          )}
        </div>
        <DespachadorActions despachoId={despacho.id} estado={despacho.estado} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Productos</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-1 text-sm">
            {despacho.itemsConProducto.map((item) => (
              <li key={item.id} className="flex items-center justify-between">
                <span>{item.producto.nombre}</span>
                <span className="text-muted-foreground">{item.cantidad}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
