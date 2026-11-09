import type { ReactNode } from "react";
import { Kpi } from "@/components/modules/indicadores/kpi";
import { Chequeo } from "@/components/modules/indicadores/resumen-validacion";
import { formatPct, formatUsd } from "@/lib/constants";
import { formatMes, formatMesCorto } from "@/lib/indicadores";
import type { MesResultado, Resultados } from "@/lib/gastos";
import { cn } from "@/lib/utils";

type Linea = {
  label: ReactNode;
  valor: (m: MesResultado) => number | null;
  tipo?: "total" | "resultado" | "pct" | "detalle";
  signo?: "-";
};

function monto(valor: number | null, signo?: "-") {
  if (valor == null) return "—";
  if (valor === 0) return "—";
  return signo ? `(${formatUsd(valor)})` : formatUsd(valor);
}

/** El estado de resultados por mes: venta neta menos su costo (los mismos
 * números de Indicadores de venta) menos los gastos cargados. */
export function EstadoResultados({ datos }: { datos: Resultados }) {
  const { total, meses, categorias } = datos;
  const sinGastos = meses.filter((m) => m.ventaNeta > 0 && m.totalGastos === 0);
  const hayGastos = total.totalGastos > 0;

  const lineas: Linea[] = [
    { label: "Venta bruta", valor: (m) => m.ventaBruta },
    { label: "Devoluciones", valor: (m) => m.devoluciones, signo: "-" },
    { label: "Venta neta", valor: (m) => m.ventaNeta, tipo: "total" },
    { label: "Costo de lo vendido", valor: (m) => m.costo, signo: "-" },
    { label: "Margen bruto", valor: (m) => m.margenBruto, tipo: "total" },
    { label: "% sobre la venta neta", valor: (m) => m.margenBrutoPct, tipo: "pct" },
    ...categorias.map<Linea>((c) => ({
      label: c.charAt(0) + c.slice(1).toLowerCase(),
      valor: (m) => m.gastos[c] ?? 0,
      tipo: "detalle",
      signo: "-",
    })),
    { label: "Total gastos", valor: (m) => m.totalGastos, tipo: "total", signo: "-" },
    { label: "Resultado de las operaciones", valor: (m) => m.resultado, tipo: "resultado" },
    { label: "% sobre la venta neta", valor: (m) => m.resultadoPct, tipo: "pct" },
  ];

  return (
    <div className="min-w-0 space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Venta neta" valor={formatUsd(total.ventaNeta)} cambio={null} />
        <Kpi
          label="Margen bruto"
          valor={formatUsd(total.margenBruto)}
          cambio={null}
          detalle={total.margenBrutoPct != null ? `${formatPct(total.margenBrutoPct)} de la venta` : undefined}
          aviso={total.ventaSinCosto > 0}
        />
        <Kpi label="Gastos" valor={formatUsd(total.totalGastos)} cambio={null} aviso={!hayGastos} />
        <Kpi
          label="Resultado"
          valor={formatUsd(total.resultado)}
          cambio={null}
          detalle={total.resultadoPct != null ? `${formatPct(total.resultadoPct)} de la venta` : undefined}
        />
      </div>

      {(total.ventaSinCosto > 0 || sinGastos.length > 0 || !hayGastos) && (
        <ul className="space-y-2">
          {!hayGastos && (
            <Chequeo nivel="aviso" titulo="No hay gastos cargados en este período">
              <p>El resultado es igual al margen bruto hasta que se carguen los gastos del Excel.</p>
            </Chequeo>
          )}
          {hayGastos && sinGastos.length > 0 && (
            <Chequeo nivel="aviso" titulo="Meses con ventas y sin gastos cargados">
              <p>{sinGastos.map((m) => formatMes(m.mes)).join(", ")}: su resultado sale más alto de lo real.</p>
            </Chequeo>
          )}
          {total.ventaSinCosto > 0 && (
            <Chequeo nivel="aviso" titulo={`${formatUsd(total.ventaSinCosto)} de venta sin costo cargado`}>
              <p>
                Esa venta cuenta completa en el margen, como si no costara nada: el margen y el resultado salen más altos
                de lo real. Se corrige cargando la lista de precios en Indicadores de venta.
              </p>
            </Chequeo>
          )}
        </ul>
      )}

      {meses.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
          No hay ventas ni gastos en este período.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm tabular-nums">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="sticky left-0 bg-card px-3 py-2 text-left font-medium">USD</th>
                {meses.map((m) => (
                  <th key={m.mes} className="px-3 py-2 text-right font-medium whitespace-nowrap capitalize">
                    {formatMesCorto(m.mes)}
                  </th>
                ))}
                {meses.length > 1 && <th className="px-3 py-2 text-right font-medium">Total</th>}
              </tr>
            </thead>
            <tbody>
              {lineas.map((linea, i) => {
                const celda = (m: MesResultado) => {
                  const v = linea.valor(m);
                  if (linea.tipo === "pct") return v == null ? "—" : formatPct(v);
                  if (linea.tipo === "resultado") return v == null ? "—" : formatUsd(v);
                  return monto(v, linea.signo);
                };
                const negativo = (m: MesResultado) => linea.tipo === "resultado" && m.resultado < 0;
                return (
                  <tr
                    key={i}
                    className={cn(
                      "border-b border-border last:border-0",
                      linea.tipo === "total" && "font-semibold text-foreground",
                      linea.tipo === "resultado" && "bg-muted/40 font-bold text-foreground",
                      linea.tipo === "pct" && "text-xs text-muted-foreground",
                      linea.tipo === "detalle" && "text-muted-foreground"
                    )}
                  >
                    <th
                      scope="row"
                      className={cn(
                        "sticky left-0 bg-card px-3 py-1.5 text-left font-normal whitespace-nowrap",
                        linea.tipo === "total" && "font-semibold",
                        linea.tipo === "resultado" && "bg-muted font-bold",
                        linea.tipo === "detalle" && "pl-6",
                        linea.tipo === "pct" && "pl-6"
                      )}
                    >
                      {linea.label}
                    </th>
                    {meses.map((m) => (
                      <td
                        key={m.mes}
                        className={cn("px-3 py-1.5 text-right whitespace-nowrap", negativo(m) && "text-destructive")}
                      >
                        {celda(m)}
                      </td>
                    ))}
                    {meses.length > 1 && (
                      <td
                        className={cn(
                          "px-3 py-1.5 text-right font-semibold whitespace-nowrap",
                          negativo(total) && "text-destructive"
                        )}
                      >
                        {celda(total)}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Venta y costo salen de las cargas de ventas confirmadas, con el costo por caja de la lista de precios. Los gastos,
        de las cargas de gastos confirmadas; los que vinieron en bolívares se pasan a dólares con la tasa del Excel o, si
        no la trae, con la tasa BCV de ese día.
      </p>
    </div>
  );
}
