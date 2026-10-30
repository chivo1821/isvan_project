import { CambioContraAnterior, Kpi } from "@/components/modules/indicadores/kpi";
import { KpiPrecio } from "@/components/modules/indicadores/kpi-precio";
import { formatNumero, formatPct, formatUsd } from "@/lib/constants";
import {
  formatFecha,
  formatMes,
  type ActivacionClientes,
  type Indicadores,
  type ResumenIndicadores,
  type Variacion,
} from "@/lib/indicadores";

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
export function KpiGrid({
  actual,
  variacion,
  activacion,
}: {
  actual: Indicadores;
  variacion: Variacion | null;
  activacion?: ActivacionClientes;
}) {
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
      <KpiPrecio actual={actual} variacion={v} />
      <Kpi
        label="Clientes atendidos"
        valor={formatNumero(actual.clientes)}
        cambio={<CambioContraAnterior valor={v.clientes} sentido="sube-bien" />}
        detalle={
          activacion && activacion.cartera > 0 ? (
            <>
              de {formatNumero(activacion.cartera)} en cartera ({formatPct(activacion.pctActivacion)})
              <span className="block">
                {formatNumero(activacion.noAtendidos)} sin compra · {formatNumero(actual.cadenas)} cadenas
              </span>
            </>
          ) : (
            `${formatNumero(actual.cadenas)} cadenas`
          )
        }
      />
      <Kpi
        label="Ticket promedio"
        valor={formatUsd(actual.ticketPromedio, 2)}
        cambio={<CambioContraAnterior valor={v.ticketPromedio} sentido="sube-bien" />}
        detalle={
          <span className="block">
            {formatNumero(actual.facturas)} facturas · {formatNumero(actual.notasEntrega)} notas de entrega
            {actual.documentosDevolucion > 0 && ` · ${formatNumero(actual.documentosDevolucion)} devoluciones`}
          </span>
        }
      />
    </div>
  );
}
