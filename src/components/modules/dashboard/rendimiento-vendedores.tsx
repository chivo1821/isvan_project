"use client";

import { useRef, useState } from "react";
import type { DateRange } from "react-day-picker";
import { es } from "react-day-picker/locale";
import { CalendarIcon, Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import { MapasVisitasVendedores } from "@/components/modules/dashboard/mapas-visitas-vendedores";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiGet, mensajeDeError } from "@/lib/api-client";
import { formatDate, formatDateTime, formatNumero, formatUsd } from "@/lib/constants";
import { hoyCaracas, inicioDeMes, sumarDias } from "@/lib/delivery";
import { formatMes } from "@/lib/indicadores";
import type { RendimientoVendedores } from "@/lib/vendedor";

// El calendario trabaja con Date locales; la API, con "YYYY-MM-DD".
function aFecha(texto: string) {
  return new Date(`${texto}T00:00:00`);
}
function aTexto(fecha: Date) {
  return `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, "0")}-${String(fecha.getDate()).padStart(2, "0")}`;
}

function atajos(hoy: string) {
  const mes = inicioDeMes(hoy);
  const finDeMesAnterior = sumarDias(mes, -1);
  return [
    { label: "Hoy", desde: hoy, hasta: hoy },
    { label: "Ayer", desde: sumarDias(hoy, -1), hasta: sumarDias(hoy, -1) },
    { label: "Últimos 7 días", desde: sumarDias(hoy, -6), hasta: hoy },
    { label: "Mes en curso", desde: mes, hasta: hoy },
    { label: "Mes anterior", desde: inicioDeMes(finDeMesAnterior), hasta: finDeMesAnterior },
  ];
}

function periodo(desde: string, hasta: string) {
  if (desde === hasta) return desde === hoyCaracas() ? `de hoy, ${formatDate(desde)}` : `del ${formatDate(desde)}`;
  return `del ${formatDate(desde)} al ${formatDate(hasta)}`;
}

/** Cómo va cada vendedor en el período (por defecto, hoy): a cuántos de sus
 * clientes atendió, cuánto tarda en cada uno y si las visitas se hicieron
 * en el cliente. */
export function RendimientoVendedoresCard({ rendimiento: inicial }: { rendimiento: RendimientoVendedores }) {
  const [r, setR] = useState(inicial);
  const [cargando, setCargando] = useState(false);
  const [abierto, setAbierto] = useState(false);
  const [rango, setRango] = useState<DateRange | undefined>();
  // Primer clic en el calendario: el día inicial; el segundo cierra el rango
  // (el mismo día dos veces = un solo día).
  const [inicio, setInicio] = useState<Date | null>(null);
  const ultimaPedida = useRef(0);

  async function elegirPeriodo(desde: string, hasta: string) {
    setAbierto(false);
    const pedida = ++ultimaPedida.current;
    setCargando(true);
    try {
      const nuevo = await apiGet<RendimientoVendedores>(`/vendedor/rendimiento?desde=${desde}&hasta=${hasta}`);
      if (pedida === ultimaPedida.current) setR(nuevo);
    } catch (err) {
      if (pedida === ultimaPedida.current) {
        toast.error("No se pudo cargar el rendimiento", { description: mensajeDeError(err, "Intenta de nuevo") });
      }
    } finally {
      if (pedida === ultimaPedida.current) setCargando(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Rendimiento por vendedor</CardTitle>
        <CardDescription>
          Visitas {periodo(r.desde, r.hasta)}
          {r.mesVenta && ` · venta de sus rutas en ${formatMes(r.mesVenta)}`}
        </CardDescription>
        <CardAction>
          <Popover
            open={abierto}
            onOpenChange={(v) => {
              setAbierto(v);
              if (v) {
                setRango({ from: aFecha(r.desde), to: aFecha(r.hasta) });
                setInicio(null);
              }
            }}
          >
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" disabled={cargando}>
                {cargando ? <Loader2Icon className="animate-spin" /> : <CalendarIcon />}
                {r.desde === r.hasta ? formatDate(r.desde) : `${formatDate(r.desde)} – ${formatDate(r.hasta)}`}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-auto p-0">
              <div className="flex flex-col gap-1 border-b border-border p-2 sm:flex-row">
                {atajos(hoyCaracas()).map((a) => (
                  <Button
                    key={a.label}
                    variant="ghost"
                    size="sm"
                    className="justify-start"
                    onClick={() => elegirPeriodo(a.desde, a.hasta)}
                  >
                    {a.label}
                  </Button>
                ))}
              </div>
              <Calendar
                mode="range"
                locale={es}
                numberOfMonths={2}
                defaultMonth={aFecha(inicioDeMes(sumarDias(inicioDeMes(r.hasta), -1)))}
                disabled={{ after: aFecha(hoyCaracas()) }}
                selected={rango}
                onSelect={(_, dia) => {
                  if (!inicio) {
                    setInicio(dia);
                    setRango({ from: dia, to: dia });
                    return;
                  }
                  const [a, b] = inicio <= dia ? [inicio, dia] : [dia, inicio];
                  elegirPeriodo(aTexto(a), aTexto(b));
                }}
              />
              <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
                {inicio
                  ? `Desde el ${formatDate(aTexto(inicio))}: elige el día final (el mismo para un solo día).`
                  : "Elige el día inicial y después el final."}
              </p>
            </PopoverContent>
          </Popover>
        </CardAction>
      </CardHeader>
      <CardContent className={cargando ? "opacity-60 transition-opacity" : "transition-opacity"}>
        {r.porVendedor.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Todavía no hay vendedores. Créalos en Usuarios con el rol Vendedor y asígnales sus rutas de venta.
          </p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Vendedor</TableHead>
                    <TableHead>Rutas</TableHead>
                    <TableHead className="text-right">Atendidos</TableHead>
                    <TableHead className="text-right">Visitas</TableHead>
                    <TableHead className="text-right">Prom. en el cliente</TableHead>
                    <TableHead className="text-right">Lejos del cliente</TableHead>
                    <TableHead>Última visita</TableHead>
                    <TableHead className="text-right">Venta del mes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {r.porVendedor.map((v) => (
                    <TableRow key={v.vendedorId}>
                      <TableCell className="font-medium">{v.nombre}</TableCell>
                      <TableCell>
                        {v.rutas.length > 0 ? (
                          <span className="text-muted-foreground">{v.rutas.join(", ")}</span>
                        ) : (
                          <StatusBadge tone="warning" label="Sin rutas" />
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {v.clientesAtendidos} / {v.clientesAsignados}
                        {v.coberturaPct != null && (
                          <span className="ml-1 text-xs text-muted-foreground">
                            ({formatNumero(v.coberturaPct, 1)} %)
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">{v.visitas}</TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {v.promedioMinEnCliente != null ? `${formatNumero(v.promedioMinEnCliente, 1)} min` : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        {v.visitasLejos > 0 ? (
                          <StatusBadge tone="warning" label={String(v.visitasLejos)} />
                        ) : (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {v.ultimaVisita ? formatDateTime(v.ultimaVisita) : "—"}
                      </TableCell>
                      <TableCell className="text-right">{formatUsd(v.ventaNetaMes)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              «Lejos del cliente»: la ubicación del teléfono al empezar la visita quedó a más de {r.distanciaMaxM} m
              de la del cliente en el maestro.
            </p>
            <div className="mt-6 space-y-2">
              <MapasVisitasVendedores rendimiento={r} />
              <p className="text-xs text-muted-foreground">
                Cada punto es dónde estaba el teléfono al empezar la visita, con la marca (color y forma) de su
                vendedor. Toca un punto para ver el cliente y la hora.
              </p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
