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
import { DespachoItemCantidad } from "@/components/modules/despachos/despacho-item-cantidad";
import { ESTADO_DESPACHO_META, ESTADO_RUTA_META, TIPO_VEHICULO_META, formatDateTime } from "@/lib/constants";
import { getDespachoConDetalle } from "@/lib/mock-data";

export default async function DespachoDetallePage({ params }: PageProps<"/despachos/[id]">) {
  const { id } = await params;
  const despacho = await getDespachoConDetalle(id);
  if (!despacho) notFound();

  const cantidadEditable = despacho.estado === "PENDIENTE_APROBACION" || despacho.estado === "APROBADO";

  return (
    <div className="space-y-6">
      <PageHeader
        title={despacho.numero}
        subtitle={`Documento ${despacho.numeroDocumento} · creado el ${formatDateTime(despacho.fechaCreacion)} por ${despacho.creadoPor.nombre}`}
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
              [{despacho.destinoCliente.empresa}] {despacho.destinoCliente.codigo} · {despacho.destinoCliente.tipo}
            </p>
            <p className="text-muted-foreground">
              {despacho.destinoCliente.direccion}, {despacho.destinoCliente.ciudad}
            </p>
            <p className="text-muted-foreground">
              Ruta comercial: {despacho.destinoCliente.rutaComercial ?? "sin asignar"}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Ítems</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Descripción</TableHead>
                <TableHead className="text-right">Solicitado</TableHead>
                <TableHead className="text-right">A despachar</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {despacho.items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <p>{item.descripcion}</p>
                    <p className="text-xs text-muted-foreground">
                      {item.pesoUnitarioKg} kg/u {item.requiereFrio && "· cadena de frío"}
                    </p>
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">{item.cantidadSolicitada}</TableCell>
                  <TableCell className="text-right">
                    <DespachoItemCantidad
                      despachoId={despacho.id}
                      itemId={item.id}
                      cantidad={item.cantidad}
                      cantidadSolicitada={item.cantidadSolicitada}
                      editable={cantidadEditable}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {cantidadEditable && (
            <p className="mt-3 text-xs text-muted-foreground">
              Puedes ajustar la cantidad a despachar mientras el despacho no haya salido del almacén.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Ruta</CardTitle>
        </CardHeader>
        <CardContent>
          {despacho.ruta ? (
            <div className="flex flex-col items-start justify-between gap-2 sm:flex-row sm:items-center">
              <div className="text-sm">
                <p className="font-medium text-foreground">{despacho.ruta.numero}</p>
                <p className="text-muted-foreground">
                  {despacho.ruta.vehiculo.placa} — {TIPO_VEHICULO_META[despacho.ruta.vehiculo.tipo].label}
                  {despacho.ruta.distanciaTotalKm != null &&
                    ` · ${despacho.ruta.distanciaTotalKm.toLocaleString("es-VE")} km`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge {...ESTADO_RUTA_META[despacho.ruta.estado]} />
                <Link href={`/rutas/${despacho.ruta.id}`} className="text-sm text-primary hover:underline">
                  Ver ruta
                </Link>
              </div>
            </div>
          ) : despacho.estado === "APROBADO" ? (
            <p className="text-sm text-muted-foreground">
              Este despacho ya está aprobado y listo para agregarse a una ruta.{" "}
              <Link href="/rutas/nueva" className="text-primary hover:underline">
                Armar una ruta →
              </Link>
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Este despacho todavía no tiene ruta — primero debe aprobarse.
            </p>
          )}
        </CardContent>
      </Card>

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
