"use client";

import { useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AlertTriangleIcon, UploadIcon } from "lucide-react";
import { toast } from "sonner";
import { ApiError, apiDelete, apiPost, apiPostForm, mensajeDeError } from "@/lib/api-client";
import { ErroresFilaList } from "@/components/shared/errores-fila-list";
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
import { formatNumero } from "@/lib/constants";
import {
  EMPRESAS,
  esColumnasFaltantes,
  type CargaVenta,
  type ColumnasFaltantes,
  type Empresa,
  type PreviewCarga,
} from "@/lib/indicadores";
import { TablaColumnas } from "@/components/shared/tabla-columnas";
import { ResumenValidacion } from "./resumen-validacion";

// Límite de Vercel por request (el backend valida lo mismo). Revisarlo
// antes de subir ahorra esperar la subida entera para enterarse.
const TAMANO_MAXIMO_BYTES = 4_500_000;

/** Carga de un extracto de ventas en dos pasos: analizar (se ve la
 * validación, nada cuenta todavía) y confirmar. Cerrar sin confirmar
 * descarta lo analizado. */
export function CargarVentasDialog({ empresa: empresaInicial }: { empresa: Empresa }) {
  const router = useRouter();
  const pathname = usePathname();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [empresa, setEmpresa] = useState<Empresa>(empresaInicial);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [analizando, setAnalizando] = useState(false);
  const [resultado, setResultado] = useState<PreviewCarga | null>(null);
  const [procesando, setProcesando] = useState(false);
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  // Archivo sin encabezado al que le falta una columna: no es un fallo de la
  // carga, es un dato que el archivo no trae. Se muestra aparte y claro.
  const [faltantes, setFaltantes] = useState<ColumnasFaltantes | null>(null);

  const pendiente = resultado?.carga?.estado === "PENDIENTE" ? resultado.carga : null;

  async function descartarPendiente() {
    if (!pendiente) return;
    try {
      await apiDelete(`/indicadores/cargas/${pendiente.id}`);
    } catch {
      // Si falla, la carga pendiente se limpia sola a las 24 h.
    }
  }

  function limpiarArchivo() {
    setArchivo(null);
    setResultado(null);
    setErrorGeneral(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function analizar() {
    if (!archivo) return;
    setErrorGeneral(null);
    setFaltantes(null);
    if (archivo.size > TAMANO_MAXIMO_BYTES) {
      setErrorGeneral(
        `El archivo pesa ${formatNumero(archivo.size / 1_000_000, 1)} MB y el máximo es 4,5 MB. Sube un libro solo con la hoja de ventas («data») y la de costos («precio de compras»), sin las tablas dinámicas.`
      );
      return;
    }
    setAnalizando(true);
    await descartarPendiente();
    setResultado(null);
    try {
      const formData = new FormData();
      formData.append("empresa", empresa);
      formData.append("archivo", archivo);
      setResultado(await apiPostForm<PreviewCarga>("/indicadores/cargas/preview", formData));
    } catch (err) {
      if (err instanceof ApiError && esColumnasFaltantes(err.datos)) {
        setFaltantes(err.datos);
        toast.warning("Al archivo le falta una columna", { description: err.datos.columnasFaltantes.join(", ") });
      } else {
        const motivo = mensajeDeError(err, "No se pudo analizar el archivo");
        setErrorGeneral(motivo);
        toast.error("No se pudo analizar el archivo", { description: motivo });
      }
    } finally {
      setAnalizando(false);
    }
  }

  async function confirmar() {
    if (!pendiente) return;
    setProcesando(true);
    try {
      const carga = await apiPost<CargaVenta & { filasReemplazadas: number }>(
        `/indicadores/cargas/${pendiente.id}/confirmar`
      );
      toast.success(`Carga confirmada: ${formatNumero(carga.filas)} filas`, {
        description:
          carga.filasReemplazadas > 0
            ? `Reemplazó ${formatNumero(carga.filasReemplazadas)} filas de cargas anteriores en los días que trae el archivo.`
            : undefined,
      });
      setResultado(null);
      setOpen(false);
      limpiarArchivo();
      // La página vuelve a calcular con la carga nueva; si era de la otra
      // empresa, se pasa a esa.
      if (empresa !== empresaInicial) router.push(`${pathname}?empresa=${empresa}`);
      else router.refresh();
    } catch (err) {
      const motivo = mensajeDeError(err, "No se pudo confirmar la carga");
      setErrorGeneral(motivo);
      toast.error("No se pudo confirmar la carga", { description: motivo });
    } finally {
      setProcesando(false);
    }
  }

  async function descartar() {
    setProcesando(true);
    await descartarPendiente();
    setProcesando(false);
    toast.info("Carga descartada");
    limpiarArchivo();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v && pendiente) {
          void descartarPendiente();
          toast.info("La carga analizada se descartó: no se confirmó");
        }
        if (!v) limpiarArchivo();
        setOpen(v);
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <UploadIcon />
          Cargar ventas
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Cargar ventas</DialogTitle>
          <DialogDescription>
            El extracto del sistema de ventas tal como sale, con o sin encabezado y en cualquier orden de columnas: sin
            encabezado, cada columna se reconoce por su contenido. Tiene que traer todas las columnas obligatorias,
            incluido el tipo de cliente; el costo va en la hoja «precio de compras». Primero se valida; las cifras cuentan
            recién al confirmar. Cada carga reemplaza solo los días que trae: para agregar meses no hace falta volver a subir los que ya están.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="empresa-ventas">Empresa</Label>
            <Select
              value={empresa}
              disabled={analizando || procesando}
              onValueChange={(v) => {
                void descartarPendiente();
                setEmpresa(v as Empresa);
                setResultado(null);
              }}
            >
              <SelectTrigger id="empresa-ventas" className="w-full">
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
            <Label htmlFor="archivo-ventas">Archivo (.xlsx)</Label>
            <input
              ref={fileInputRef}
              id="archivo-ventas"
              type="file"
              accept=".xlsx"
              disabled={analizando || procesando}
              onChange={(e) => {
                void descartarPendiente();
                setArchivo(e.target.files?.[0] ?? null);
                setResultado(null);
                setErrorGeneral(null);
                setFaltantes(null);
              }}
              className="flex h-8 w-full rounded-lg border border-input bg-transparent text-sm file:mr-2 file:h-8 file:border-0 file:bg-muted file:px-2.5 file:text-sm file:font-medium disabled:opacity-50"
            />
          </div>
        </div>

        <Button className="w-fit" onClick={analizar} disabled={!archivo || analizando || procesando}>
          <UploadIcon />
          {analizando ? "Analizando..." : "Analizar archivo"}
        </Button>

        {errorGeneral && (
          <p className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
            <span>{errorGeneral}</span>
          </p>
        )}

        {faltantes && (
          <div className="flex items-start gap-2.5 rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm">
            <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-warning" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <p className="font-medium text-foreground">
                {faltantes.columnasFaltantes.length === 1
                  ? `Falta la columna «${faltantes.columnasFaltantes[0]}»`
                  : `Faltan ${faltantes.columnasFaltantes.length} columnas: ${faltantes.columnasFaltantes.join(", ")}`}
              </p>
              <p className="text-muted-foreground">
                El archivo no se cargó.{" "}
                {faltantes.columnasReconocidas.length > 0 &&
                  `Las otras ${formatNumero(faltantes.columnasReconocidas.length)} columnas obligatorias sí se reconocieron. `}
                Agrega la que falta, en cualquier posición, y vuelve a subirlo.
                {faltantes.columnasFaltantes.includes("tipo de cliente") &&
                  " Valores del tipo de cliente: TRADICIONAL, MODERNO o DISTRIBUIDORES."}
              </p>
              {faltantes.columnasReconocidas.length > 0 && (
                <details className="text-xs text-muted-foreground">
                  <summary className="cursor-pointer select-none hover:text-foreground">
                    Ver las columnas que se reconocieron
                  </summary>
                  <div className="mt-2">
                    <TablaColumnas columnas={faltantes.columnasReconocidas} />
                  </div>
                </details>
              )}
            </div>
          </div>
        )}

        {resultado && resultado.totalErrores > 0 && (
          <div className="space-y-2 border-t border-border pt-4">
            <p className="text-sm text-muted-foreground">
              El archivo tiene {formatNumero(resultado.totalErrores)} fila(s) que no se pueden leer. No se guardó nada:
              corrígelas en el Excel y vuelve a subirlo.
            </p>
            <ErroresFilaList errores={resultado.errores} />
          </div>
        )}

        {resultado?.resumen && (
          <div className="border-t border-border pt-4">
            <ResumenValidacion resumen={resultado.resumen} />
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={descartar} disabled={!pendiente || procesando}>
            Descartar
          </Button>
          <Button onClick={confirmar} disabled={!pendiente || procesando}>
            {procesando ? "Confirmando..." : "Confirmar carga"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
