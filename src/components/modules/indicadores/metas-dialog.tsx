"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeftIcon, ChevronRightIcon, CopyIcon, SparklesIcon, TargetIcon } from "lucide-react";
import { toast } from "sonner";
import { apiGet, apiPut, mensajeDeError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatUsd } from "@/lib/constants";
import { formatMes } from "@/lib/indicadores";
import { hoyCaracas, type BaseSugerencia, type Empresa, type MetasAnio, type SugerenciaMetas } from "@/lib/indicadores";

const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

/** "2026-08-01" para el mes 8 de 2026. */
function claveMes(anio: number, mes: number) {
  return `${anio}-${String(mes + 1).padStart(2, "0")}-01`;
}

/** Metas de venta por ruta y mes: un mes a la vez, que es como las maneja el
 * negocio. El total de la empresa es la suma de sus rutas, así que el
 * gráfico de proyección sigue valiendo al filtrar por ruta. */
export function MetasDialog({ empresa }: { empresa: Empresa }) {
  const router = useRouter();
  const hoy = hoyCaracas();
  const [open, setOpen] = useState(false);
  const [anio, setAnio] = useState(Number(hoy.slice(0, 4)));
  const [mes, setMes] = useState(Number(hoy.slice(5, 7)) - 1);
  const [datos, setDatos] = useState<MetasAnio | null>(null);
  const [montos, setMontos] = useState<Record<string, string>>({});
  const [guardando, setGuardando] = useState(false);
  const [base, setBase] = useState<BaseSugerencia>("ultimo");
  // Derivado, no un estado aparte: mientras lo que hay en memoria no sea del
  // año elegido, se está cargando.
  const cargando = !datos || datos.anio !== anio;

  // Se pide el año entero de una vez: son pocas filas y permite moverse
  // entre meses (y copiar el anterior) sin volver a la red.
  useEffect(() => {
    if (!open) return;
    let vigente = true;
    apiGet<MetasAnio>(`/indicadores/metas?empresa=${empresa}&anio=${anio}`)
      .then((r) => {
        if (!vigente) return;
        setDatos(r);
        // Se mezcla, no se reemplaza: así no se pierde lo que se haya escrito
        // en otro mes y todavía no se guarde.
        setMontos((previo) => ({
          ...previo,
          ...Object.fromEntries(r.metas.map((m) => [`${m.ruta}|${m.mes.slice(0, 10)}`, String(m.montoUsd)])),
        }));
      })
      .catch((e) =>
        toast.error("No se pudieron cargar las metas", { description: mensajeDeError(e, "Intenta de nuevo") })
      );
    return () => {
      vigente = false;
    };
  }, [open, empresa, anio]);

  const clave = claveMes(anio, mes);
  const rutas = datos?.rutas ?? [];
  const valorDe = (ruta: string, mesClave = clave) => montos[`${ruta}|${mesClave}`] ?? "";
  const total = rutas.reduce((suma, r) => suma + (Number(valorDe(r)) || 0), 0);

  function escribir(ruta: string, valor: string) {
    setMontos((previo) => ({ ...previo, [`${ruta}|${clave}`]: valor }));
  }

  function copiarDelMesAnterior() {
    const anterior = mes === 0 ? claveMes(anio - 1, 11) : claveMes(anio, mes - 1);
    // El mes anterior de otro año no está cargado en memoria: se avisa en vez
    // de copiar ceros en silencio.
    if (mes === 0) {
      toast.info("El mes anterior es de otro año", { description: "Cambia de año para verlo y vuelve a intentarlo." });
      return;
    }
    const copiados = Object.fromEntries(rutas.map((r) => [`${r}|${clave}`, valorDe(r, anterior)]));
    setMontos((previo) => ({ ...previo, ...copiados }));
    toast.success(`Copiado de ${MESES[mes - 1]}`);
  }

  /** Rellena la tabla con lo que ya vendió cada ruta. No guarda nada: el
   * cliente ajusta lo que quiera y después le da a Guardar.
   *
   * Cada mes se propone con los meses cerrados anteriores A ESE MES, así que
   * los meses no salen todos iguales ni un mes pico se vuelve la meta del
   * año. Los meses que aún no tienen nada cerrado por delante repiten la
   * última ventana disponible. */
  async function sugerir(alcance: "mes" | "anio") {
    try {
      const s = await apiGet<SugerenciaMetas>(
        `/indicadores/metas/sugerencia?empresa=${empresa}&anio=${anio}&base=${base}`
      );
      const aplicables = alcance === "mes" ? s.meses.filter((m) => m.mes.slice(0, 10) === clave) : s.meses;
      if (!aplicables.length) {
        toast.info(
          alcance === "mes"
            ? `No hay meses cerrados antes de ${MESES[mes]} para proponer nada`
            : "Todavía no hay meses cerrados con ventas para proponer nada"
        );
        return;
      }
      setMontos((previo) => ({
        ...previo,
        ...Object.fromEntries(
          aplicables.flatMap((m) =>
            m.rutas.map((r) => [`${r.ruta}|${m.mes.slice(0, 10)}`, String(Math.round(r.sugerido))])
          )
        ),
      }));
      const ventana = aplicables[aplicables.length - 1].ventana.map((v) => formatMes(v));
      const comoSale =
        base === "ultimo"
          ? `cada mes toma la venta del mes cerrado anterior`
          : `cada mes toma la media de los ${s.ventana} meses cerrados anteriores`;
      toast.success(
        alcance === "mes" ? `Propuesta cargada en ${MESES[mes]}` : `Propuesta cargada en ${aplicables.length} meses`,
        { description: `${comoSale} (el último, de ${ventana.join(", ")}). Ajusta lo que haga falta y guarda.` }
      );
    } catch (e) {
      toast.error("No se pudo calcular la propuesta", { description: mensajeDeError(e, "Intenta de nuevo") });
    }
  }

  /** Guarda el año completo, no solo el mes a la vista: la propuesta llena
   * varios meses de una vez y sería fácil perderlos al cambiar de mes. Lo
   * que no se tocó se reenvía igual al valor que ya tenía. */
  async function guardar() {
    setGuardando(true);
    try {
      const metas = MESES.flatMap((_, numero) =>
        rutas.map((ruta) => ({
          ruta,
          mes: claveMes(anio, numero),
          montoUsd: Number(valorDe(ruta, claveMes(anio, numero))) || 0,
        }))
      );
      const r = await apiPut<{ guardadas: number; borradas: number }>("/indicadores/metas", { empresa, metas });
      toast.success(`Metas de ${anio} guardadas`, {
        description: `${r.guardadas} meta(s) por ruta y mes${r.borradas ? `, ${r.borradas} borrada(s)` : ""}.`,
      });
      router.refresh();
    } catch (e) {
      toast.error("No se pudieron guardar las metas", { description: mensajeDeError(e, "Intenta de nuevo") });
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <TargetIcon />
          Metas de venta
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Metas de venta</DialogTitle>
          <DialogDescription>
            La meta de cada ruta para un mes, en USD; el total de la empresa es la suma de sus rutas. Se guarda el
            año completo, así que puedes ir mes por mes y guardar una sola vez. Dejar una ruta vacía o en 0 es no
            ponerle meta ese mes.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" onClick={() => setAnio(anio - 1)} aria-label="Año anterior">
              <ChevronLeftIcon />
            </Button>
            <span className="min-w-12 text-center text-sm font-medium tabular-nums">{anio}</span>
            <Button variant="ghost" size="icon" onClick={() => setAnio(anio + 1)} aria-label="Año siguiente">
              <ChevronRightIcon />
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="mes-meta" className="text-sm text-muted-foreground">
              Mes
            </Label>
            <select
              id="mes-meta"
              className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
              value={mes}
              onChange={(e) => setMes(Number(e.target.value))}
            >
              {MESES.map((nombre, i) => (
                <option key={nombre} value={i}>
                  {nombre}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="max-h-[50vh] overflow-y-auto [scrollbar-width:thin] [scrollbar-color:var(--muted-foreground)_transparent]">
          {cargando ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Cargando…</p>
          ) : rutas.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Esta empresa todavía no tiene rutas con ventas cargadas.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ruta</TableHead>
                  <TableHead className="text-right">Meta del mes (USD)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rutas.map((ruta) => (
                  <TableRow key={ruta}>
                    <TableCell className="font-medium">{ruta}</TableCell>
                    <TableCell className="text-right">
                      <Input
                        type="number"
                        min={0}
                        step={100}
                        inputMode="decimal"
                        className="ml-auto w-40 text-right tabular-nums"
                        value={valorDe(ruta)}
                        onChange={(e) => escribir(ruta, e.target.value)}
                        aria-label={`Meta de la ruta ${ruta}`}
                      />
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell className="font-medium">Total</TableCell>
                  <TableCell className="pr-3 text-right font-medium tabular-nums">{formatUsd(total)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3 text-sm">
          <span className="text-muted-foreground">Proponer con el histórico:</span>
          <select
            className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
            value={base}
            onChange={(e) => setBase(e.target.value as BaseSugerencia)}
            aria-label="Base de la propuesta"
          >
            <option value="media">Media de 3 meses</option>
            <option value="ultimo">Mes anterior</option>
          </select>
          <Button variant="outline" size="sm" onClick={() => sugerir("mes")} disabled={cargando || guardando || !rutas.length}>
            <SparklesIcon />
            {MESES[mes]}
          </Button>
          <Button variant="outline" size="sm" onClick={() => sugerir("anio")} disabled={cargando || guardando || !rutas.length}>
            <SparklesIcon />
            Todo {anio}
          </Button>
          <Button variant="ghost" size="sm" onClick={copiarDelMesAnterior} disabled={cargando || guardando || !rutas.length}>
            <CopyIcon />
            Copiar mes anterior
          </Button>
        </div>

        <DialogFooter>
          <Button onClick={guardar} disabled={cargando || guardando || !rutas.length}>
            {guardando ? "Guardando…" : `Guardar ${anio}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
