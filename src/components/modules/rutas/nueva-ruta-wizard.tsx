"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangleIcon, CalendarClockIcon, PackageSearchIcon, RouteIcon, SparklesIcon, UserIcon } from "lucide-react";
import { toast } from "sonner";
import { apiPost } from "@/lib/api-client";
import { NumberedCard } from "@/components/shared/numbered-card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/shared/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TIPO_VEHICULO_META, formatDateTime } from "@/lib/constants";
import type { Cliente, Despacho, Ruta, Vehiculo } from "@/lib/mock-data";
import { proximaHoraEnPunto, salidaIso } from "@/lib/planificacion";

type DespachoConCliente = Despacho & { destinoCliente: Cliente };
type SugerenciaVehiculo = {
  vehiculo: Vehiculo;
  holguraKg: number;
  motivos: string[];
};

// Respuesta de POST /rutas/sugerencias — un viaje propuesto (qué despachos
// juntar y en qué vehículo) con sus métricas estimadas. Ver
// backend/app/services/plan_rutas.py.
type SugerenciaRuta = {
  /** null si a esa hora no queda ningún vehículo libre: el viaje se propone
   * igual y se le asigna vehículo después. */
  vehiculo: Vehiculo | null;
  despachoIds: string[];
  paradas: number;
  pesoKg: number;
  usoCapacidadPct: number;
  distanciaKmEstimada: number;
  tiempoMinEstimado: number;
  costoEstimado?: number | null;
  rutasComerciales: string[];
  motivos: string[];
};
type PlanRutas = {
  sugerencias: SugerenciaRuta[];
  sinAsignar: { despachoIds: string[]; motivo: string }[];
};

function pesoTotal(despacho: Despacho) {
  return despacho.items.reduce((sum, item) => sum + item.cantidad * item.pesoUnitarioKg, 0);
}

function formatKg(kg: number) {
  return `${kg.toLocaleString("es-VE", { maximumFractionDigits: 0 })} kg`;
}

/** Quién manejaría el viaje: al elegir entre sugerencias el coordinador
 * también decide con qué chofer sale. */
function ChoferDelVehiculo({ conductor }: { conductor?: string | null }) {
  return (
    <p className="flex items-center gap-1.5 text-sm">
      <UserIcon className="size-3.5 shrink-0 text-muted-foreground" />
      {conductor ? (
        <span className="text-foreground">{conductor}</span>
      ) : (
        <span className="text-warning">Sin chofer asignado</span>
      )}
    </p>
  );
}

export function NuevaRutaWizard({
  despachos,
  creadoPorId,
}: {
  despachos: DespachoConCliente[];
  creadoPorId: string;
}) {
  const router = useRouter();
  const [seleccionados, setSeleccionados] = useState<Set<string>>(new Set());
  const [buscando, setBuscando] = useState(false);
  const [sugerencias, setSugerencias] = useState<SugerenciaVehiculo[] | null>(null);
  const [vehiculoId, setVehiculoId] = useState<string | null>(null);
  const [creando, setCreando] = useState(false);
  const [plan, setPlan] = useState<PlanRutas | null>(null);
  const [planeando, setPlaneando] = useState(false);
  const [mezclarRutasComerciales, setMezclarRutasComerciales] = useState(true);
  // Qué tan lejos puede estar una parada de las demás del mismo viaje. Es el
  // freno contra viajes absurdos (un cliente en La Guaira y otro en
  // Charallave); bajarlo da viajes más compactos pero usa más vehículos.
  const [radioMaxKm, setRadioMaxKm] = useState("12");
  // Cuándo sale del almacén: define qué vehículos están libres y es la hora
  // de recogida que ve el repartidor.
  const [salida, setSalida] = useState(proximaHoraEnPunto);
  const salidaProgramada = salidaIso(salida.fecha, salida.hora);

  function cambiarSalida(cambio: Partial<{ fecha: string; hora: string }>) {
    setSalida((prev) => ({ ...prev, ...cambio }));
    // A otra hora, otros vehículos libres: lo sugerido ya no vale.
    setPlan(null);
    setSugerencias(null);
    setVehiculoId(null);
  }

  function alternar(id: string) {
    setSeleccionados((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setSugerencias(null);
    setVehiculoId(null);
  }

  async function sugerirAgrupacion() {
    setPlaneando(true);
    try {
      const data = await apiPost<PlanRutas>("/rutas/sugerencias", {
        despachoIds: despachos.map((d) => d.id),
        mezclarRutasComerciales,
        radioMaxKm: Number(radioMaxKm),
        salidaProgramada,
      });
      setPlan(data);
      if (data.sugerencias.length === 0) {
        toast.info("No se pudo armar ninguna ruta con los despachos disponibles");
      }
    } catch (err) {
      toast.error("No se pudieron calcular las sugerencias", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setPlaneando(false);
    }
  }

  /** Vuelca una sugerencia en la selección manual: quedan marcados sus
   * despachos y elegido su vehículo, listo para confirmar (o para ajustar a
   * mano antes de crear la ruta). */
  function usarSugerencia(sugerencia: SugerenciaRuta) {
    setSeleccionados(new Set(sugerencia.despachoIds));
    const vehiculo = sugerencia.vehiculo;
    if (!vehiculo) {
      // Sin vehículo libre a esa hora: se planifica sin vehículo.
      setSugerencias(null);
      setVehiculoId(null);
      return;
    }
    setSugerencias([{ vehiculo, holguraKg: vehiculo.capacidadKg - sugerencia.pesoKg, motivos: sugerencia.motivos }]);
    setVehiculoId(vehiculo.id);
  }

  async function buscarVehiculos() {
    if (seleccionados.size === 0) return;
    setBuscando(true);
    setVehiculoId(null);
    try {
      const data = await apiPost<SugerenciaVehiculo[]>("/rutas/vehiculos-sugeridos", {
        despachoIds: [...seleccionados],
        salidaProgramada,
      });
      setSugerencias(data);
      if (data.length === 0) {
        toast.info("No hay vehículos libres a esa hora que cumplan lo que necesita la ruta", {
          description: "Puedes planificarla igual sin vehículo y asignárselo después.",
        });
      }
    } catch (err) {
      toast.error("No se pudo buscar vehículos sugeridos", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setBuscando(false);
    }
  }

  async function crearRuta() {
    if (seleccionados.size === 0 || !salidaProgramada) return;
    setCreando(true);
    try {
      const ruta = await apiPost<Ruta>("/rutas", {
        despachoIds: [...seleccionados],
        vehiculoId,
        creadoPorId,
        salidaProgramada,
      });
      toast.success(`Ruta ${ruta.numero} planificada para el ${formatDateTime(ruta.salidaProgramada)}`, {
        description: `${ruta.despachos.length} parada(s) · ${ruta.distanciaTotalKm?.toLocaleString("es-VE")} km estimados.`,
      });
      // Lo pendiente (sin vehículo, horarios que se pisan...) no frena la
      // creación, pero se avisa de entrada; queda también en la ruta.
      if (ruta.avisos?.length) {
        toast.warning("La ruta quedó con avisos", { description: ruta.avisos.map((a) => a.mensaje).join(" · ") });
      }
      router.push(`/rutas/${ruta.id}`);
      router.refresh();
    } catch (err) {
      toast.error("No se pudo crear la ruta", {
        description: err instanceof Error ? err.message : undefined,
      });
      setCreando(false);
    }
  }

  const despachosSeleccionados = despachos.filter((d) => seleccionados.has(d.id));
  const pesoSeleccionado = despachosSeleccionados.reduce((sum, d) => sum + pesoTotal(d), 0);
  const porId = new Map(despachos.map((d) => [d.id, d]));
  const vehiculoElegido = sugerencias?.find((s) => s.vehiculo.id === vehiculoId)?.vehiculo;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <NumberedCard
          number={1}
          title="Salida del almacén"
          helpText="Fecha y hora en que la ruta sale del almacén: es la hora de recogida que ve el repartidor y define qué vehículos están libres. Se puede planificar a futuro y cambiar después desde la ruta o la planificación."
        >
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="salida-fecha" className="text-sm font-normal text-muted-foreground">
                Fecha
              </Label>
              <Input
                id="salida-fecha"
                type="date"
                value={salida.fecha}
                onChange={(e) => cambiarSalida({ fecha: e.target.value })}
                className="w-44"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="salida-hora" className="text-sm font-normal text-muted-foreground">
                Hora
              </Label>
              <Input
                id="salida-hora"
                type="time"
                value={salida.hora}
                onChange={(e) => cambiarSalida({ hora: e.target.value })}
                className="w-32"
              />
            </div>
            <p className="flex items-center gap-1.5 pb-2 text-sm text-muted-foreground">
              <CalendarClockIcon className="size-4" aria-hidden />
              {salidaProgramada ? `Sale el ${formatDateTime(salidaProgramada)}` : "Elige la fecha y la hora"}
            </p>
          </div>
        </NumberedCard>

        <NumberedCard
          number={2}
          title="Rutas sugeridas"
          helpText="Agrupa los despachos por cercanía entre clientes, sin pasarse de la capacidad del vehículo; la ruta comercial del cliente desempata entre paradas igual de cerca. Los kilómetros, el tiempo y el costo operativo del vehículo son estimados (el tiempo ya incluye lo que el camión pasa detenido en cada cliente); el trazado real se calcula al crear la ruta."
        >
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-4">
              <Button onClick={sugerirAgrupacion} disabled={despachos.length === 0 || planeando}>
                <SparklesIcon />
                {planeando ? "Calculando..." : "Sugerir agrupación"}
              </Button>
              <div className="flex items-center gap-2">
                <Label htmlFor="radio-max" className="text-sm font-normal text-muted-foreground">
                  Distancia máx. entre paradas
                </Label>
                <Select
                  value={radioMaxKm}
                  onValueChange={(v) => {
                    setRadioMaxKm(v);
                    setPlan(null);
                  }}
                >
                  <SelectTrigger id="radio-max" className="w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="5">5 km</SelectItem>
                    <SelectItem value="8">8 km</SelectItem>
                    <SelectItem value="12">12 km</SelectItem>
                    <SelectItem value="20">20 km</SelectItem>
                    <SelectItem value="30">30 km</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="no-mezclar"
                  checked={!mezclarRutasComerciales}
                  onCheckedChange={(v) => {
                    setMezclarRutasComerciales(!v);
                    setPlan(null);
                  }}
                />
                <Label htmlFor="no-mezclar" className="text-sm font-normal text-muted-foreground">
                  No mezclar clientes de rutas comerciales distintas
                </Label>
              </div>
            </div>

            {plan && plan.sugerencias.length > 0 && (
              <div className="space-y-3">
                {plan.sugerencias.map((s, index) => {
                  const paradas = s.despachoIds.map((id) => porId.get(id)).filter(Boolean) as DespachoConCliente[];
                  return (
                    <div key={s.vehiculo?.id ?? `sin-vehiculo-${index}`} className="rounded-lg border border-border p-3">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium text-foreground">Ruta sugerida {index + 1}</span>
                            {s.rutasComerciales.map((ruta) => (
                              <StatusBadge key={ruta} tone="neutral" label={ruta} />
                            ))}
                          </div>
                          {s.vehiculo ? (
                            <>
                              <p className="text-sm text-muted-foreground">
                                {s.vehiculo.placa} — {TIPO_VEHICULO_META[s.vehiculo.tipo].label} ·{" "}
                                {s.paradas} parada(s) · {formatKg(s.pesoKg)} ({s.usoCapacidadPct}% de{" "}
                                {formatKg(s.vehiculo.capacidadKg)})
                              </p>
                              <ChoferDelVehiculo conductor={s.vehiculo.conductor} />
                            </>
                          ) : (
                            <p className="text-sm text-muted-foreground">
                              <span className="font-medium text-warning">Sin vehículo libre a esa hora</span> ·{" "}
                              {s.paradas} parada(s) · {formatKg(s.pesoKg)} — se planifica y se le asigna después
                            </p>
                          )}
                          <p className="text-sm text-muted-foreground">
                            ~{s.distanciaKmEstimada.toLocaleString("es-VE")} km · ~{s.tiempoMinEstimado} min
                            {s.costoEstimado != null &&
                              ` · costo del vehículo ~${s.costoEstimado.toLocaleString("es-VE", {
                                maximumFractionDigits: 2,
                              })} USD`}
                          </p>
                          <ul className="text-xs text-muted-foreground">
                            {paradas.slice(0, 5).map((d) => (
                              <li key={d.id}>
                                · {d.numero} — {d.destinoCliente.nombre}
                              </li>
                            ))}
                            {paradas.length > 5 && <li>· y {paradas.length - 5} más</li>}
                          </ul>
                        </div>
                        <Button size="sm" variant="outline" onClick={() => usarSugerencia(s)}>
                          Usar esta sugerencia
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {plan && plan.sinAsignar.length > 0 && (
              <div className="space-y-1 rounded-lg border border-warning/40 bg-warning/5 p-3">
                {plan.sinAsignar.map((sa) => (
                  <p key={sa.motivo} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                    <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0 text-warning" />
                    <span>
                      {sa.despachoIds.length} despacho(s) sin asignar: {sa.motivo}
                    </span>
                  </p>
                ))}
              </div>
            )}
          </div>
        </NumberedCard>

        <NumberedCard
          number={3}
          title="Despachos a incluir"
          helpText="Solo se listan despachos ya aprobados que todavía no forman parte de una ruta. Puedes partir de una sugerencia y ajustarla a mano."
        >
          {despachos.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-6 text-center">
              <PackageSearchIcon className="size-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                No hay despachos aprobados disponibles para armar una ruta en este momento.
              </p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10" />
                    <TableHead>Despacho</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Ruta cliente</TableHead>
                    <TableHead className="text-right">Peso est.</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {despachos.map((d) => (
                    <TableRow
                      key={d.id}
                      className="cursor-pointer"
                      onClick={() => alternar(d.id)}
                    >
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Checkbox checked={seleccionados.has(d.id)} onCheckedChange={() => alternar(d.id)} />
                      </TableCell>
                      <TableCell className="font-medium">{d.numero}</TableCell>
                      <TableCell>
                        {d.destinoCliente.nombre}
                        <span className="ml-1 text-xs text-muted-foreground">({d.destinoCliente.ciudad})</span>
                      </TableCell>
                      <TableCell>
                        {d.destinoCliente.rutaComercial ? (
                          <StatusBadge tone="neutral" label={d.destinoCliente.rutaComercial} />
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {formatKg(pesoTotal(d))}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </NumberedCard>

        <NumberedCard
          number={4}
          title="Vehículo (opcional)"
          helpText="Se sugieren los vehículos libres a la hora de salida con mejor ajuste de capacidad. Si no hay ninguno, la ruta se planifica sin vehículo y se le asigna después desde la ruta o la planificación."
        >
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                onClick={buscarVehiculos}
                disabled={seleccionados.size === 0 || !salidaProgramada || buscando}
                variant="outline"
              >
                {buscando ? "Buscando..." : "Buscar vehículos libres"}
              </Button>
              {vehiculoId && (
                <Button size="sm" variant="ghost" onClick={() => setVehiculoId(null)}>
                  Planificar sin vehículo
                </Button>
              )}
            </div>

            {sugerencias && sugerencias.length > 0 && (
              <div className="space-y-2">
                {sugerencias.map((s, index) => (
                  <div
                    key={s.vehiculo.id}
                    className="flex flex-col gap-2 rounded-lg border border-border p-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        {index === 0 && <StatusBadge tone="success" label="Recomendado" />}
                        <span className="font-medium text-foreground">{s.vehiculo.placa}</span>
                        <span className="text-sm text-muted-foreground">
                          {TIPO_VEHICULO_META[s.vehiculo.tipo].label}
                        </span>
                      </div>
                      <ChoferDelVehiculo conductor={s.vehiculo.conductor} />
                      <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                        {s.motivos.map((motivo) => (
                          <li key={motivo}>✓ {motivo}</li>
                        ))}
                      </ul>
                    </div>
                    <Button
                      size="sm"
                      variant={vehiculoId === s.vehiculo.id ? "secondary" : "outline"}
                      onClick={() => setVehiculoId(s.vehiculo.id)}
                    >
                      {vehiculoId === s.vehiculo.id ? "Elegido" : "Elegir"}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </NumberedCard>
      </div>

      <div className="lg:sticky lg:top-6 lg:self-start">
        <NumberedCard number={5} title="Confirmar ruta" helpText="Se calcula el orden de paradas y el trazado desde Almacén Catia.">
          {despachosSeleccionados.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-6 text-center">
              <RouteIcon className="size-8 text-muted-foreground" />
              <p className="text-sm font-medium text-foreground">Aún no elegiste despachos</p>
            </div>
          ) : (
            <div className="space-y-1 text-sm">
              <p className="font-medium text-foreground">
                {despachosSeleccionados.length} parada(s) · {formatKg(pesoSeleccionado)}
              </p>
              <p className="text-muted-foreground">
                {salidaProgramada ? `Sale el ${formatDateTime(salidaProgramada)}` : "Falta la fecha y hora de salida"}
                {" · "}
                {vehiculoElegido ? (
                  `en ${vehiculoElegido.placa}`
                ) : (
                  <span className="text-warning">sin vehículo (se asigna después)</span>
                )}
              </p>
              <ul className="space-y-0.5 text-xs text-muted-foreground">
                {despachosSeleccionados.map((d) => (
                  <li key={d.id}>
                    {d.numero} — {d.destinoCliente.nombre}
                    {d.destinoCliente.rutaComercial && ` · ${d.destinoCliente.rutaComercial}`}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <Button
            className="mt-4 w-full"
            disabled={seleccionados.size === 0 || !salidaProgramada || creando}
            onClick={crearRuta}
          >
            <RouteIcon />
            {creando ? "Creando ruta..." : vehiculoElegido ? "Crear ruta" : "Planificar sin vehículo"}
          </Button>
        </NumberedCard>
      </div>
    </div>
  );
}
