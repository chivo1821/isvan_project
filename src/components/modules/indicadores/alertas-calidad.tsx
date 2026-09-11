import { AlertTriangleIcon, CheckCircle2Icon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatPct, formatUsd } from "@/lib/constants";
import type { AlertasIndicadores } from "@/lib/indicadores";

function Seccion({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
        <AlertTriangleIcon className="size-4 shrink-0 text-warning" />
        {titulo}
      </p>
      <ul className="space-y-1 pl-5.5 text-xs text-muted-foreground">{children}</ul>
    </div>
  );
}

/** Calidad del dato del período: lo que hace que un indicador no sea del
 * todo confiable, para que se corrija en el origen. */
export function AlertasCalidad({ alertas, ventaNeta }: { alertas: AlertasIndicadores; ventaNeta: number }) {
  const sinAlertas =
    alertas.productosSinCosto.length === 0 &&
    alertas.desviosMargen.length === 0 &&
    alertas.productosDuplicados.length === 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Calidad del dato</CardTitle>
        <p className="text-sm text-muted-foreground">Lo que conviene corregir en el sistema de ventas.</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {sinAlertas && (
          <p className="flex items-center gap-1.5 text-sm text-success">
            <CheckCircle2Icon className="size-4" />
            Sin alertas en este período.
          </p>
        )}

        {alertas.productosSinCosto.length > 0 && (
          <Seccion
            titulo={`${formatUsd(alertas.ventaSinCosto)} de venta sin costo cargado (${formatPct(
              ventaNeta ? alertas.ventaSinCosto / ventaNeta : null
            )})`}
          >
            {alertas.productosSinCosto.map((p) => (
              <li key={p.codigo} className="flex justify-between gap-3">
                <span>
                  {p.nombre} <span className="text-muted-foreground/70">· {p.grupo}</span>
                </span>
                <span className="shrink-0 tabular-nums">{formatUsd(p.ventaNeta)}</span>
              </li>
            ))}
          </Seccion>
        )}

        {alertas.desviosMargen.length > 0 && (
          <Seccion titulo="Margen fuera de lo normal: revisar el costo por caja">
            {alertas.desviosMargen.map((d) => (
              <li key={d.codigo}>
                <span className="text-foreground">{d.nombre}</span>: {formatPct(d.margenPct)} contra{" "}
                {formatPct(d.margenGrupoPct)} de su grupo ({d.grupo})
              </li>
            ))}
          </Seccion>
        )}

        {alertas.productosDuplicados.length > 0 && (
          <Seccion titulo="El mismo producto con más de un código">
            {alertas.productosDuplicados.map((d) => (
              <li key={d.nombre}>
                <span className="text-foreground">{d.nombre}</span>: {d.codigos.join(" y ")} — su venta aparece
                partida en el desglose por producto
              </li>
            ))}
          </Seccion>
        )}
      </CardContent>
    </Card>
  );
}
