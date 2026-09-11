"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { DateRange } from "react-day-picker";
import { es } from "react-day-picker/locale";
import { CalendarIcon, ChevronDownIcon, Loader2Icon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  EMPRESAS,
  finDeMes,
  formatFecha,
  inicioDeMes,
  queryPagina,
  sumarMeses,
  type Empresa,
  type FiltrosIndicadores,
  type OpcionesIndicadores,
} from "@/lib/indicadores";
import { cn } from "@/lib/utils";

// El calendario trabaja con Date locales; la URL, con "YYYY-MM-DD".
function aFecha(texto: string) {
  const [anio, mes, dia] = texto.split("-").map(Number);
  return new Date(anio, mes - 1, dia);
}

function aTexto(fecha: Date) {
  const dos = (n: number) => String(n).padStart(2, "0");
  return `${fecha.getFullYear()}-${dos(fecha.getMonth() + 1)}-${dos(fecha.getDate())}`;
}

function SelectorPeriodo({
  desde,
  hasta,
  opciones,
  onCambiar,
}: {
  desde: string;
  hasta: string;
  opciones: OpcionesIndicadores;
  onCambiar: (desde: string, hasta: string) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [rango, setRango] = useState<DateRange | undefined>();

  // Los atajos se cuentan desde el último día con ventas, no desde hoy: el
  // extracto llega con días o semanas de atraso y "este mes" saldría vacío.
  const referencia = opciones.fechaMax ?? hasta;
  const anterior = sumarMeses(referencia, -1);
  const atajos = [
    { label: "Último mes con ventas", desde: inicioDeMes(referencia), hasta: finDeMes(referencia) },
    { label: "Mes anterior", desde: anterior, hasta: finDeMes(anterior) },
    { label: "Últimos 3 meses", desde: sumarMeses(referencia, -2), hasta: finDeMes(referencia) },
    ...(opciones.fechaMin && opciones.fechaMax
      ? [{ label: "Todo el histórico", desde: opciones.fechaMin, hasta: opciones.fechaMax }]
      : []),
  ];

  function elegir(nuevoDesde: string, nuevoHasta: string) {
    setAbierto(false);
    onCambiar(nuevoDesde, nuevoHasta);
  }

  return (
    <Popover
      open={abierto}
      onOpenChange={(v) => {
        if (v) setRango({ from: aFecha(desde), to: aFecha(hasta) });
        setAbierto(v);
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <CalendarIcon />
          {formatFecha(desde)} – {formatFecha(hasta)}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto max-w-[calc(100vw-2rem)] p-3">
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="flex flex-row flex-wrap gap-1 sm:w-44 sm:flex-col">
            {atajos.map((a) => (
              <Button
                key={a.label}
                variant="ghost"
                size="sm"
                className="justify-start"
                onClick={() => elegir(a.desde, a.hasta)}
              >
                {a.label}
              </Button>
            ))}
          </div>
          <div className="space-y-2">
            <Calendar
              mode="range"
              locale={es}
              numberOfMonths={2}
              defaultMonth={aFecha(desde)}
              selected={rango}
              onSelect={setRango}
            />
            <div className="flex justify-end">
              <Button
                size="sm"
                disabled={!rango?.from || !rango?.to}
                onClick={() => rango?.from && rango.to && elegir(aTexto(rango.from), aTexto(rango.to))}
              >
                Aplicar
              </Button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

type OpcionFiltro = { valor: string; etiqueta: string; detalle?: string };

// Con más opciones que esto el menú trae un buscador (clientes, productos) y
// dibuja solo las primeras coincidencias, para no pintar cientos de filas.
const OPCIONES_SIN_BUSCADOR = 15;
const MAXIMO_VISIBLES = 100;

function comoOpciones(valores: string[]): OpcionFiltro[] {
  return valores.map((valor) => ({ valor, etiqueta: valor }));
}

function paraBuscar(texto: string) {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Filtro de varios valores. La selección se aplica al cerrar el menú, no
 * con cada clic: cada cambio vuelve a calcular toda la página. Con muchas
 * opciones (clientes, productos) trae un buscador por nombre o código. */
function FiltroMultiple({
  etiqueta,
  todos,
  opciones,
  seleccion,
  onCambiar,
}: {
  etiqueta: string;
  todos: string;
  opciones: OpcionFiltro[];
  seleccion: string[];
  onCambiar: (valores: string[]) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [borrador, setBorrador] = useState<string[]>(seleccion);
  const [busqueda, setBusqueda] = useState("");
  const conBuscador = opciones.length > OPCIONES_SIN_BUSCADOR;

  function cambiarAbierto(v: boolean) {
    if (v) {
      setBorrador(seleccion);
      setBusqueda("");
    } else {
      const elegidos = opciones.filter((o) => borrador.includes(o.valor)).map((o) => o.valor);
      if (elegidos.join("|") !== seleccion.join("|")) onCambiar(elegidos);
    }
    setAbierto(v);
  }

  const etiquetaDe = new Map(opciones.map((o) => [o.valor, o.etiqueta]));
  const nombres = seleccion.map((valor) => etiquetaDe.get(valor) ?? valor);
  const texto =
    seleccion.length === 0
      ? todos
      : seleccion.length <= 2
        ? `${etiqueta}: ${nombres.join(", ")}`
        : `${etiqueta} (${seleccion.length})`;

  const termino = paraBuscar(busqueda.trim());
  const coincidencias = termino
    ? opciones.filter((o) => paraBuscar(`${o.etiqueta} ${o.valor} ${o.detalle ?? ""}`).includes(termino))
    : opciones;
  // Lo ya marcado va primero, para poder desmarcarlo sin tener que buscarlo.
  const ordenadas = [
    ...coincidencias.filter((o) => borrador.includes(o.valor)),
    ...coincidencias.filter((o) => !borrador.includes(o.valor)),
  ];
  const visibles = ordenadas.slice(0, MAXIMO_VISIBLES);

  return (
    <DropdownMenu open={abierto} onOpenChange={cambiarAbierto}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn("max-w-72", seleccion.length > 0 && "border-primary/60 text-primary")}
        >
          <span className="truncate">{texto}</span>
          <ChevronDownIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className={cn("max-h-80 overflow-y-auto", conBuscador ? "w-80" : "w-60")}>
        <DropdownMenuLabel>{etiqueta}</DropdownMenuLabel>
        {conBuscador && (
          <div className="px-1 pb-1">
            <Input
              autoFocus
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              // El menú usa el teclado para moverse entre opciones y saltar a
              // la que empieza con la letra tecleada: sin esto, escribir en el
              // buscador le quitaría el foco al campo.
              onKeyDown={(e) => {
                if (e.key !== "Escape") e.stopPropagation();
              }}
              placeholder="Buscar por nombre o código"
              aria-label={`Buscar ${etiqueta.toLowerCase()}`}
              className="h-8"
            />
          </div>
        )}
        <DropdownMenuSeparator />
        {visibles.map((opcion) => (
          <DropdownMenuCheckboxItem
            key={opcion.valor}
            checked={borrador.includes(opcion.valor)}
            onCheckedChange={(marcado) =>
              setBorrador((previo) =>
                marcado ? [...previo, opcion.valor] : previo.filter((o) => o !== opcion.valor)
              )
            }
            // Sin esto el menú se cierra en cada clic.
            onSelect={(e) => e.preventDefault()}
          >
            <span className="min-w-0">
              <span className="block truncate">{opcion.etiqueta}</span>
              {opcion.detalle && (
                <span className="block truncate text-xs text-muted-foreground">{opcion.detalle}</span>
              )}
            </span>
          </DropdownMenuCheckboxItem>
        ))}
        {visibles.length === 0 && (
          <p className="px-2 py-3 text-center text-sm text-muted-foreground">Sin coincidencias</p>
        )}
        {ordenadas.length > visibles.length && (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">
            y {ordenadas.length - visibles.length} más: escribe para acotar la lista
          </p>
        )}
        {borrador.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                setBorrador([]);
              }}
            >
              Quitar selección ({borrador.length})
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Los filtros del módulo (período, ruta, grupo, tipo de cliente, cliente y
 * producto) y la empresa. Viven en la URL: la página se vuelve a calcular en el
 * servidor con cada cambio, y el enlace se puede compartir tal cual. */
export function BarraFiltros({ filtros, opciones }: { filtros: FiltrosIndicadores; opciones: OpcionesIndicadores }) {
  const router = useRouter();
  const [actualizando, startTransition] = useTransition();

  function aplicar(cambios: Partial<FiltrosIndicadores>) {
    const nuevos = { ...filtros, ...cambios };
    startTransition(() => router.replace(`/indicadores?${queryPagina(nuevos)}`, { scroll: false }));
  }

  function cambiarEmpresa(empresa: Empresa) {
    // Rutas, grupos y fechas son de cada empresa: se empieza de cero.
    startTransition(() => router.replace(`/indicadores?empresa=${empresa}`, { scroll: false }));
  }

  const hayFiltros =
    filtros.rutas.length + filtros.grupos.length + filtros.tipos.length + filtros.clientes.length + filtros.productos.length >
    0;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={filtros.empresa} onValueChange={(v) => cambiarEmpresa(v as Empresa)}>
        <SelectTrigger size="sm" className="w-28" aria-label="Empresa">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {EMPRESAS.map((e) => (
            <SelectItem key={e} value={e}>
              {e}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <SelectorPeriodo
        desde={filtros.desde}
        hasta={filtros.hasta}
        opciones={opciones}
        onCambiar={(desde, hasta) => aplicar({ desde, hasta })}
      />
      <FiltroMultiple
        etiqueta="Ruta"
        todos="Todas las rutas"
        opciones={comoOpciones(opciones.rutas)}
        seleccion={filtros.rutas}
        onCambiar={(rutas) => aplicar({ rutas })}
      />
      <FiltroMultiple
        etiqueta="Grupo"
        todos="Todos los grupos"
        opciones={comoOpciones(opciones.grupos)}
        seleccion={filtros.grupos}
        onCambiar={(grupos) => aplicar({ grupos })}
      />
      <FiltroMultiple
        etiqueta="Tipo de cliente"
        todos="Todos los tipos de cliente"
        opciones={comoOpciones(opciones.tiposCliente)}
        seleccion={filtros.tipos}
        onCambiar={(tipos) => aplicar({ tipos })}
      />
      <FiltroMultiple
        etiqueta="Cliente"
        todos="Todos los clientes"
        opciones={opciones.clientes.map((c) => ({
          valor: c.codigo,
          etiqueta: c.nombre,
          detalle: `Cód. ${c.codigo} · ruta ${c.ruta}`,
        }))}
        seleccion={filtros.clientes}
        onCambiar={(clientes) => aplicar({ clientes })}
      />
      <FiltroMultiple
        etiqueta="Producto"
        todos="Todos los productos"
        opciones={opciones.productos.map((p) => ({
          valor: p.codigo,
          etiqueta: p.nombre,
          detalle: `SKU ${p.codigo} · ${p.grupo}`,
        }))}
        seleccion={filtros.productos}
        onCambiar={(productos) => aplicar({ productos })}
      />
      {hayFiltros && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => aplicar({ rutas: [], grupos: [], tipos: [], clientes: [], productos: [] })}
        >
          <XIcon />
          Limpiar filtros
        </Button>
      )}
      {actualizando && (
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2Icon className="size-3.5 animate-spin" />
          Actualizando…
        </span>
      )}
    </div>
  );
}
