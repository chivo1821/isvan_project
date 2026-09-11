"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bar, CartesianGrid, Cell, ComposedChart, Line, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatNumero, formatPct, formatUsd } from "@/lib/constants";
import {
  finDeMes,
  formatFecha,
  formatMes,
  formatMesCorto,
  queryPagina,
  type FiltrosIndicadores,
  type Granularidad,
  type PuntoSerie,
} from "@/lib/indicadores";
import { cn } from "@/lib/utils";

// Un eje por gráfico: la venta (USD) y el margen (%) van en gráficos
// separados. Compartir uno con dos escalas hace que su alineación sea
// arbitraria y sugiere relaciones que no están en los datos.
const configVenta = {
  ventaNeta: { label: "Venta neta", color: "var(--chart-1)" },
} satisfies ChartConfig;

const configMargen = {
  margenPct: { label: "Margen %", color: "var(--chart-4)" },
  // Referencia en tono neutro: el protagonista es el margen tal como lo
  // define el documento del cliente; esta línea muestra cuánto lo infla la
  // venta de productos sin costo cargado.
  margenConCostoPct: { label: "Margen % solo de productos con costo", color: "var(--muted-foreground)" },
} satisfies ChartConfig;

const DIA_MES = new Intl.DateTimeFormat("es-VE", { day: "2-digit", month: "short", timeZone: "UTC" });

// Las barras fuera del período elegido quedan de fondo, como contexto.
const OPACIDAD_FUERA_DEL_PERIODO = 0.3;

type PuntoGrafico = PuntoSerie & {
  etiqueta: string;
  titulo: string;
  /** Último día del mes o de la semana (domingo). */
  fin: string;
  seleccionado: boolean;
  pista: string;
  margenConCostoPct: number | null;
};

type FilaTooltip = { label: string; valor: string; cambio?: string };

function sumarDias(fecha: string, dias: number) {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

function finDePeriodo(inicio: string, granularidad: Granularidad) {
  return granularidad === "mes" ? finDeMes(inicio) : sumarDias(inicio, 6);
}

/** Si el filtro es exactamente una semana de lunes a domingo (por ejemplo,
 * porque se llegó con un clic en una barra semanal), los gráficos abren en
 * semanas. */
function esUnaSemana(f: FiltrosIndicadores) {
  return new Date(`${f.desde}T00:00:00Z`).getUTCDay() === 1 && sumarDias(f.desde, 6) === f.hasta;
}

/** Margen sobre la venta de los productos que tienen costo cargado. El
 * margen del documento (venta neta − costo) cuenta la venta sin costo como
 * ganancia completa: cuando esa venta crece, el margen publicado baja menos
 * de lo que baja el real. */
function margenConCosto(p: PuntoSerie): number | null {
  const ventaConCosto = p.ventaNeta - p.ventaSinCosto;
  return ventaConCosto > 0 ? (ventaConCosto - p.costo) / ventaConCosto : null;
}

function cambio(valor: number | null | undefined, enPuntos = false) {
  if (valor == null) return "sin período anterior";
  const signo = valor > 0 ? "+" : "";
  return enPuntos ? `${signo}${formatNumero(valor * 100, 1)} pp` : `${signo}${formatPct(valor, 1)}`;
}

function filasVenta(p: PuntoGrafico): FilaTooltip[] {
  return [
    { label: "Venta neta", valor: formatUsd(p.ventaNeta), cambio: cambio(p.variacion.ventaNeta) },
    { label: "Devoluciones", valor: formatPct(p.pctDevolucion, 2), cambio: cambio(p.variacion.pctDevolucion, true) },
    { label: "Litros", valor: formatNumero(p.litros), cambio: cambio(p.variacion.litros) },
    { label: "Clientes", valor: formatNumero(p.clientes), cambio: cambio(p.variacion.clientes) },
  ];
}

function filasMargen(p: PuntoGrafico): FilaTooltip[] {
  const pctSinCosto = p.ventaNeta ? p.ventaSinCosto / p.ventaNeta : null;
  return [
    { label: "Margen %", valor: formatPct(p.margenPct), cambio: cambio(p.variacion.margenPct, true) },
    { label: "Margen en USD", valor: formatUsd(p.margen), cambio: cambio(p.variacion.margen) },
    { label: "Solo productos con costo", valor: formatPct(p.margenConCostoPct) },
    { label: "Costo", valor: formatUsd(p.costo), cambio: cambio(p.variacion.costo) },
    { label: "Venta sin costo", valor: `${formatUsd(p.ventaSinCosto)} (${formatPct(pctSinCosto)})` },
  ];
}

function TooltipSerie({
  active,
  payload,
  filas,
}: {
  active?: boolean;
  payload?: { payload: PuntoGrafico }[];
  filas: (p: PuntoGrafico) => FilaTooltip[];
}) {
  const punto = payload?.[0]?.payload;
  if (!active || !punto) return null;
  return (
    <div className="min-w-60 space-y-1.5 rounded-lg border border-border bg-background px-3 py-2 text-xs shadow-md">
      <p className="font-medium text-foreground">{punto.titulo}</p>
      {filas(punto).map((f) => (
        <div key={f.label} className="flex items-baseline justify-between gap-3">
          <span className="text-muted-foreground">{f.label}</span>
          <span className="tabular-nums">
            <span className="font-medium text-foreground">{f.valor}</span>
            {f.cambio && <span className="text-muted-foreground"> ({f.cambio})</span>}
          </span>
        </div>
      ))}
      <p className="border-t border-border pt-1.5 text-muted-foreground">{punto.pista}</p>
    </div>
  );
}

function usdCompacto(valor: number) {
  if (Math.abs(valor) >= 1000) return `$${formatNumero(valor / 1000)}k`;
  return formatUsd(valor);
}

/** Clic en un período: sobre la barra misma o en cualquier punto de su
 * columna (un período flojo tiene una barra muy baja y costaría acertarle).
 *
 * La barra trae su propio dato, así que ese clic no depende de nada más. El
 * de la columna usa el índice que recharts calcula al pasar el mouse: si
 * todavía no hay uno (un toque en pantalla táctil sin hover previo) no se
 * hace nada, en vez de tomar el índice vacío como si fuera el primer
 * período (Number(null) es 0). */
function useClicEnPeriodo(puntos: PuntoGrafico[], onElegir: (p: PuntoGrafico) => void) {
  // El clic en la barra también le llega después al gráfico: se marca para
  // no elegir dos veces.
  const clicEnBarra = useRef(false);
  return {
    enBarra: (dato: { payload?: PuntoGrafico }) => {
      if (!dato?.payload) return;
      clicEnBarra.current = true;
      onElegir(dato.payload);
    },
    enGrafico: (estado: { activeIndex?: unknown; activeTooltipIndex?: unknown } | null) => {
      if (clicEnBarra.current) {
        clicEnBarra.current = false;
        return;
      }
      const indice = estado?.activeIndex ?? estado?.activeTooltipIndex;
      if (indice == null || indice === "") return;
      const punto = puntos[Number(indice)];
      if (punto) onElegir(punto);
    },
  };
}

function celdas(puntos: PuntoGrafico[]) {
  return puntos.map((p) => (
    <Cell key={p.periodo} fillOpacity={p.seleccionado ? 1 : OPACIDAD_FUERA_DEL_PERIODO} />
  ));
}

type PropsGrafico = { puntos: PuntoGrafico[]; onElegir: (p: PuntoGrafico) => void };

// Sin animación: con cada filtro la página se vuelve a pedir y las barras
// volverían a crecer desde cero; el cambio se lee mejor si simplemente
// aparecen en su lugar.
const SIN_ANIMACION = { isAnimationActive: false } as const;

const EJE_X = {
  dataKey: "etiqueta",
  tickLine: false,
  axisLine: false,
  tickMargin: 8,
  minTickGap: 12,
} as const;

function GraficoVenta({ puntos, onElegir }: PropsGrafico) {
  const clic = useClicEnPeriodo(puntos, onElegir);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Venta neta</CardTitle>
      </CardHeader>
      <CardContent>
        <ChartContainer config={configVenta} className="aspect-auto h-72 w-full [&_.recharts-surface]:cursor-pointer">
          <ComposedChart data={puntos} margin={{ top: 8, left: 4, right: 12 }} onClick={clic.enGrafico}>
            <CartesianGrid vertical={false} />
            <XAxis {...EJE_X} />
            <YAxis tickLine={false} axisLine={false} width={64} tickFormatter={(v: number) => usdCompacto(v)} />
            <Tooltip content={<TooltipSerie filas={filasVenta} />} cursor={{ fill: "var(--muted)", opacity: 0.5 }} />
            <Bar
              dataKey="ventaNeta"
              fill="var(--color-ventaNeta)"
              radius={[4, 4, 0, 0]}
              onClick={clic.enBarra}
              {...SIN_ANIMACION}
            >
              {celdas(puntos)}
            </Bar>
          </ComposedChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}

function GraficoMargen({ puntos, onElegir }: PropsGrafico) {
  const clic = useClicEnPeriodo(puntos, onElegir);
  return (
    <Card>
      <CardHeader className="space-y-1.5">
        <CardTitle>Margen</CardTitle>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-[2px]" style={{ background: configMargen.margenPct.color }} />
            {configMargen.margenPct.label}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-4 border-t-2 border-dashed" style={{ borderColor: configMargen.margenConCostoPct.color }} />
            {configMargen.margenConCostoPct.label}
          </span>
        </div>
      </CardHeader>
      <CardContent>
        <ChartContainer config={configMargen} className="aspect-auto h-72 w-full [&_.recharts-surface]:cursor-pointer">
          <ComposedChart data={puntos} margin={{ top: 8, left: 4, right: 12 }} onClick={clic.enGrafico}>
            <CartesianGrid vertical={false} />
            <XAxis {...EJE_X} />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={44}
              // Las barras arrancan en cero; si algún período diera margen
              // negativo, el eje baja lo necesario para mostrarlo.
              domain={[(minimo: number) => Math.min(0, minimo), "auto"]}
              tickFormatter={(v: number) => formatPct(v, 0)}
            />
            <Tooltip content={<TooltipSerie filas={filasMargen} />} cursor={{ fill: "var(--muted)", opacity: 0.5 }} />
            <Bar
              dataKey="margenPct"
              fill="var(--color-margenPct)"
              radius={[4, 4, 0, 0]}
              onClick={clic.enBarra}
              {...SIN_ANIMACION}
            >
              {celdas(puntos)}
            </Bar>
            <Line
              dataKey="margenConCostoPct"
              type="monotone"
              stroke="var(--color-margenConCostoPct)"
              strokeWidth={2}
              strokeDasharray="5 4"
              dot={{ r: 4, strokeWidth: 2, fill: "var(--card)" }}
              connectNulls
              {...SIN_ANIMACION}
            />
          </ComposedChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}

/** Evolución por mes o por semana ISO: la venta neta y el margen, uno al
 * lado del otro y siempre sobre los mismos períodos. Muestran una ventana de
 * contexto (ver ventana_de_serie en backend/app/services/indicadores_venta.py)
 * con el período elegido resaltado; un clic en una columna filtra toda la
 * página por ese mes o esa semana, con el resto de los filtros intacto. */
export function GraficosEvolucion({
  serie,
  filtros,
}: {
  serie: Record<Granularidad, PuntoSerie[]>;
  filtros: FiltrosIndicadores;
}) {
  const router = useRouter();
  const [actualizando, startTransition] = useTransition();
  const [granularidad, setGranularidad] = useState<Granularidad>(esUnaSemana(filtros) ? "semana" : "mes");
  const unidad = granularidad === "mes" ? "mes" : "semana";

  const puntos: PuntoGrafico[] = serie[granularidad].map((p) => {
    const fin = finDePeriodo(p.periodo, granularidad);
    const esElFiltro = p.periodo === filtros.desde && fin === filtros.hasta;
    return {
      ...p,
      fin,
      seleccionado: p.periodo <= filtros.hasta && fin >= filtros.desde,
      margenConCostoPct: margenConCosto(p),
      etiqueta: granularidad === "mes" ? formatMesCorto(p.periodo) : DIA_MES.format(new Date(`${p.periodo}T00:00:00Z`)),
      titulo: granularidad === "mes" ? formatMes(p.periodo) : `Semana del ${formatFecha(p.periodo)} al ${formatFecha(fin)}`,
      pista: esElFiltro ? "Es el período que estás viendo" : `Clic para ver solo ${granularidad === "mes" ? "este mes" : "esta semana"}`,
    };
  });

  function filtrarPor(desde: string, hasta: string) {
    if (desde === filtros.desde && hasta === filtros.hasta) return;
    startTransition(() =>
      router.replace(`/indicadores?${queryPagina({ ...filtros, desde, hasta })}`, { scroll: false })
    );
  }
  const elegir = (p: PuntoGrafico) => filtrarPor(p.periodo, p.fin);

  const primero = puntos[0];
  const ultimo = puntos[puntos.length - 1];
  const todoSeleccionado = puntos.every((p) => p.seleccionado);

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-heading text-base font-medium">Evolución por {unidad}</h2>
          <p className="text-sm text-muted-foreground">
            {actualizando
              ? "Actualizando…"
              : `En color, el período elegido. Haz clic en una barra para ver solo ese ${unidad}${
                  granularidad === "semana" ? " (lunes a domingo)" : ""
                }.`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {primero && ultimo && !todoSeleccionado && (
            <Button
              variant="ghost"
              size="sm"
              disabled={actualizando}
              onClick={() => filtrarPor(primero.periodo, ultimo.fin)}
            >
              Ver todo el rango
            </Button>
          )}
          <Tabs value={granularidad} onValueChange={(v) => setGranularidad(v as Granularidad)}>
            <TabsList>
              <TabsTrigger value="mes">Mes</TabsTrigger>
              <TabsTrigger value="semana">Semana</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>
      {puntos.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">Sin ventas en este período.</CardContent>
        </Card>
      ) : (
        // Mientras llega la página nueva se deja el gráfico anterior atenuado,
        // sin parpadeos ni saltos de altura.
        <div
          className={cn(
            "grid grid-cols-1 gap-4 transition-opacity xl:grid-cols-2",
            actualizando && "pointer-events-none opacity-60"
          )}
        >
          <GraficoVenta puntos={puntos} onElegir={elegir} />
          <GraficoMargen puntos={puntos} onElegir={elegir} />
        </div>
      )}
    </section>
  );
}
