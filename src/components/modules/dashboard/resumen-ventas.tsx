import Link from "next/link";
import { ArrowRightIcon } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatNumero, formatPct, formatUsd } from "@/lib/constants";
import { formatMes, type Empresa, type ResumenIndicadores } from "@/lib/indicadores";
import { cn } from "@/lib/utils";

export type VentasEmpresa = { empresa: Empresa; desde: string; hasta: string; resumen: ResumenIndicadores };

/** Lo esencial de la venta del último mes cargado, por empresa. El detalle
 * está en Indicadores de venta; acá solo lo que se mira primero al entrar. */
export function ResumenVentas({ ventas }: { ventas: VentasEmpresa[] }) {
  if (ventas.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 py-8 text-center text-sm text-muted-foreground">
          Todavía no hay ventas cargadas.
          <Link href="/indicadores/cargas" className="text-primary hover:underline">
            Cargar el extracto de ventas →
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className={cn("grid grid-cols-1 gap-4", ventas.length > 1 && "xl:grid-cols-2")}>
      {ventas.map(({ empresa, desde, hasta, resumen }) => {
        const actual = resumen.actual!;
        const variacion = resumen.variacion ?? {};
        return (
          <Card key={empresa}>
            <CardHeader className="flex-row items-start justify-between gap-2">
              <div className="space-y-1">
                <CardTitle>
                  {empresa} · {formatMes(desde)}
                </CardTitle>
                <CardDescription>
                  {resumen.anterior ? `Cambios contra ${formatMes(resumen.comparacion.desde)}` : "Sin mes anterior para comparar"}
                </CardDescription>
              </div>
              <Link
                href={`/indicadores?empresa=${empresa}&desde=${desde}&hasta=${hasta}`}
                className="inline-flex shrink-0 items-center gap-1 text-sm text-primary hover:underline"
              >
                Ver indicadores <ArrowRightIcon className="size-3.5" />
              </Link>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Dato etiqueta="Venta neta" valor={formatUsd(actual.ventaNeta)} cambio={variacion.ventaNeta} />
              <Dato etiqueta="Margen" valor={formatPct(actual.margenPct)} cambio={variacion.margenPct} enPuntos />
              <Dato etiqueta="Clientes atendidos" valor={formatNumero(actual.clientes)} cambio={variacion.clientes} />
              <Dato
                etiqueta="Devoluciones"
                valor={formatPct(actual.pctDevolucion)}
                cambio={variacion.pctDevolucion}
                enPuntos
                subirEsMalo
              />
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function Dato({
  etiqueta,
  valor,
  cambio,
  enPuntos = false,
  subirEsMalo = false,
}: {
  etiqueta: string;
  valor: string;
  cambio?: number | null;
  /** Porcentajes: el cambio va en puntos, no en % de cambio. */
  enPuntos?: boolean;
  /** Devoluciones: que suban es una mala noticia. */
  subirEsMalo?: boolean;
}) {
  const bueno = cambio != null && (subirEsMalo ? cambio < 0 : cambio > 0);
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-xs text-muted-foreground">{etiqueta}</p>
      <p className="text-xl font-bold text-foreground">{valor}</p>
      {cambio != null && (
        <p className={cn("text-xs font-medium", bueno ? "text-success" : cambio === 0 ? "text-muted-foreground" : "text-destructive")}>
          {cambio > 0 ? "+" : ""}
          {formatNumero(cambio * 100, 1)} {enPuntos ? "pp" : "%"}
        </p>
      )}
    </div>
  );
}
