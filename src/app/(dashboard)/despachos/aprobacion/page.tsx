import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { AprobacionDespachoActions } from "@/components/modules/despachos/aprobacion-actions";
import { AprobarTodosButton } from "@/components/modules/despachos/aprobar-todos-button";
import { DetalleDespachoDialog } from "@/components/modules/despachos/detalle-despacho-dialog";
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
import { getDespachosPendientesAprobacion } from "@/lib/mock-data";
import { getUsuarioActual } from "@/lib/session";

export default async function AprobacionDespachosPage() {
  const [despachos, usuarioActual] = await Promise.all([getDespachosPendientesAprobacion(), getUsuarioActual()]);
  if (!usuarioActual) redirect("/login");

  // Aprobar toda la cola de una es acción de administración: solo ADMIN ve
  // el botón, y el endpoint además exige ese rol (la UI no autoriza nada).
  const puedeAprobarEnBloque = usuarioActual.rol === "ADMIN";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Aprobación de despachos"
        subtitle="Despachos pendientes de aprobación, creados por Excel o carga manual"
        helpText="Todo despacho (venga de una importación de Excel o de una carga manual) pasa por esta cola antes de poder agregarse a una ruta."
        actions={
          puedeAprobarEnBloque && despachos.length > 0 ? (
            <AprobarTodosButton pendientes={despachos.length} />
          ) : undefined
        }
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
                  <TableHead># Ítems</TableHead>
                  <TableHead>Creado por</TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {despachos.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="font-medium">
                      <DetalleDespachoDialog despacho={d} usuarioId={usuarioActual.id} />
                    </TableCell>
                    <TableCell>{d.origen.nombre}</TableCell>
                    <TableCell>{d.destinoCliente.nombre}</TableCell>
                    <TableCell>{d.items.length}</TableCell>
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
