"use client";

import { CartesianGrid, ComposedChart, Line, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import { formatNumero, formatPct, formatUsd } from "@/lib/constants";
import { formatMes, formatMesCorto, type Proyeccion, type PuntoProyeccion } from "@/lib/indicadores";

// La venta conserva el color que tiene en el gráfico de evolución: es la
// misma cifra. La meta lleva su propio color (ver --chart-meta en
// globals.css), sólido y contrastante: es la referencia que se mira todo el
// tiempo contra la venta, y en gris punteado costaba seguirla.
const config = {
  ventaNeta: { label: "Venta neta", color: "var(--chart-1)" },
  meta: { label: "Meta", color: "var(--chart-meta)" },
} satisfies ChartConfig;

// Los dos valores son USD: un solo eje. (Un eje por medida y nunca dos
// escalas en el mismo gráfico, como en el resto del módulo.)
const SIN_ANIMACION = { isAnimationActive: false } as const;

type PuntoGrafico = PuntoProyeccion & { etiqueta: string; titulo: string };

function usdCompacto(valor: number) {
  if (Math.abs(valor) >= 1000) return `$${formatNumero(valor / 1000)}k`;
  return formatUsd(valor);
}

function TooltipProyeccion({ active, payload }: { active?: boolean; payload?: { payload: PuntoGrafico }[] }) {
  const p = payload?.[0]?.payload;
  if (!active || !p) return null;
  const diferencia = p.meta != null && p.ventaNeta != null ? p.ventaNeta - p.meta : null;
  return (
    <div className="min-w-56 space-y-1.5 rounded-lg border border-border bg-background px-3 py-2 text-xs shadow-md">
      <p className="font-medium text-foreground">{p.titulo}</p>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-muted-foreground">{config.ventaNeta.label}</span>
        <span className="font-medium tabular-nums text-foreground">
          {p.ventaNeta == null ? "Sin datos todavía" : formatUsd(p.ventaNeta)}
        </span>
      </div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-muted-foreground">{config.meta.label}</span>
        <span className="font-medium tabular-nums text-foreground">
          {p.meta == null ? "Sin meta cargada" : formatUsd(p.meta)}
        </span>
      </div>
      {p.cumplimientoPct != null && (
        <div className="flex items-baseline justify-between gap-3 border-t border-border pt-1.5">
          <span className="text-muted-foreground">Cumplimiento</span>
          <span className="tabular-nums">
            <span className="font-medium text-foreground">{formatPct(p.cumplimientoPct, 0)}</span>
            {diferencia != null && (
              <span className="text-muted-foreground">
                {" "}
                ({diferencia >= 0 ? "+" : "−"}
                {formatUsd(Math.abs(diferencia))})
              </span>
            )}
          </span>
        </div>
      )}
      {p.parcial && <p className="border-t border-border pt-1.5 text-muted-foreground">Mes en curso: va incompleto.</p>}
    </div>
  );
}

/** Punto hueco para el mes en curso: su venta todavía no está completa y no
 * debe leerse como un incumplimiento. */
function PuntoVenta({ cx, cy, payload }: { cx?: number; cy?: number; payload?: PuntoGrafico }) {
  if (cx == null || cy == null || payload?.ventaNeta == null) return null;
  return (
    <circle
      cx={cx}
      cy={cy}
      r={4}
      strokeWidth={2}
      stroke="var(--color-ventaNeta)"
      fill={payload.parcial ? "var(--card)" : "var(--color-ventaNeta)"}
    />
  );
}

function Leyenda({ hayParcial }: { hayParcial: boolean }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <span className="w-4 border-t-2" style={{ borderColor: config.ventaNeta.color }} />
        {config.ventaNeta.label}
      </span>
      <span className="flex items-center gap-1.5">
        <span className="w-4 border-t-2" style={{ borderColor: config.meta.color }} />
        {config.meta.label}
      </span>
      {hayParcial && (
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full border-2 bg-card" style={{ borderColor: config.ventaNeta.color }} />
          Mes en curso (incompleto)
        </span>
      )}
    </div>
  );
}

const MOTIVO_DEL_FILTRO: Record<string, string> = {
  grupos: "grupo de producto",
  tipos_cliente: "tipo de cliente",
  clientes: "cliente",
  productos: "producto",
  tipos_documento: "tipo de documento",
};

function Aviso({ children }: { children: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="flex h-72 items-center justify-center px-6 text-center text-sm text-muted-foreground">
        {children}
      </CardContent>
    </Card>
  );
}

/** Venta real contra la meta que carga el cliente, mes a mes. La meta vive
 * por ruta y mes (ver MetaVenta en prisma/schema.prisma), así que al filtrar
 * por ruta se compara contra la meta de esa ruta; con un filtro que la meta
 * no distingue (un cliente, un producto) no se compara nada, porque la venta
 * sería una parte del total y la meta no. */
export function GraficoProyeccion({ proyeccion }: { proyeccion: Proyeccion }) {
  if (!proyeccion.aplica) {
    const filtros = proyeccion.filtrosAjenos.map((f) => MOTIVO_DEL_FILTRO[f] ?? f).join(" y ");
    return (
      <Aviso>
        <span>
          La meta se carga por ruta y mes, así que no se puede comparar con un filtro por {filtros}: la venta que
          estás viendo es solo una parte y la meta es del total.
          <br />
          Quita ese filtro para ver la comparación.
        </span>
      </Aviso>
    );
  }

  const puntos: PuntoGrafico[] = proyeccion.puntos.map((p) => ({
    ...p,
    etiqueta: formatMesCorto(p.periodo),
    titulo: formatMes(p.periodo),
  }));
  const hayMetas = puntos.some((p) => p.meta != null);
  if (!hayMetas) {
    return (
      <Aviso>
        <span>
          Todavía no hay metas cargadas para estos meses.
          <br />
          Cárgalas con el botón <span className="font-medium text-foreground">Metas de venta</span>, arriba.
        </span>
      </Aviso>
    );
  }

  const periodo = proyeccion.periodo;
  const hayParcial = puntos.some((p) => p.parcial);

  return (
    <Card>
      <CardHeader className="space-y-1.5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <CardTitle>Venta contra meta</CardTitle>
          {periodo?.meta != null && (
            <p className="text-sm text-muted-foreground">
              En el período elegido:{" "}
              <span className="font-medium tabular-nums text-foreground">{formatUsd(periodo.venta)}</span> de{" "}
              <span className="tabular-nums">{formatUsd(periodo.meta)}</span>
              {periodo.cumplimientoPct != null && (
                <span className="tabular-nums"> ({formatPct(periodo.cumplimientoPct, 0)})</span>
              )}
              {periodo.prorrateada && " · meta repartida por días"}
            </p>
          )}
        </div>
        <Leyenda hayParcial={hayParcial} />
      </CardHeader>
      <CardContent>
        <ChartContainer config={config} className="aspect-auto h-72 w-full">
          <ComposedChart data={puntos} margin={{ top: 8, left: 4, right: 12 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="etiqueta" tickLine={false} axisLine={false} tickMargin={8} minTickGap={12} />
            <YAxis tickLine={false} axisLine={false} width={64} tickFormatter={(v: number) => usdCompacto(v)} />
            <Tooltip content={<TooltipProyeccion />} cursor={{ stroke: "var(--border)", strokeWidth: 1 }} />
            <Line
              dataKey="meta"
              type="monotone"
              stroke="var(--color-meta)"
              strokeWidth={2}
              dot={{ r: 4, strokeWidth: 2, fill: "var(--color-meta)", stroke: "var(--color-meta)" }}
              connectNulls={false}
              {...SIN_ANIMACION}
            />
            <Line
              dataKey="ventaNeta"
              type="monotone"
              stroke="var(--color-ventaNeta)"
              strokeWidth={2}
              dot={<PuntoVenta />}
              connectNulls={false}
              {...SIN_ANIMACION}
            />
          </ComposedChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
