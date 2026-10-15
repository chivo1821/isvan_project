"use client";

import { Bar, BarChart, CartesianGrid, LabelList, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import type { Conteo } from "@/lib/censo";
import { formatNumero } from "@/lib/constants";

// Sin animación, como los demás tableros: al filtrar, la página se vuelve a
// pedir y las barras aparecen en su lugar.
const SIN_ANIMACION = { isAnimationActive: false } as const;
const config = { n: { label: "Censos", color: "var(--chart-1)" } } satisfies ChartConfig;

/** Barras horizontales de un conteo (por vendedor, por ruta, sí/no...), de
 * mayor a menor, con el número al final de cada barra. */
export function BarrasConteo({
  datos,
  color = "var(--chart-1)",
  anchoEtiqueta = 120,
}: {
  datos: Conteo[];
  color?: string;
  anchoEtiqueta?: number;
}) {
  if (!datos.length) return <p className="py-6 text-center text-sm text-muted-foreground">Sin datos</p>;
  // 28 px por barra: con 16 vendedores el gráfico crece en vez de apretarse.
  const alto = Math.max(96, datos.length * 28 + 16);
  return (
    <ChartContainer config={config} className="aspect-auto w-full" style={{ height: alto }}>
      <BarChart data={datos} layout="vertical" margin={{ left: 4, right: 48 }} accessibilityLayer>
        <CartesianGrid horizontal={false} />
        <XAxis type="number" hide allowDecimals={false} />
        <YAxis
          type="category"
          dataKey="clave"
          tickLine={false}
          axisLine={false}
          width={anchoEtiqueta}
          interval={0}
          tick={{ fontSize: 12 }}
        />
        <ChartTooltip
          cursor={{ fill: "var(--muted)", opacity: 0.5 }}
          content={<ChartTooltipContent hideIndicator formatter={(v) => `${formatNumero(Number(v))} censos`} />}
        />
        <Bar dataKey="n" fill={color} radius={[0, 4, 4, 0]} {...SIN_ANIMACION}>
          <LabelList dataKey="n" position="right" className="fill-foreground text-xs" formatter={(v) => formatNumero(Number(v))} />
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}

function diaCorto(iso: string) {
  const [, mes, dia] = iso.split("-");
  return `${dia}/${mes}`;
}

/** Censos por día (barras verticales). */
export function BarrasPorDia({ datos }: { datos: Conteo[] }) {
  if (!datos.length) return <p className="py-6 text-center text-sm text-muted-foreground">Sin datos</p>;
  const filas = datos.map((d) => ({ ...d, etiqueta: diaCorto(d.clave) }));
  return (
    <ChartContainer config={config} className="aspect-auto h-56 w-full">
      <BarChart data={filas} margin={{ top: 16, left: 0, right: 8 }} accessibilityLayer>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="etiqueta" tickLine={false} axisLine={false} tickMargin={6} minTickGap={12} />
        <YAxis tickLine={false} axisLine={false} width={32} allowDecimals={false} />
        <ChartTooltip
          cursor={{ fill: "var(--muted)", opacity: 0.5 }}
          content={
            <ChartTooltipContent
              hideIndicator
              labelFormatter={(_, payload) => payload?.[0]?.payload?.clave}
              formatter={(v) => `${formatNumero(Number(v))} censos`}
            />
          }
        />
        <Bar dataKey="n" fill="var(--color-n)" radius={[4, 4, 0, 0]} {...SIN_ANIMACION} />
      </BarChart>
    </ChartContainer>
  );
}
