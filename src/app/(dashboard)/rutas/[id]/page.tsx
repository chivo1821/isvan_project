import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarClockIcon, Undo2Icon } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { AvisosRuta } from "@/components/modules/rutas/avisos-ruta";
import { ProgramarRutaDialog } from "@/components/modules/rutas/programar-ruta-dialog";
import { RecalcularRutaButton } from "@/components/modules/rutas/recalcular-ruta-button";
import { ReversarDialog } from "@/components/modules/rutas/reversar-dialog";
import { SeguimientoDetalleMap } from "@/components/modules/seguimiento/seguimiento-detalle-map";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ESTADO_DESPACHO_META,
  ESTADO_RUTA_META,
  describirVehiculo,
  formatDate,
  formatDateTime,
} from "@/lib/constants";
import { apiGet } from "@/lib/api-client";
import { getRutaConDetalle } from "@/lib/mock-data";
import { diaCaracas, type Agenda } from "@/lib/planificacion";
import { getUsuarioActual } from "@/lib/session";

export default async function RutaDetallePage({ params }: PageProps<"/rutas/[id]">) {
  const { id } = await params;
  const [ruta, usuarioActual] = await Promise.all([getRutaConDetalle(id), getUsuarioActual()]);
  if (!ruta) notFound();

  const rutaActiva = ruta.estado === "PLANIFICADA" || ruta.estado === "EN_TRANSITO";
  // Mismo criterio que la API (backend/app/services/reversos.py): el
  // coordinador saca de una ruta activa lo que no se entregó; lo entregado
  // se queda.
  const pendientes = ruta.despachos.filter((d) => d.estado !== "ENTREGADO");
  const entregadas = ruta.despachos.length - pendientes.length;
  const esCoordinador = usuarioActual?.rol === "ADMIN" || usuarioActual?.rol === "DESPACHOS";
  const puedeReversar = esCoordinador && rutaActiva && pendientes.length > 0;
  const reversada = ruta.estado === "CANCELADA" && ruta.canceladaEn;
  // Reprogramar y asignar vehículo: solo mientras no salió, y solo quien
  // arma rutas (la API exige DESPACHOS; ADMIN siempre pasa).
  const puedeProgramar =
    ruta.estado === "PLANIFICADA" && (usuarioActual?.rol === "ADMIN" || usuarioActual?.rol === "DESPACHOS");
  // La agenda de su día trae la flota y qué vehículos están libres a su hora.
  const dia = diaCaracas(ruta.salidaProgramada);
  const agenda = puedeProgramar
    ? await apiGet<Agenda>(`/rutas/agenda?desde=${dia}&hasta=${dia}`).catch(() => null)
    : null;
  const enAgenda = agenda?.rutas.find((r) => r.id === ruta.id);

  return (
    <div className="space-y-6">
      <PageHeader
        title={ruta.numero}
        subtitle={
          ruta.vehiculoApoyo
            ? `${ruta.origen.nombre} · Morocho: ${ruta.vehiculo?.placa ?? "—"} (${ruta.conductor ?? "sin chofer"}) + ${ruta.vehiculoApoyo.placa} (${ruta.conductorApoyo ?? "sin chofer"}) · creada el ${formatDate(ruta.fechaCreacion)} por ${ruta.creadoPor.nombre}`
            : `${ruta.origen.nombre} · ${describirVehiculo(ruta.vehiculo)} · conductor: ${ruta.conductor ?? "sin asignar"} · creada el ${formatDate(ruta.fechaCreacion)} por ${ruta.creadoPor.nombre}`
        }
        actions={
          <div className="flex flex-wrap items-center gap-3">
            {puedeProgramar && agenda && (
              <ProgramarRutaDialog
                ruta={ruta}
                vehiculos={agenda.vehiculos}
                libres={enAgenda?.vehiculosLibres}
                pesoKg={enAgenda?.pesoKg}
              />
            )}
            {rutaActiva && <RecalcularRutaButton rutaId={ruta.id} />}
            {puedeReversar && (
              <ReversarDialog
                endpoint={`/rutas/${ruta.id}/reversar`}
                boton="Reversar ruta"
                titulo={`Reversar la ruta ${ruta.numero}`}
                descripcion={
                  <>
                    La ruta queda cancelada y sus {pendientes.length} despacho(s) sin entregar vuelven a «Aprobado»
                    sin ruta, para armar otro viaje.
                    {entregadas > 0 && ` Las ${entregadas} entrega(s) ya hechas se conservan.`} El vehículo queda
                    libre y el repartidor deja de verla. No se puede deshacer.
                  </>
                }
                exito={{
                  titulo: `Ruta ${ruta.numero} reversada`,
                  descripcion: `${pendientes.length} despacho(s) volvieron a «Aprobado», listos para otra ruta.`,
                }}
              />
            )}
            {ruta.vehiculoApoyo && <StatusBadge tone="info" label="Morocho" />}
            <StatusBadge {...ESTADO_RUTA_META[ruta.estado]} />
            {rutaActiva && (
              <Link href={`/despachador/${ruta.id}`} className="text-sm text-primary hover:underline">
                Ver en despachador →
              </Link>
            )}
          </div>
        }
      />

      {ruta.estado !== "CANCELADA" && (
        <p className="flex items-center gap-1.5 text-sm">
          <CalendarClockIcon className="size-4 text-muted-foreground" aria-hidden />
          {ruta.estado === "PLANIFICADA" ? "Sale del almacén el " : "Salida programada: "}
          <span className="font-medium">{formatDateTime(ruta.salidaProgramada)}</span>
          {ruta.iniciadaEn && <span className="text-muted-foreground">· salió el {formatDateTime(ruta.iniciadaEn)}</span>}
        </p>
      )}
      <AvisosRuta avisos={ruta.avisos} />

      {reversada && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="flex items-start gap-3 text-sm">
            <Undo2Icon className="mt-0.5 size-4 shrink-0 text-destructive" />
            <div className="space-y-1">
              <p className="font-medium text-foreground">
                Ruta reversada el {formatDateTime(ruta.canceladaEn!)}
                {ruta.canceladaPor ? ` por ${ruta.canceladaPor.nombre}` : ""}
              </p>
              {ruta.motivoCancelacion && <p className="text-muted-foreground">Motivo: {ruta.motivoCancelacion}</p>}
              {ruta.despachosAlCancelar && ruta.despachosAlCancelar.length > 0 && (
                <p className="text-muted-foreground">
                  Llevaba {ruta.despachosAlCancelar.length} despacho(s) sin entregar, que volvieron a «Aprobado»
                  para otra ruta: {ruta.despachosAlCancelar.join(", ")}.
                </p>
              )}
              {ruta.despachos.length > 0 && (
                <p className="text-muted-foreground">
                  Las {ruta.despachos.length} parada(s) que ya se habían entregado se conservan en la ruta.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {ruta.puntos.length > 0 ? (
            <SeguimientoDetalleMap ruta={ruta.puntos} paradas={ruta.despachos} className="h-[28rem]" />
          ) : (
            <Card>
              <CardContent className="flex h-[28rem] items-center justify-center text-center text-sm text-muted-foreground">
                {reversada
                  ? "La ruta fue reversada: ya no tiene trazado ni paradas."
                  : "Esta ruta todavía no tiene trazado calculado."}
              </CardContent>
            </Card>
          )}
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Paradas ({ruta.despachos.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {ruta.despachos.map((d, index) => (
              <div
                key={d.id}
                className="space-y-2 rounded-lg border border-border p-3 text-sm transition-colors hover:border-primary/40"
              >
                <div className="flex items-start justify-between gap-2">
                  <Link href={`/despachos/${d.id}`} className="hover:underline">
                    <p className="font-medium text-foreground">
                      {index + 1}. {d.destinoCliente.nombre}
                    </p>
                    <p className="text-muted-foreground">
                      {d.numero} · {d.destinoCliente.ciudad}
                    </p>
                  </Link>
                  <StatusBadge {...ESTADO_DESPACHO_META[d.estado]} />
                </div>
                {esCoordinador && rutaActiva && d.estado !== "ENTREGADO" && (
                  <ReversarDialog
                    endpoint={`/despachos/${d.id}/reversar`}
                    boton="Sacar de la ruta"
                    titulo={`Sacar ${d.numero} de la ruta ${ruta.numero}`}
                    descripcion={
                      <>
                        {d.destinoCliente.nombre}: el despacho vuelve a «Aprobado» sin ruta, para otro viaje.
                        {pendientes.length === 1 && " Es el último sin entregar, así que la ruta se cierra."}
                      </>
                    }
                    placeholder="Ej.: el cliente pidió cambiar el día de entrega"
                    exito={{ titulo: `${d.numero} salió de la ruta ${ruta.numero}`, descripcion: "Volvió a «Aprobado»." }}
                  />
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {(ruta.distanciaTotalKm != null || ruta.tiempoTotalMin != null) && (
        <p className="text-sm text-muted-foreground">
          {ruta.distanciaTotalKm?.toLocaleString("es-VE")} km · ~{ruta.tiempoTotalMin} min estimados en total.
        </p>
      )}
    </div>
  );
}
