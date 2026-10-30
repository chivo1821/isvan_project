import type { ReactNode } from "react";
import { AlertTriangleIcon, ArrowDownRightIcon, ArrowUpRightIcon, MinusIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { formatNumero, formatPct } from "@/lib/constants";
import { cn } from "@/lib/utils";

/** Si subir es bueno (venta), malo (devoluciones) o ninguna de las dos
 * (el costo sube con la venta). Solo decide el color de la flecha. */
export type Sentido = "sube-bien" | "sube-mal" | "neutro";

export function CambioContraAnterior({
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

export function Kpi({
  label,
  valor,
  cambio,
  detalle,
  aviso = false,
}: {
  label: ReactNode;
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
