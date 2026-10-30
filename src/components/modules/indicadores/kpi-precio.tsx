"use client";

import { useState } from "react";
import { ArrowLeftRightIcon } from "lucide-react";
import { CambioContraAnterior, Kpi } from "@/components/modules/indicadores/kpi";
import { formatUsd } from "@/lib/constants";
import type { Indicadores, Variacion } from "@/lib/indicadores";

/** Precio promedio de venta: venta neta por litro o por unidad (pedido del
 * cliente, 2026-10-30). El título es el botón que cambia el cálculo; así
 * cabe en la tarjeta angosta sin bajar el valor a otra línea. */
export function KpiPrecio({ actual, variacion: v }: { actual: Indicadores; variacion: Variacion }) {
  const [porUnidad, setPorUnidad] = useState(false);
  return (
    <Kpi
      label={
        <button
          type="button"
          onClick={() => setPorUnidad(!porUnidad)}
          title={porUnidad ? "Ver por litro" : "Ver por unidad"}
          className="inline-flex cursor-pointer items-center gap-1 rounded-sm underline decoration-dotted underline-offset-4 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {porUnidad ? "Precio por unidad" : "Precio por litro"}
          <ArrowLeftRightIcon className="size-3.5 shrink-0" aria-hidden />
        </button>
      }
      valor={formatUsd(porUnidad ? actual.precioUnidad : actual.precioLitro, 2)}
      cambio={
        <CambioContraAnterior valor={porUnidad ? v.precioUnidad : v.precioLitro} sentido="sube-bien" />
      }
    />
  );
}
