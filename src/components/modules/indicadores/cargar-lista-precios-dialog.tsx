"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangleIcon, TagIcon, UploadIcon } from "lucide-react";
import { toast } from "sonner";
import { apiPostForm, mensajeDeError } from "@/lib/api-client";
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
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDateTime, formatNumero, formatPct, formatUsd } from "@/lib/constants";
import {
  EMPRESAS,
  type Empresa,
  type ListaPreciosAplicada,
  type PreviewListaPrecios,
} from "@/lib/indicadores";
import { cn } from "@/lib/utils";
import { Chequeo } from "./resumen-validacion";

// Límite de Vercel por request (el backend valida lo mismo).
const TAMANO_MAXIMO_BYTES = 4_500_000;
// Un costo que sube o baja más que esto respecto del que había se resalta:
// suele ser un error de la lista (costo por unidad en vez de por caja).
const SALTO_SOSPECHOSO = 0.5;

function costo(valor: number | null) {
  return valor == null ? "—" : formatUsd(valor, 2);
}

/** La lista de precios de compra (costo por caja) subida sola, sin un
 * extracto de ventas. Como las cargas: primero se ve qué cambia y recién
 * al aplicar se guarda. */
export function CargarListaPreciosDialog({ empresa: empresaInicial }: { empresa: Empresa }) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [empresa, setEmpresa] = useState<Empresa>(empresaInicial);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [analizando, setAnalizando] = useState(false);
  const [resultado, setResultado] = useState<PreviewListaPrecios | null>(null);
  const [aplicando, setAplicando] = useState(false);
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);

  function limpiar() {
    setArchivo(null);
    setResultado(null);
    setErrorGeneral(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function formulario() {
    const formData = new FormData();
    formData.append("empresa", empresa);
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
      setResultado(await apiPostForm<PreviewListaPrecios>("/indicadores/costos/preview", formulario()));
    } catch (err) {
      const motivo = mensajeDeError(err, "No se pudo analizar el archivo");
      setErrorGeneral(motivo);
      toast.error("No se pudo analizar el archivo", { description: motivo });
    } finally {
      setAnalizando(false);
    }
  }

  async function aplicar() {
    if (!resultado) return;
    setAplicando(true);
    try {
      const r = await apiPostForm<ListaPreciosAplicada>("/indicadores/costos", formulario());
      toast.success(`Lista de precios aplicada: ${formatNumero(r.productos)} productos`, {
        description: `${formatNumero(r.cambiaron)} cambiaron de costo, ${formatNumero(r.nuevos)} nuevos, ${formatNumero(r.sinCambio)} sin cambio.`,
      });
      setOpen(false);
      limpiar();
      router.refresh();
    } catch (err) {
      const motivo = mensajeDeError(err, "No se pudo aplicar la lista");
      setErrorGeneral(motivo);
      toast.error("No se pudo aplicar la lista", { description: motivo });
    } finally {
      setAplicando(false);
    }
  }

  const r = resultado;
  const saltos = r ? r.cambian.filter((c) => c.variacion != null && Math.abs(c.variacion) >= SALTO_SOSPECHOSO) : [];
  const sinCostoAntes = r ? r.cambian.filter((c) => c.costoAnterior == null).length : 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) limpiar();
        setOpen(v);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">
          <TagIcon />
          Lista de precios
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Cargar lista de precios</DialogTitle>
          <DialogDescription>
            La lista de precios de compra del proveedor, sin el extracto de ventas: una hoja con las columnas «Código» y
            «Pc» (costo por caja); si trae «Descripción» y «Grupo», se usan para los productos que todavía no aparecieron
            en ventas. Primero se ve qué cambia; el costo se guarda recién al aplicar. El costo no tiene fecha: el margen
            de todos los meses se recalcula con el nuevo.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="empresa-precios">Empresa</Label>
            <Select
              value={empresa}
              disabled={analizando || aplicando}
              onValueChange={(v) => {
                setEmpresa(v as Empresa);
                setResultado(null);
              }}
            >
              <SelectTrigger id="empresa-precios" className="w-full">
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
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="archivo-precios">Archivo (.xlsx)</Label>
            <input
              ref={fileInputRef}
              id="archivo-precios"
              type="file"
              accept=".xlsx"
              disabled={analizando || aplicando}
              onChange={(e) => {
                setArchivo(e.target.files?.[0] ?? null);
                setResultado(null);
                setErrorGeneral(null);
              }}
              className="flex h-8 w-full rounded-lg border border-input bg-transparent text-sm file:mr-2 file:h-8 file:border-0 file:bg-muted file:px-2.5 file:text-sm file:font-medium disabled:opacity-50"
            />
          </div>
        </div>

        <Button className="w-fit" onClick={analizar} disabled={!archivo || analizando || aplicando}>
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
          <ul className="max-h-[55vh] space-y-2 overflow-y-auto border-t border-border pt-4">
            <Chequeo
              nivel="info"
              titulo={`${formatNumero(r.productos)} productos en la hoja «${r.hoja}» de ${empresa}`}
            >
              <p>
                {formatNumero(r.cambian.length)} cambian de costo
                {sinCostoAntes > 0 && ` (${formatNumero(sinCostoAntes)} no tenían)`}, {formatNumero(r.nuevos.length)}{" "}
                todavía no aparecieron en ventas y {formatNumero(r.sinCambio)} quedan igual.
                {r.fueraDeLista > 0 &&
                  ` Otros ${formatNumero(r.fueraDeLista)} productos con costo no vienen en la lista: conservan el que tienen.`}
              </p>
              {r.ultimaLista && (
                <p>
                  Última lista aplicada: «{r.ultimaLista.archivo}», el {formatDateTime(r.ultimaLista.subidaEn)}
                  {r.ultimaLista.subidaPor && ` por ${r.ultimaLista.subidaPor}`}.
                </p>
              )}
            </Chequeo>

            {saltos.length > 0 && (
              <Chequeo
                nivel="aviso"
                titulo={`${formatNumero(saltos.length)} producto(s) cambian más de ${formatPct(SALTO_SOSPECHOSO, 0)} de costo`}
              >
                <p>Revisa que sean por caja y no por unidad: están resaltados en la tabla.</p>
              </Chequeo>
            )}

            {r.descartadas.length > 0 && (
              <Chequeo nivel="aviso" titulo={`${formatNumero(r.descartadas.length)} fila(s) no se usan`}>
                {r.descartadas.map((d) => (
                  <p key={d.fila}>
                    Fila {d.fila}, código {d.codigo}: {d.motivo}.
                  </p>
                ))}
              </Chequeo>
            )}

            {r.cambian.length > 0 && (
              <Chequeo nivel="info" titulo="Costos que cambian (USD por caja)">
                <div className="overflow-x-auto">
                  <table className="w-full text-left tabular-nums">
                    <thead>
                      <tr className="text-muted-foreground/80">
                        <th className="pr-3 font-normal">Código</th>
                        <th className="pr-3 font-normal">Producto</th>
                        <th className="pr-3 text-right font-normal">Antes</th>
                        <th className="pr-3 text-right font-normal">Ahora</th>
                        <th className="text-right font-normal">Cambio</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.cambian.map((c) => {
                        const salto = c.variacion != null && Math.abs(c.variacion) >= SALTO_SOSPECHOSO;
                        return (
                          <tr key={c.codigo} className={cn(salto && "font-medium text-warning")}>
                            <td className="pr-3">{c.codigo}</td>
                            <td className="pr-3">{c.nombre}</td>
                            <td className="pr-3 text-right">{costo(c.costoAnterior)}</td>
                            <td className="pr-3 text-right">{costo(c.costoNuevo)}</td>
                            <td className="text-right">
                              {c.variacion == null
                                ? "no tenía"
                                : `${c.variacion > 0 ? "+" : ""}${formatPct(c.variacion)}`}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Chequeo>
            )}

            {r.nuevos.length > 0 && (
              <Chequeo
                nivel="info"
                titulo={`${formatNumero(r.nuevos.length)} producto(s) que todavía no aparecieron en ventas`}
              >
                <p>
                  Se dan de alta con el nombre y el grupo de la lista y su costo queda listo para cuando se vendan. Si
                  ves aquí productos que ya se venden, el código de la lista no es el mismo que el del sistema de ventas.
                </p>
                <details>
                  <summary className="cursor-pointer select-none hover:text-foreground">Ver los productos</summary>
                  <table className="mt-2 w-full text-left tabular-nums">
                    <tbody>
                      {r.nuevos.map((n) => (
                        <tr key={n.codigo}>
                          <td className="pr-3">{n.codigo}</td>
                          <td className="pr-3">{n.nombre}</td>
                          <td className="pr-3">{n.grupo}</td>
                          <td className="text-right">{costo(n.costoNuevo)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              </Chequeo>
            )}

            {r.siguenSinCosto.length > 0 && (
              <Chequeo
                nivel="aviso"
                titulo={`${formatNumero(r.siguenSinCosto.length)} producto(s) vendidos siguen sin costo`}
              >
                <p>
                  No vienen en esta lista:{" "}
                  {r.siguenSinCosto
                    .slice(0, 8)
                    .map((p) => `${p.nombre} (${p.codigo})`)
                    .join(", ")}
                  {r.siguenSinCosto.length > 8 && ` y ${formatNumero(r.siguenSinCosto.length - 8)} más`}.
                </p>
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
            disabled={aplicando}
          >
            Cancelar
          </Button>
          <Button onClick={aplicar} disabled={!r || aplicando || analizando}>
            {aplicando ? "Aplicando..." : "Aplicar lista"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
