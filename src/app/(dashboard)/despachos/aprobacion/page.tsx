import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { AprobacionDespachoActions } from "@/components/modules/despachos/aprobacion-actions";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate } from "@/lib/constants";
import { getDespachosPendientesAprobacion, getUsuarioActualRaw } from "@/lib/mock-data";

export default async function AprobacionDespachosPage() {
  const [despachos, usuarioActual] = await Promise.all([getDespachosPendientesAprobacion(), getUsuarioActualRaw()]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Aprobación de despachos"
        subtitle="Despachos pendientes de aprobación (independiente de la revisión de ventas)"
        helpText="Un despacho puede haberse generado automáticamente desde una venta aprobada, o haberse creado manualmente. En ambos casos pasa por esta cola antes de prepararse."
      />
      <Card>
        <CardContent>
          {despachos.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No hay despachos pendientes de aprobación.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>N° Despacho</TableHead>
                  <TableHead>Origen</TableHead>
                  <TableHead>Destino</TableHead>
                  <TableHead># Productos</TableHead>
                  <TableHead>Creado por</TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {despachos.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="font-medium">
                      <Link href={`/despachos/aprobacion/${d.id}`} className="hover:underline">
                        {d.numero}
                      </Link>
                    </TableCell>
                    <TableCell>{d.origen.nombre}</TableCell>
                    <TableCell>{d.destinoCliente.nombre}</TableCell>
                    <TableCell>{d.itemsConProducto.length}</TableCell>
                    <TableCell>{d.creadoPor.nombre}</TableCell>
                    <TableCell>{formatDate(d.fechaCreacion)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end">
                        <AprobacionDespachoActions
                          despachoId={d.id}
                          despachoNumero={d.numero}
                          destinoNombre={d.destinoCliente.nombre}
                          usuarioId={usuarioActual.id}
                          size="sm"
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
