"use client";

import { Bar, BarChart, CartesianGrid, Cell, LabelList, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import type { TableroCobranzas } from "@/lib/cobranzas";
import { formatUsd } from "@/lib/constants";
import { formatMes, formatMesCorto } from "@/lib/indicadores";

// Sin animación, como los indicadores: al filtrar, la página se vuelve a
// pedir y las barras aparecen en su lugar.
const SIN_ANIMACION = { isAnimationActive: false } as const;

function usdCompacto(v: number) {
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toLocaleString("es-VE", { maximumFractionDigits: 1 })} M`;
  if (Math.abs(v) >= 1_000) return `$${(v / 1_000).toLocaleString("es-VE", { maximumFractionDigits: 0 })} mil`;
  return formatUsd(v);
}

const configSerie = {
  vendidoUsd: { label: "Vendido", color: "var(--chart-4)" },
  cobradoUsd: { label: "Cobrado", color: "var(--chart-3)" },
} satisfies ChartConfig;

/** Lo vendido (FA + NE - devoluciones) contra lo cobrado (pagos
 * verificados) por mes: dos barras lado a lado, una escala. */
export function GraficoVendidoCobrado({ serie }: { serie: TableroCobranzas["serie"] }) {
  const datos = serie.map((p) => ({ ...p, etiqueta: formatMesCorto(p.mes), titulo: formatMes(p.mes) }));
  return (
    <ChartContainer config={configSerie} className="aspect-auto h-72 w-full">
      <BarChart data={datos} margin={{ top: 8, left: 4, right: 12 }} accessibilityLayer>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="etiqueta" tickLine={false} axisLine={false} tickMargin={8} />
        <YAxis tickLine={false} axisLine={false} width={64} tickFormatter={usdCompacto} />
        <ChartTooltip
          cursor={{ fill: "var(--muted)", opacity: 0.5 }}
          content={
            <ChartTooltipContent
              labelFormatter={(_, payload) => payload?.[0]?.payload?.titulo}
              formatter={(valor, nombre) => (
                <span className="flex w-full justify-between gap-4">
                  <span className="text-muted-foreground">{configSerie[nombre as keyof typeof configSerie]?.label}</span>
                  <span className="font-mono font-medium tabular-nums">{formatUsd(Number(valor), 2)}</span>
                </span>
              )}
            />
          }
        />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar dataKey="vendidoUsd" fill="var(--color-vendidoUsd)" radius={[4, 4, 0, 0]} {...SIN_ANIMACION} />
        <Bar dataKey="cobradoUsd" fill="var(--color-cobradoUsd)" radius={[4, 4, 0, 0]} {...SIN_ANIMACION} />
      </BarChart>
    </ChartContainer>
  );
}

// Del verde (por vencer) al rojo (más de 60 días): el tramo también va
// escrito en cada barra, el color solo acompaña.
const COLOR_TRAMO: Record<string, string> = {
  por_vencer: "var(--chart-3)",
  "1_15": "var(--chart-2)",
  "16_30": "var(--warning)",
  "31_60": "var(--chart-1)",
  mas_60: "var(--destructive)",
};

const configAntiguedad = { usd: { label: "Saldo", color: "var(--chart-1)" } } satisfies ChartConfig;

/** Antigüedad de la deuda: cuánto hay en cada tramo de días de atraso. */
export function GraficoAntiguedad({ antiguedad }: { antiguedad: TableroCobranzas["antiguedad"] }) {
  return (
    <ChartContainer config={configAntiguedad} className="aspect-auto h-64 w-full">
      <BarChart data={antiguedad} layout="vertical" margin={{ left: 8, right: 72 }} accessibilityLayer>
        <CartesianGrid horizontal={false} />
        <XAxis type="number" hide />
        <YAxis type="category" dataKey="etiqueta" tickLine={false} axisLine={false} width={104} />
        <ChartTooltip
          cursor={{ fill: "var(--muted)", opacity: 0.5 }}
          content={
            <ChartTooltipContent
              hideIndicator
              formatter={(valor, _n, item) => (
                <span>
                  {formatUsd(Number(valor), 2)} · {item.payload.documentos} documento(s)
                </span>
              )}
            />
          }
        />
        <Bar dataKey="usd" radius={[0, 4, 4, 0]} {...SIN_ANIMACION}>
          {antiguedad.map((t) => (
            <Cell key={t.clave} fill={COLOR_TRAMO[t.clave] ?? "var(--chart-5)"} />
          ))}
          <LabelList dataKey="usd" position="right" className="fill-foreground text-xs" formatter={(v) => usdCompacto(Number(v))} />
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}
