import { AlertTriangleIcon } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatNumero, formatPct } from "@/lib/constants";
import { formatDiaCorto, formatMes, type CuadroMetas, type FilaCuadroMetas, type Semaforo } from "@/lib/indicadores";
import { cn } from "@/lib/utils";
import { FeriadosDialog } from "./feriados-dialog";

// Como en el cuadro del cliente, el color va en el número (sin flechas). Pero
// con sentido: el Excel coloreaba cada ruta comparándola con las demás; aquí
// se compara con el ritmo del mes. Variación = tendencia ÷ phasing, así que
// el estado, la tendencia, la proyección y la variación usan los mismos
// cortes (100 % y 80 % del ritmo).
const SEMAFORO: Record<Semaforo, { texto: string; plural: string; color: string; fondo: string; barra: string }> = {
  verde: { texto: "Al ritmo", plural: "al ritmo", color: "text-success", fondo: "bg-success/10", barra: "bg-success" },
  amarillo: { texto: "Algo atrasada", plural: "algo atrasadas", color: "text-warning", fondo: "bg-warning/10", barra: "bg-warning" },
  rojo: { texto: "Atrasada", plural: "atrasadas", color: "text-destructive", fondo: "bg-destructive/10", barra: "bg-destructive" },
};

function semaforoDe(valor: number | null): Semaforo | null {
  if (valor == null) return null;
  return valor >= 1 ? "verde" : valor >= 0.8 ? "amarillo" : "rojo";
}

function colorDe(semaforo: Semaforo | null) {
  return semaforo ? SEMAFORO[semaforo].color : "text-muted-foreground";
}

function Estado({ semaforo }: { semaforo: Semaforo | null }) {
  if (!semaforo) return <span className="text-sm text-muted-foreground">sin meta</span>;
  const { texto, color, fondo } = SEMAFORO[semaforo];
  return (
    <span className={cn("inline-flex rounded-full px-2.5 py-0.5 text-sm font-semibold whitespace-nowrap", color, fondo)}>
      {texto}
    </span>
  );
}

/** Lo vendido contra la meta, con una marca donde debería ir (el phasing):
 * si la barra no llega a la marca, la ruta va atrasada. */
function BarraTendencia({ tendencia, phasing, semaforo }: { tendencia: number | null; phasing: number | null; semaforo: Semaforo | null }) {
  if (tendencia == null) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex items-center justify-end gap-2">
      <span className={cn("font-semibold tabular-nums", colorDe(semaforo))}>{formatPct(tendencia, 0)}</span>
      <span className="relative hidden h-2 w-20 overflow-hidden rounded-full bg-muted sm:block" aria-hidden>
        <span
          className={cn("absolute inset-y-0 left-0 rounded-full", semaforo ? SEMAFORO[semaforo].barra : "bg-muted-foreground")}
          style={{ width: `${Math.min(tendencia, 1) * 100}%` }}
        />
        {phasing != null && (
          <span className="absolute inset-y-0 w-0.5 bg-foreground/70" style={{ left: `calc(${Math.min(phasing, 1) * 100}% - 1px)` }} />
        )}
      </span>
    </div>
  );
}

function Dato({ etiqueta, valor, detalle }: { etiqueta: string; valor: string; detalle?: string }) {
  return (
    <div className="rounded-lg border border-border px-4 py-3">
      <p className="text-sm text-muted-foreground">{etiqueta}</p>
      <p className="text-2xl font-semibold tabular-nums lg:text-3xl">{valor}</p>
      {detalle && <p className="text-xs text-muted-foreground">{detalle}</p>}
    </div>
  );
}

function Fila({ fila, total = false, cuadro }: { fila: FilaCuadroMetas; total?: boolean; cuadro: CuadroMetas }) {
  // Lo que la ruta vende hoy por día (proyección ÷ días del mes = vendido ÷
  // días transcurridos), para comparar con lo que necesita.
  const ritmo = fila.proyeccion != null && cuadro.diasVenta ? fila.proyeccion / cuadro.diasVenta : null;
  const cumplida = fila.faltante != null && fila.faltante <= 0;
  const acelerar = !cumplida && fila.necesidad != null && ritmo != null && fila.necesidad > ritmo;
  // Con pocos días la proyección todavía no dice mucho: va sin color.
  const colorProyeccion = cuadro.proyeccionConfiable ? colorDe(semaforoDe(fila.variacion)) : "text-muted-foreground";
  const numero = cn("text-right tabular-nums", total && "font-semibold");
  return (
    <TableRow className={cn(total && "border-t-2 bg-muted/40 text-base hover:bg-muted/40 lg:text-lg")}>
      <TableCell className={cn("relative pl-4 font-medium", total && "font-semibold")}>
        {/* Franja con el estado de la ruta, para leer la tabla de un vistazo. */}
        <span
          className={cn("absolute inset-y-1.5 left-0 w-1 rounded-full", fila.semaforo ? SEMAFORO[fila.semaforo].barra : "bg-border")}
          aria-hidden
        />
        {fila.ruta}
      </TableCell>
      <TableCell className={cn(numero, "font-medium")}>{formatNumero(fila.litros, 1)}</TableCell>
      <TableCell className={cn(numero, "text-muted-foreground")}>{formatNumero(fila.meta, 0)}</TableCell>
      <TableCell className={numero}>
        <BarraTendencia tendencia={fila.tendencia} phasing={cuadro.phasing} semaforo={fila.semaforo} />
      </TableCell>
      <TableCell className={numero}>
        {cumplida ? (
          <span className="font-semibold text-success">+{formatNumero(-fila.faltante!, 1)} sobre la meta</span>
        ) : (
          formatNumero(fila.faltante, 1)
        )}
      </TableCell>
      <TableCell className={cn(numero, "text-muted-foreground")}>{formatNumero(ritmo, 1)}</TableCell>
      <TableCell className={numero}>
        {cumplida ? (
          <span className="font-semibold text-success">cumplida</span>
        ) : (
          <span
            className={cn("font-semibold", acelerar ? "text-destructive" : fila.necesidad != null ? "text-success" : "")}
            title={
              acelerar && ritmo
                ? fila.necesidad! / ritmo < 1.1
                  ? "Tiene que vender un poco más que su ritmo actual"
                  : `Tiene que vender ${formatNumero(fila.necesidad! / ritmo, 1)} veces su ritmo actual`
                : undefined
            }
          >
            {formatNumero(fila.necesidad, 1)}
          </span>
        )}
      </TableCell>
      <TableCell className={cn(numero, "font-semibold", colorProyeccion)}>{formatNumero(fila.proyeccion, 0)}</TableCell>
      <TableCell className={cn(numero, "font-semibold", colorProyeccion)}>{formatPct(fila.variacion, 0)}</TableCell>
      <TableCell>
        <Estado semaforo={fila.semaforo} />
      </TableCell>
    </TableRow>
  );
}

/** El cuadro de metas en litros vendidos que el cliente llevaba en Excel,
 * calculado con las ventas cargadas (ver backend/app/services/cuadro_metas.py).
 * Va por el mes de la fecha «hasta» del período elegido, con todas las
 * rutas: los demás filtros no aplican. */
export function CuadroMetasLitros({ cuadro }: { cuadro: CuadroMetas }) {
  const sinMetas = cuadro.filas.every((f) => f.meta == null);
  const conteo = (["verde", "amarillo", "rojo"] as Semaforo[])
    .map((s) => ({ s, n: cuadro.filas.filter((f) => f.semaforo === s).length }))
    .filter((c) => c.n > 0);
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <CardTitle className="text-lg lg:text-xl">Metas en litros vendidos · {formatMes(cuadro.mes)}</CardTitle>
          <CardDescription>
            Por ruta, los litros vendidos en el mes contra su meta, pizzas incluidas. Los días cuentan hasta la última
            venta cargada
            {cuadro.ventasHasta ? ` (${formatDiaCorto(cuadro.ventasHasta)})` : ""}.
          </CardDescription>
        </div>
        <FeriadosDialog anioInicial={Number(cuadro.mes.slice(0, 4))} />
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Dato etiqueta="Días de venta del mes" valor={formatNumero(cuadro.diasVenta)} detalle="lunes a viernes, sin feriados" />
          <Dato etiqueta="Días transcurridos" valor={formatNumero(cuadro.diasTranscurridos)} />
          <Dato etiqueta="Días restantes" valor={formatNumero(cuadro.diasRestantes)} />
          <Dato etiqueta="Phasing" valor={formatPct(cuadro.phasing, 0)} detalle="lo que ya debería estar vendido" />
        </div>

        {conteo.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            {conteo.map(({ s, n }) => (
              <span
                key={s}
                className={cn("inline-flex rounded-full px-3 py-1 text-sm font-semibold", SEMAFORO[s].color, SEMAFORO[s].fondo)}
              >
                {n} {n === 1 ? SEMAFORO[s].texto.toLowerCase() : SEMAFORO[s].plural}
              </span>
            ))}
            <span className="text-sm text-muted-foreground">
              Verde: igual o mejor que el phasing · Amarillo: desde el 80 % de él · Rojo: por debajo
            </span>
          </div>
        )}

        {cuadro.feriados.length > 0 && (
          <p className="text-sm text-muted-foreground">
            Feriados este mes: {cuadro.feriados.map((f) => `${formatDiaCorto(f.fecha)} ${f.nombre}`).join(", ")}.
          </p>
        )}
        {!cuadro.proyeccionConfiable && cuadro.diasTranscurridos > 0 && (
          <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
            <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
            Con {cuadro.diasTranscurridos} día(s) de venta la proyección todavía es poco confiable: un solo día bueno o
            malo la mueve mucho, por eso va sin color.
          </p>
        )}
        {sinMetas && (
          <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
            <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
            Este mes todavía no tiene metas en litros: cárgalas en «Metas de venta», en «Litros vendidos».
          </p>
        )}

        {cuadro.filas.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No hay ventas ni metas este mes.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table className="text-sm lg:text-base">
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Ruta</TableHead>
                  <TableHead className="text-right">Litros vendidos</TableHead>
                  <TableHead className="text-right">Meta</TableHead>
                  <TableHead className="text-right">Tendencia</TableHead>
                  <TableHead className="text-right">Faltan (L)</TableHead>
                  <TableHead className="text-right" title="Lo que vende hoy por día: vendido ÷ días transcurridos">
                    Ritmo actual (L/día)
                  </TableHead>
                  <TableHead className="text-right" title="Lo que tiene que vender por día para llegar a la meta">
                    Necesidad (L/día)
                  </TableHead>
                  <TableHead className="text-right">Proyección</TableHead>
                  <TableHead className="text-right">Variación</TableHead>
                  <TableHead>Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cuadro.filas.map((fila) => (
                  <Fila key={fila.ruta} fila={fila} cuadro={cuadro} />
                ))}
                <Fila fila={cuadro.total} total cuadro={cuadro} />
              </TableBody>
            </Table>
          </div>
        )}
        <p className="text-sm text-muted-foreground">
          La marca en la barra de tendencia es el phasing: si la barra no llega, la ruta va atrasada. La necesidad sale
          en rojo cuando es mayor que el ritmo actual (hay que acelerar) y en verde cuando el ritmo alcanza.
          {(cuadro.total.litrosSinMeta ?? 0) > 0 &&
            !sinMetas &&
            ` ${formatNumero(cuadro.total.litrosSinMeta, 1)} L son de rutas sin meta: suman en los litros del total, pero no en su tendencia ni en su proyección.`}
        </p>
      </CardContent>
    </Card>
  );
}
