"use client";

import { Children, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { formatNumero } from "@/lib/constants";

/** Una fila de las listas de clientes en el teléfono: el nombre con sus
 * datos debajo y el número que importa a la derecha, en vez de una tabla de
 * seis columnas que no cabe. */
export function ItemMovil({
  nombre,
  detalle,
  valor,
  valorDetalle,
}: {
  nombre: ReactNode;
  detalle?: ReactNode;
  valor?: ReactNode;
  valorDetalle?: ReactNode;
}) {
  return (
    <li className="flex items-start justify-between gap-3 px-3 py-2.5">
      <div className="min-w-0">
        <p className="font-medium break-words">{nombre}</p>
        {detalle && <p className="text-xs text-muted-foreground">{detalle}</p>}
      </div>
      {(valor != null || valorDetalle != null) && (
        <div className="shrink-0 text-right tabular-nums">
          {valor != null && <p className="font-semibold">{valor}</p>}
          {valorDetalle != null && <p className="text-xs text-muted-foreground">{valorDetalle}</p>}
        </div>
      )}
    </li>
  );
}

/** Contenedor de esas filas, solo en el teléfono. Sin scroll propio (dentro
 * de la página, el dedo se quedaba atrapado en la lista): muestra las
 * primeras filas y un botón para ver más. */
export function ListaMovil({ paso = 20, children }: { paso?: number; children: ReactNode }) {
  const [visibles, setVisibles] = useState(paso);
  const filas = Children.toArray(children);
  const resto = filas.length - visibles;
  return (
    <div className="space-y-2 sm:hidden">
      <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
        {filas.slice(0, visibles)}
      </ul>
      {resto > 0 && (
        <Button variant="outline" className="w-full" onClick={() => setVisibles((v) => v + paso)}>
          Ver {formatNumero(Math.min(paso, resto))} más (quedan {formatNumero(resto)})
        </Button>
      )}
    </div>
  );
}
