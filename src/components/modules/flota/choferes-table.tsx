"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangleIcon, TruckIcon, UserIcon } from "lucide-react";
import { toast } from "sonner";
import { apiPatch, mensajeDeError } from "@/lib/api-client";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ESTADO_RUTA_META, ESTADO_VEHICULO_META, TIPO_VEHICULO_META } from "@/lib/constants";
import type { EstadoRuta, Usuario, Vehiculo } from "@/lib/mock-data";

const SIN_VEHICULO = "__ninguno__";

export type RutaDelVehiculo = { id: string; numero: string; estado: EstadoRuta };

/** Un cambio de vehículo a punto de guardarse. `desplazado` es el chofer que
 * hoy maneja el vehículo elegido: la API lo deja sin vehículo (un chofer por
 * vehículo). */
type Cambio = { chofer: Usuario; vehiculoId: string | null; desplazado?: Usuario };

/** Choferes y sus vehículos, con cambio en un clic. Solo pide confirmación
 * cuando el cambio afecta a alguien más: otro chofer que se queda sin
 * vehículo o una ruta activa que cambia de manos. */
export function ChoferesTable({
  choferes: iniciales,
  vehiculos,
  rutaPorVehiculo,
  puedeEditar,
}: {
  choferes: Usuario[];
  vehiculos: Vehiculo[];
  rutaPorVehiculo: Record<string, RutaDelVehiculo>;
  puedeEditar: boolean;
}) {
  const [choferes, setChoferes] = useState(iniciales);
  const [pendiente, setPendiente] = useState<Cambio | null>(null);
  const [guardando, setGuardando] = useState<string | null>(null);

  const vehiculoPorId = new Map(vehiculos.map((v) => [v.id, v]));
  const choferDe = (vehiculoId: string) => choferes.find((c) => c.vehiculoAsignadoId === vehiculoId);
  const sinChofer = vehiculos.filter((v) => v.estado === "FUNCIONAL" && !choferDe(v.id));

  function elegir(chofer: Usuario, valor: string) {
    const vehiculoId = valor === SIN_VEHICULO ? null : valor;
    if (vehiculoId === (chofer.vehiculoAsignadoId ?? null)) return;
    const desplazado = vehiculoId ? choferDe(vehiculoId) : undefined;
    const cambio: Cambio = { chofer, vehiculoId, desplazado };
    const tocaUnaRuta =
      (vehiculoId && rutaPorVehiculo[vehiculoId]) ||
      (chofer.vehiculoAsignadoId && rutaPorVehiculo[chofer.vehiculoAsignadoId]);
    if (desplazado || tocaUnaRuta) setPendiente(cambio);
    else void guardar(cambio);
  }

  async function guardar({ chofer, vehiculoId, desplazado }: Cambio) {
    setGuardando(chofer.id);
    try {
      await apiPatch<Usuario>(`/usuarios/${chofer.id}/vehiculo`, { vehiculoAsignadoId: vehiculoId });
      setChoferes((prev) =>
        prev.map((c) => {
          if (c.id === chofer.id) return { ...c, vehiculoAsignadoId: vehiculoId };
          if (c.id === desplazado?.id) return { ...c, vehiculoAsignadoId: null };
          return c;
        })
      );
      const placa = vehiculoId ? vehiculoPorId.get(vehiculoId)?.placa : null;
      toast.success(placa ? `${chofer.nombre} ahora maneja ${placa}` : `${chofer.nombre} quedó sin vehículo`, {
        description: desplazado ? `${desplazado.nombre} quedó sin vehículo.` : undefined,
      });
      setPendiente(null);
    } catch (err) {
      toast.error("No se pudo cambiar el vehículo", { description: mensajeDeError(err, "Intenta de nuevo") });
    } finally {
      setGuardando(null);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Choferes ({choferes.length})</CardTitle>
          <CardDescription>
            Cada vehículo tiene un solo chofer: si eliges uno que ya maneja otra persona, esa persona queda sin
            vehículo.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {choferes.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Todavía no hay usuarios con rol Repartidor. Un administrador puede crearlos en Usuarios.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Chofer</TableHead>
                    <TableHead>Vehículo</TableHead>
                    <TableHead>Ruta activa del vehículo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {choferes.map((chofer) => {
                    const vehiculo = chofer.vehiculoAsignadoId
                      ? vehiculoPorId.get(chofer.vehiculoAsignadoId)
                      : undefined;
                    const ruta = chofer.vehiculoAsignadoId ? rutaPorVehiculo[chofer.vehiculoAsignadoId] : undefined;
                    return (
                      <TableRow key={chofer.id} className="hover:bg-transparent">
                        <TableCell>
                          <p className="font-medium text-foreground">{chofer.nombre}</p>
                          <p className="text-xs text-muted-foreground">{chofer.email}</p>
                        </TableCell>
                        <TableCell>
                          {puedeEditar ? (
                            <Select
                              value={chofer.vehiculoAsignadoId ?? SIN_VEHICULO}
                              onValueChange={(v) => elegir(chofer, v)}
                              disabled={guardando === chofer.id}
                            >
                              <SelectTrigger size="sm" className="w-64">
                                <SelectValue placeholder="Sin vehículo" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value={SIN_VEHICULO}>Sin vehículo</SelectItem>
                                {vehiculos.map((v) => {
                                  const otro = choferDe(v.id);
                                  return (
                                    <SelectItem key={v.id} value={v.id}>
                                      {v.placa} — {TIPO_VEHICULO_META[v.tipo].label}
                                      {v.estado !== "FUNCIONAL" && ` · ${ESTADO_VEHICULO_META[v.estado].label}`}
                                      {otro && otro.id !== chofer.id && ` · lo maneja ${otro.nombre}`}
                                    </SelectItem>
                                  );
                                })}
                              </SelectContent>
                            </Select>
                          ) : vehiculo ? (
                            `${vehiculo.placa} — ${TIPO_VEHICULO_META[vehiculo.tipo].label}`
                          ) : (
                            <span className="text-muted-foreground">Sin vehículo</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {ruta ? (
                            <Link href={`/rutas/${ruta.id}`} className="inline-flex items-center gap-2 hover:underline">
                              {ruta.numero}
                              <StatusBadge {...ESTADO_RUTA_META[ruta.estado]} />
                            </Link>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Vehículos funcionales sin chofer ({sinChofer.length})</CardTitle>
          <CardDescription>Se pueden sugerir para una ruta, pero nadie los vería en el despachador.</CardDescription>
        </CardHeader>
        <CardContent>
          {sinChofer.length === 0 ? (
            <p className="text-sm text-muted-foreground">Todos los vehículos funcionales tienen chofer.</p>
          ) : (
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {sinChofer.map((v) => (
                <li key={v.id} className="flex items-start gap-2 rounded-lg border border-border p-3 text-sm">
                  <TruckIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <div>
                    <Link href={`/flota/${v.id}`} className="font-medium text-foreground hover:underline">
                      {v.placa}
                    </Link>{" "}
                    <span className="text-muted-foreground">— {TIPO_VEHICULO_META[v.tipo].label}</span>
                    {v.conductorNombre && (
                      <p className="text-xs text-muted-foreground">
                        En la ficha figura «{v.conductorNombre}», pero no tiene usuario repartidor.
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Dialog open={pendiente !== null} onOpenChange={(v) => !v && setPendiente(null)}>
        <DialogContent>
          {pendiente && (
            <ConfirmarCambio
              cambio={pendiente}
              vehiculoPorId={vehiculoPorId}
              rutaPorVehiculo={rutaPorVehiculo}
              guardando={guardando === pendiente.chofer.id}
              onConfirmar={() => guardar(pendiente)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ConfirmarCambio({
  cambio: { chofer, vehiculoId, desplazado },
  vehiculoPorId,
  rutaPorVehiculo,
  guardando,
  onConfirmar,
}: {
  cambio: Cambio;
  vehiculoPorId: Map<string, Vehiculo>;
  rutaPorVehiculo: Record<string, RutaDelVehiculo>;
  guardando: boolean;
  onConfirmar: () => void;
}) {
  const nuevo = vehiculoId ? vehiculoPorId.get(vehiculoId) : undefined;
  const anterior = chofer.vehiculoAsignadoId ? vehiculoPorId.get(chofer.vehiculoAsignadoId) : undefined;
  const rutaNueva = vehiculoId ? rutaPorVehiculo[vehiculoId] : undefined;
  const rutaAnterior = chofer.vehiculoAsignadoId ? rutaPorVehiculo[chofer.vehiculoAsignadoId] : undefined;

  return (
    <>
      <DialogHeader>
        <DialogTitle>Cambiar el vehículo de {chofer.nombre}</DialogTitle>
        <DialogDescription>
          {nuevo ? `Pasará a manejar ${nuevo.placa}.` : "Quedará sin vehículo."} Revisa lo que cambia:
        </DialogDescription>
      </DialogHeader>
      <ul className="space-y-2 text-sm">
        {desplazado && nuevo && (
          <Aviso icono={UserIcon}>
            {desplazado.nombre} maneja hoy {nuevo.placa} y quedará sin vehículo.
          </Aviso>
        )}
        {rutaNueva && nuevo && (
          <Aviso icono={TruckIcon}>
            {nuevo.placa} lleva la ruta {rutaNueva.numero} ({ESTADO_RUTA_META[rutaNueva.estado].label.toLowerCase()}):
            desde ahora la verá {chofer.nombre} en su despachador.
          </Aviso>
        )}
        {rutaAnterior && anterior && (
          <Aviso icono={AlertTriangleIcon}>
            {chofer.nombre} deja {anterior.placa}, que lleva la ruta {rutaAnterior.numero}: esa ruta queda sin chofer
            hasta que le asignes otro.
          </Aviso>
        )}
      </ul>
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="outline" disabled={guardando}>
            Cancelar
          </Button>
        </DialogClose>
        <Button onClick={onConfirmar} disabled={guardando}>
          {guardando ? "Guardando..." : "Confirmar cambio"}
        </Button>
      </DialogFooter>
    </>
  );
}

function Aviso({ icono: Icono, children }: { icono: typeof UserIcon; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/5 p-3 text-muted-foreground">
      <Icono className="mt-0.5 size-4 shrink-0 text-warning" />
      <span>{children}</span>
    </li>
  );
}
