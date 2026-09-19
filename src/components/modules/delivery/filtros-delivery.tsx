"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { DateRange } from "react-day-picker";
import { es } from "react-day-picker/locale";
import { CalendarIcon, Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDate } from "@/lib/constants";
import {
  hoyCaracas,
  inicioDeMes,
  queryDelivery,
  sumarDias,
  type FiltrosDelivery,
  type ResumenDelivery,
} from "@/lib/delivery";
import { cn } from "@/lib/utils";

// El calendario trabaja con Date locales; la URL, con "YYYY-MM-DD".
function aFecha(texto: string) {
  return new Date(`${texto}T00:00:00`);
}
function aTexto(fecha: Date) {
  return `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, "0")}-${String(fecha.getDate()).padStart(2, "0")}`;
}

/** Los pagos se arman por quincena, así que esos son los atajos. */
function atajos(hoy: string) {
  const mes = inicioDeMes(hoy);
  const dia = Number(hoy.slice(8));
  const segundaQuincena = `${hoy.slice(0, 7)}-16`;
  const finDeMesAnterior = sumarDias(mes, -1);
  const mesAnterior = inicioDeMes(finDeMesAnterior);
  return [
    dia <= 15
      ? { label: "Quincena en curso", desde: mes, hasta: hoy }
      : { label: "Quincena en curso", desde: segundaQuincena, hasta: hoy },
    dia <= 15
      ? { label: "Quincena anterior", desde: `${mesAnterior.slice(0, 7)}-16`, hasta: finDeMesAnterior }
      : { label: "Quincena anterior", desde: mes, hasta: `${hoy.slice(0, 7)}-15` },
    { label: "Mes en curso", desde: mes, hasta: hoy },
    { label: "Mes anterior", desde: mesAnterior, hasta: finDeMesAnterior },
  ];
}

/** Período y motorizado. Viven en la URL: la página se vuelve a calcular en
 * el servidor con cada cambio y el enlace se puede compartir. */
export function FiltrosDeliveryBarra({
  filtros,
  motorizados,
}: {
  filtros: FiltrosDelivery;
  motorizados: ResumenDelivery["motorizados"];
}) {
  const router = useRouter();
  const [actualizando, startTransition] = useTransition();
  const [abierto, setAbierto] = useState(false);
  const [rango, setRango] = useState<DateRange | undefined>();

  function aplicar(cambios: Partial<FiltrosDelivery>) {
    startTransition(() => router.replace(`/delivery?${queryDelivery({ ...filtros, ...cambios })}`, { scroll: false }));
  }

  function elegirPeriodo(desde: string, hasta: string) {
    setAbierto(false);
    aplicar({ desde, hasta });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Popover
        open={abierto}
        onOpenChange={(v) => {
          setAbierto(v);
          if (v) setRango({ from: aFecha(filtros.desde), to: aFecha(filtros.hasta) });
        }}
      >
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm">
            <CalendarIcon />
            {formatDate(filtros.desde)} – {formatDate(filtros.hasta)}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-0">
          <div className="flex flex-col gap-1 border-b border-border p-2 sm:flex-row">
            {atajos(hoyCaracas()).map((a) => (
              <Button
                key={a.label}
                variant="ghost"
                size="sm"
                className="justify-start"
                onClick={() => elegirPeriodo(a.desde, a.hasta)}
              >
                {a.label}
              </Button>
            ))}
          </div>
          <Calendar
            mode="range"
            locale={es}
            numberOfMonths={2}
            defaultMonth={aFecha(filtros.desde)}
            selected={rango}
            onSelect={(nuevo) => {
              setRango(nuevo);
              if (nuevo?.from && nuevo?.to) elegirPeriodo(aTexto(nuevo.from), aTexto(nuevo.to));
            }}
          />
        </PopoverContent>
      </Popover>

      <Select value={filtros.repartidor || "todos"} onValueChange={(v) => aplicar({ repartidor: v === "todos" ? "" : v })}>
        <SelectTrigger size="sm" className={cn("w-56", filtros.repartidor && "border-primary/60 text-primary")}>
          <SelectValue placeholder="Todos los motorizados" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="todos">Todos los motorizados</SelectItem>
          {motorizados.map((m) => (
            <SelectItem key={m.id} value={m.id}>
              {m.nombre} · {m.placa}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {actualizando && (
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2Icon className="size-3.5 animate-spin" />
          Actualizando…
        </span>
      )}
    </div>
  );
}
