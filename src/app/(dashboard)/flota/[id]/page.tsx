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
import { ESTADO_DESPACHO_META, ESTADO_VEHICULO_META, TIPO_VEHICULO_META, formatDate } from "@/lib/constants";
import { getAlmacenById, getDespachosByVehiculoId, getVehiculoById } from "@/lib/mock-data";

export default async function VehiculoDetallePage({ params }: PageProps<"/flota/[id]">) {
  const { id } = await params;
  const vehiculo = await getVehiculoById(id);
  if (!vehiculo) notFound();

  const [almacenBase, historialSinOrdenar] = await Promise.all([
    getAlmacenById(vehiculo.almacenBaseId),
    getDespachosByVehiculoId(vehiculo.id),
  ]);
  const historial = historialSinOrdenar.sort((a, b) => (a.fechaCreacion < b.fechaCreacion ? 1 : -1));

  return (
    <div className="space-y-6">
      <PageHeader
        title={vehiculo.placa}
        subtitle={TIPO_VEHICULO_META[vehiculo.tipo].label}
        actions={<StatusBadge {...ESTADO_VEHICULO_META[vehiculo.estado]} />}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Atributos</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Attr label="Capacidad" value={`${vehiculo.capacidadKg.toLocaleString("es-VE")} kg`} />
            <Attr label="Cadena de frío" value={vehiculo.tieneRefrigeracion ? "Refrigerado" : "Sin refrigeración"} />
            <Attr label="Almacén base" value={almacenBase?.nombre ?? "—"} />
            <Attr label="Conductor" value={vehiculo.conductorNombre ?? "Sin asignar"} />
            <Attr
              label="Última revisión"
              value={vehiculo.ultimaRevision ? formatDate(vehiculo.ultimaRevision) : "—"}
            />
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Historial de despachos asignados</CardTitle>
          </CardHeader>
          <CardContent>
            {historial.length === 0 ? (
              <p className="text-sm text-muted-foreground">Este vehículo no tiene despachos asignados todavía.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>N° Despacho</TableHead>
                    <TableHead>Destino</TableHead>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Estado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {historial.map((d) => (
                    <TableRow key={d.id}>
                      <TableCell className="font-medium">
                        <Link href={`/despachos/${d.id}`} className="hover:underline">
                          {d.numero}
                        </Link>
                      </TableCell>
                      <TableCell>{d.destinoCliente.nombre}</TableCell>
                      <TableCell>{formatDate(d.fechaCreacion)}</TableCell>
                      <TableCell>
                        <StatusBadge {...ESTADO_DESPACHO_META[d.estado]} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Attr({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border pb-2 last:border-0 last:pb-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  );
}
