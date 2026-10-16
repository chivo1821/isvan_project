"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2Icon, SearchIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { queryCenso, VISTAS_CENSO, type FiltrosCenso, type ListaCensos, type VistaCenso } from "@/lib/censo";

const TODOS = "";

function Selector({
  etiqueta,
  valor,
  opciones,
  onCambio,
}: {
  etiqueta: string;
  valor: string;
  opciones: string[];
  onCambio: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
      {etiqueta}
      <select
        value={valor}
        onChange={(e) => onCambio(e.target.value)}
        className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground"
      >
        <option value={TODOS}>Todos</option>
        {opciones.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Navega a /censo con los filtros cambiados (vuelve a la primera página y
 * conserva la pestaña). */
export function useAplicarFiltros(filtros: FiltrosCenso) {
  const router = useRouter();
  const [actualizando, startTransition] = useTransition();
  function aplicar(cambios: Partial<FiltrosCenso>) {
    // La pestaña cambia sin volver a pedir la página (tablero-censo.tsx): la
    // vigente es la de la URL, no la de cuando se cargó.
    const enUrl = new URLSearchParams(window.location.search).get("vista") ?? "principal";
    const vista = (VISTAS_CENSO as readonly string[]).includes(enUrl) ? (enUrl as VistaCenso) : filtros.vista;
    const nuevos = { ...filtros, vista, pagina: 1, ...cambios };
    startTransition(() => router.replace(`/censo?${queryCenso(nuevos)}`, { scroll: false }));
  }
  return { aplicar, actualizando };
}

export function hayFiltrosCenso(f: FiltrosCenso) {
  return !!f.desde || !!f.hasta || !!f.q || f.encuestador.length + f.tipoCliente.length + f.empresa.length + f.ruta.length > 0;
}

/** Los filtros del censo: valen para todas las pestañas del tablero y viven
 * en la URL (la página se vuelve a pedir al servidor con cada cambio). */
export function FiltrosDelCenso({ filtros, opciones }: { filtros: FiltrosCenso; opciones: ListaCensos["opciones"] }) {
  const { aplicar, actualizando } = useAplicarFiltros(filtros);
  const [busqueda, setBusqueda] = useState(filtros.q);

  return (
    <Card>
      <CardContent className="py-4">
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            aplicar({ q: busqueda });
          }}
        >
          <label className="flex min-w-56 flex-1 flex-col gap-1 text-xs text-muted-foreground">
            Buscar
            <span className="relative">
              <SearchIcon className="absolute top-2.5 left-2.5 size-4" />
              <Input
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Comercio, RIF, código o teléfono"
                className="pl-8"
              />
            </span>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Desde
            <Input type="date" value={filtros.desde ?? ""} onChange={(e) => aplicar({ desde: e.target.value || null })} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Hasta
            <Input type="date" value={filtros.hasta ?? ""} onChange={(e) => aplicar({ hasta: e.target.value || null })} />
          </label>
          <Selector
            etiqueta="Vendedor"
            valor={filtros.encuestador[0] ?? TODOS}
            opciones={opciones.encuestador}
            onCambio={(v) => aplicar({ encuestador: v ? [v] : [] })}
          />
          <Selector
            etiqueta="Ruta"
            valor={filtros.ruta[0] ?? TODOS}
            opciones={opciones.ruta}
            onCambio={(v) => aplicar({ ruta: v ? [v] : [] })}
          />
          <Selector
            etiqueta="Tipo de cliente"
            valor={filtros.tipoCliente[0] ?? TODOS}
            opciones={opciones.tipoCliente}
            onCambio={(v) => aplicar({ tipoCliente: v ? [v] : [] })}
          />
          <Selector
            etiqueta="Empresa"
            valor={filtros.empresa[0] ?? TODOS}
            opciones={opciones.empresa}
            onCambio={(v) => aplicar({ empresa: v ? [v] : [] })}
          />
          <Button type="submit" variant="outline">
            <SearchIcon /> Buscar
          </Button>
          {hayFiltrosCenso(filtros) && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setBusqueda("");
                aplicar({ desde: null, hasta: null, encuestador: [], tipoCliente: [], empresa: [], ruta: [], q: "" });
              }}
            >
              <XIcon /> Limpiar
            </Button>
          )}
          {actualizando && <Loader2Icon className="mb-2.5 size-4 animate-spin text-muted-foreground" />}
        </form>
      </CardContent>
    </Card>
  );
}
