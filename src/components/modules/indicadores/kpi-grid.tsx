import type { ReactNode } from "react";
import { AlertTriangleIcon, ArrowDownRightIcon, ArrowUpRightIcon, MinusIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { formatNumero, formatPct, formatUsd } from "@/lib/constants";
import {
  formatFecha,
  formatMes,
  type Indicadores,
  type ResumenIndicadores,
  type Variacion,
} from "@/lib/indicadores";
import { cn } from "@/lib/utils";

/** Si subir es bueno (venta), malo (devoluciones) o ninguna de las dos
 * (el costo sube con la venta). Solo decide el color de la flecha. */
type Sentido = "sube-bien" | "sube-mal" | "neutro";

function CambioContraAnterior({
  valor,
  enPuntos = false,
  sentido,
}: {
  valor: number | null | undefined;
  enPuntos?: boolean;
  sentido: Sentido;
}) {
  if (valor == null) {
    return (
      <span className="text-xs text-muted-foreground" title="No hay ventas en el período anterior para comparar">
        sin período anterior
      </span>
    );
  }
  const igual = Math.abs(valor) < 0.0005;
  const sube = valor > 0;
  const bueno = sentido === "neutro" || igual ? null : sube === (sentido === "sube-bien");
  const Icono = igual ? MinusIcon : sube ? ArrowUpRightIcon : ArrowDownRightIcon;
  const signo = sube ? "+" : "";
  const texto = enPuntos ? `${signo}${formatNumero(valor * 100, 1)} pp` : `${signo}${formatPct(valor, 1)}`;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 text-xs font-medium",
        bueno === true && "text-success",
        bueno === false && "text-destructive",
        bueno === null && "text-muted-foreground"
      )}
    >
      <Icono className="size-3.5" />
      {texto}
    </span>
  );
}

function Kpi({
  label,
  valor,
  cambio,
  detalle,
  aviso = false,
}: {
  label: string;
  valor: string;
  cambio: ReactNode;
  detalle?: ReactNode;
  aviso?: boolean;
}) {
  return (
    <Card className={cn(aviso && "ring-warning/50")}>
      <CardContent className="space-y-1">
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          {aviso && <AlertTriangleIcon className="size-3.5 text-warning" />}
          {label}
        </p>
        <p className="text-2xl font-bold text-foreground tabular-nums">{valor}</p>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          {cambio}
          {detalle && <span className="text-xs text-muted-foreground">{detalle}</span>}
        </div>
      </CardContent>
    </Card>
  );
}

export function textoComparacion(c: ResumenIndicadores["comparacion"]) {
  if (c.tipo === "mes") {
    return c.desde.slice(0, 7) === c.hasta.slice(0, 7)
      ? `contra ${formatMes(c.desde)}`
      : `contra ${formatMes(c.desde)} – ${formatMes(c.hasta)}`;
  }
  if (c.tipo === "semana") return `contra la semana del ${formatFecha(c.desde)} al ${formatFecha(c.hasta)}`;
  return `contra el ${formatFecha(c.desde)} – ${formatFecha(c.hasta)}`;
}

/** Los indicadores del documento del cliente, cada uno con su cambio
 * contra el período anterior. La primera fila va en el orden en que se
 * llega a los números, de izquierda a derecha: bruta menos devoluciones da
 * la neta, y neta menos costo da el margen. */
export function KpiGrid({ actual, variacion }: { actual: Indicadores; variacion: Variacion | null }) {
  const v = variacion ?? {};
  const pctSinCosto = actual.ventaNeta ? actual.ventaSinCosto / actual.ventaNeta : null;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      <Kpi
        label="Venta bruta"
        valor={formatUsd(actual.ventaBruta)}
        cambio={<CambioContraAnterior valor={v.ventaBruta} sentido="sube-bien" />}
      />
      <Kpi
        label="Devoluciones"
        valor={formatUsd(actual.devoluciones)}
        cambio={<CambioContraAnterior valor={v.pctDevolucion} enPuntos sentido="sube-mal" />}
        detalle={`${formatPct(actual.pctDevolucion, 2)} de la bruta`}
      />
      <Kpi
        label="Venta neta"
        valor={formatUsd(actual.ventaNeta)}
        cambio={<CambioContraAnterior valor={v.ventaNeta} sentido="sube-bien" />}
        detalle={`Bs ${formatNumero(actual.ventaNetaBs)}`}
      />
      <Kpi
        label="Costo"
        valor={formatUsd(actual.costo)}
        cambio={<CambioContraAnterior valor={v.costo} sentido="neutro" />}
        detalle="cajas × costo por caja"
      />
      <Kpi
        label="Margen"
        valor={formatUsd(actual.margen)}
        cambio={<CambioContraAnterior valor={v.margenPct} enPuntos sentido="sube-bien" />}
        detalle={`${formatPct(actual.margenPct)} de la venta`}
      />
      <Kpi
        label="Venta sin costo"
        valor={formatUsd(actual.ventaSinCosto)}
        cambio={<CambioContraAnterior valor={v.ventaSinCosto} sentido="sube-mal" />}
        detalle={
          actual.ventaSinCosto > 0
            ? `${formatPct(pctSinCosto)} de la venta: su margen no se conoce y el margen lo incluye`
            : "todos los productos tienen costo"
        }
        aviso={actual.ventaSinCosto > 0}
      />
      <Kpi
        label="Litros"
        valor={formatNumero(actual.litros)}
        cambio={<CambioContraAnterior valor={v.litros} sentido="sube-bien" />}
      />
      <Kpi
        label="Cajas"
        valor={formatNumero(actual.cajas)}
        cambio={<CambioContraAnterior valor={v.cajas} sentido="sube-bien" />}
      />
      <Kpi
        label="Unidades"
        valor={formatNumero(actual.unidades)}
        cambio={<CambioContraAnterior valor={v.unidades} sentido="sube-bien" />}
      />
      <Kpi
        label="Precio por litro"
        valor={formatUsd(actual.precioLitro, 2)}
        cambio={<CambioContraAnterior valor={v.precioLitro} sentido="sube-bien" />}
      />
      <Kpi
        label="Clientes atendidos"
        valor={formatNumero(actual.clientes)}
        cambio={<CambioContraAnterior valor={v.clientes} sentido="sube-bien" />}
        detalle={`${formatNumero(actual.cadenas)} cadenas`}
      />
      <Kpi
        label="Ticket promedio"
        valor={formatUsd(actual.ticketPromedio, 2)}
        cambio={<CambioContraAnterior valor={v.ticketPromedio} sentido="sube-bien" />}
        detalle={`${formatNumero(actual.documentos)} documentos`}
      />
    </div>
  );
}
