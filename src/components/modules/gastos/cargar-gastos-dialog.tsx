"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangleIcon, UploadIcon } from "lucide-react";
import { toast } from "sonner";
import { apiPostForm, mensajeDeError } from "@/lib/api-client";
import { Chequeo } from "@/components/modules/indicadores/resumen-validacion";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatNumero, formatUsd } from "@/lib/constants";
import { formatFecha, formatMesCorto, type Empresa } from "@/lib/indicadores";
import type { GastosCargados, PreviewGastos } from "@/lib/gastos";

// Límite de Vercel por request (el backend valida lo mismo).
const TAMANO_MAXIMO_BYTES = 4_500_000;
const SEGUN_EXCEL = "EXCEL";

const NOMBRE_COLUMNA: Record<string, string> = {
  fecha: "Fecha",
  empresa: "Empresa",
  categoria: "Categoría",
  descripcion: "Descripción",
  proveedor: "Proveedor",
  referencia: "Referencia",
  monto_usd: "Monto USD",
  monto_bs: "Monto Bs",
  monto: "Monto",
  moneda: "Moneda",
  tasa: "Tasa",
};

/** Como las cargas de ventas: primero se ve qué se cargaría y recién al
 * confirmar se guarda. */
export function CargarGastosDialog({ empresaInicial }: { empresaInicial?: Empresa }) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [empresa, setEmpresa] = useState<string>(empresaInicial ?? SEGUN_EXCEL);
  const [moneda, setMoneda] = useState<"USD" | "BS">("USD");
  const [archivo, setArchivo] = useState<File | null>(null);
  const [analizando, setAnalizando] = useState(false);
  const [resultado, setResultado] = useState<PreviewGastos | null>(null);
  const [omitirDuplicados, setOmitirDuplicados] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);

  function limpiar() {
    setArchivo(null);
    setResultado(null);
    setErrorGeneral(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function formulario() {
    const formData = new FormData();
    if (empresa !== SEGUN_EXCEL) formData.append("empresa", empresa);
    formData.append("moneda", moneda);
    formData.append("omitirDuplicados", String(omitirDuplicados));
    if (archivo) formData.append("archivo", archivo);
    return formData;
  }

  async function analizar() {
    if (!archivo) return;
    setErrorGeneral(null);
    setResultado(null);
    if (archivo.size > TAMANO_MAXIMO_BYTES) {
      setErrorGeneral(`El archivo pesa ${formatNumero(archivo.size / 1_000_000, 1)} MB y el máximo es 4,5 MB.`);
      return;
    }
    setAnalizando(true);
    try {
      setResultado(await apiPostForm<PreviewGastos>("/gastos/cargas/preview", formulario()));
    } catch (err) {
      const motivo = mensajeDeError(err, "No se pudo analizar el archivo");
      setErrorGeneral(motivo);
      toast.error("No se pudo analizar el archivo", { description: motivo });
    } finally {
      setAnalizando(false);
    }
  }

  async function guardar() {
    if (!resultado) return;
    setGuardando(true);
    try {
      const r = await apiPostForm<GastosCargados>("/gastos/cargas", formulario());
      const filas = r.cargas.reduce((s, c) => s + c.filas, 0);
      const total = r.cargas.reduce((s, c) => s + c.totalUsd, 0);
      toast.success(`${formatNumero(filas)} gasto(s) cargados por ${formatUsd(total, 2)}`, {
        description: r.omitidos > 0 ? `${formatNumero(r.omitidos)} repetido(s) no se cargaron.` : undefined,
      });
      setOpen(false);
      limpiar();
      router.refresh();
    } catch (err) {
      const motivo = mensajeDeError(err, "No se pudieron cargar los gastos");
      setErrorGeneral(motivo);
      toast.error("No se pudieron cargar los gastos", { description: motivo });
    } finally {
      setGuardando(false);
    }
  }

  const r = resultado;
  const ocupado = analizando || guardando;
  const filas = r ? r.empresas.reduce((s, e) => s + e.filas, 0) : 0;
  const aCargar = filas - (r && omitirDuplicados ? r.duplicados.length : 0);

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) limpiar();
        setOpen(v);
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <UploadIcon />
          Cargar gastos
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Cargar gastos</DialogTitle>
          <DialogDescription>
            Un Excel con una fila por gasto. Hace falta la fecha y el monto (en dólares, en bolívares o «Monto» con su
            moneda); si trae categoría, descripción, proveedor o referencia, se guardan también. Lo que viene en
            bolívares se pasa a dólares con la tasa del archivo o, si no la trae, con la tasa BCV de ese día.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="empresa-gastos">Empresa</Label>
            <Select
              value={empresa}
              disabled={ocupado}
              onValueChange={(v) => {
                setEmpresa(v);
                setResultado(null);
              }}
            >
              <SelectTrigger id="empresa-gastos" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SEGUN_EXCEL}>La que diga el Excel</SelectItem>
                <SelectItem value="ISVAN">ISVAN</SelectItem>
                <SelectItem value="TRALOG">TRALOG</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="moneda-gastos">Moneda de «Monto»</Label>
            <Select
              value={moneda}
              disabled={ocupado}
              onValueChange={(v) => {
                setMoneda(v as "USD" | "BS");
                setResultado(null);
              }}
            >
              <SelectTrigger id="moneda-gastos" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="USD">Dólares</SelectItem>
                <SelectItem value="BS">Bolívares</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="archivo-gastos">Archivo (.xlsx)</Label>
            <input
              ref={fileInputRef}
              id="archivo-gastos"
              type="file"
              accept=".xlsx"
              disabled={ocupado}
              onChange={(e) => {
                setArchivo(e.target.files?.[0] ?? null);
                setResultado(null);
                setErrorGeneral(null);
              }}
              className="flex h-8 w-full rounded-lg border border-input bg-transparent text-sm file:mr-2 file:h-8 file:border-0 file:bg-muted file:px-2.5 file:text-sm file:font-medium disabled:opacity-50"
            />
          </div>
        </div>
        <p className="-mt-1 text-xs text-muted-foreground">
          «Empresa» se usa si el archivo no trae esa columna. «Moneda» solo aplica a una columna «Monto» sin moneda en
          la fila.
        </p>

        <Button className="w-fit" onClick={analizar} disabled={!archivo || ocupado}>
          <UploadIcon />
          {analizando ? "Analizando..." : "Analizar archivo"}
        </Button>

        {errorGeneral && (
          <p className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
            <span>{errorGeneral}</span>
          </p>
        )}

        {r && (
          <ul className="max-h-[50vh] space-y-2 overflow-y-auto border-t border-border pt-4">
            <Chequeo nivel={filas > 0 ? "ok" : "aviso"} titulo={`${formatNumero(filas)} gasto(s) en el archivo`}>
              <p>
                Columnas reconocidas:{" "}
                {Object.entries(r.columnas)
                  .map(([campo, encabezado]) => `${NOMBRE_COLUMNA[campo] ?? campo} («${encabezado}»)`)
                  .join(", ")}
                .
              </p>
              {r.enBs > 0 && <p>{formatNumero(r.enBs)} vienen en bolívares y se pasan a dólares.</p>}
            </Chequeo>

            {r.empresas.map((e) => (
              <Chequeo
                key={e.empresa}
                nivel="info"
                titulo={`${e.empresa}: ${formatNumero(e.filas)} gasto(s) por ${formatUsd(e.totalUsd, 2)}, del ${formatFecha(e.desde)} al ${formatFecha(e.hasta)}`}
              >
                <div className="grid gap-3 sm:grid-cols-2">
                  <table className="w-full text-left tabular-nums">
                    <tbody>
                      {e.porCategoria.map((c) => (
                        <tr key={c.categoria}>
                          <td className="pr-3">{c.categoria}</td>
                          <td className="text-right">{formatUsd(c.totalUsd, 2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <table className="w-full text-left tabular-nums">
                    <tbody>
                      {e.porMes.map((m) => (
                        <tr key={m.mes}>
                          <td className="pr-3 capitalize">{formatMesCorto(`${m.mes}-01`)}</td>
                          <td className="text-right">{formatUsd(m.totalUsd, 2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Chequeo>
            ))}

            {r.duplicados.length > 0 && (
              <Chequeo nivel="aviso" titulo={`${formatNumero(r.duplicados.length)} gasto(s) parecen ya cargados`}>
                <p>
                  Misma empresa, fecha, categoría y monto que uno ya guardado (filas{" "}
                  {r.duplicados.slice(0, 20).join(", ")}
                  {r.duplicados.length > 20 && "…"}).
                </p>
                <div className="flex items-center gap-2 pt-1">
                  <Checkbox
                    id="omitir-duplicados"
                    checked={omitirDuplicados}
                    onCheckedChange={(v) => setOmitirDuplicados(v === true)}
                  />
                  <Label htmlFor="omitir-duplicados" className="text-xs font-normal">
                    No cargar los repetidos
                  </Label>
                </div>
              </Chequeo>
            )}

            {r.problemas.length > 0 && (
              <Chequeo nivel="aviso" titulo={`${formatNumero(r.problemas.length)} fila(s) no se cargan`}>
                {r.problemas.slice(0, 30).map((p) => (
                  <p key={p.fila}>
                    Fila {p.fila}: {p.motivo}.
                  </p>
                ))}
                {r.problemas.length > 30 && <p>y {formatNumero(r.problemas.length - 30)} más.</p>}
              </Chequeo>
            )}
          </ul>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              limpiar();
              setOpen(false);
            }}
            disabled={guardando}
          >
            Cancelar
          </Button>
          <Button onClick={guardar} disabled={!r || aCargar <= 0 || ocupado}>
            {guardando ? "Cargando..." : `Cargar ${formatNumero(Math.max(aCargar, 0))} gasto(s)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
