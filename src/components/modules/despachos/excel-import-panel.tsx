"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangleIcon, CheckCircle2Icon, DownloadIcon, UploadIcon } from "lucide-react";
import { toast } from "sonner";
import { API_URL, ApiError, apiPost, apiPostForm, mensajeDeError } from "@/lib/api-client";
import { ErroresFilaList } from "@/components/shared/errores-fila-list";
import { NumberedCard } from "@/components/shared/numbered-card";
import { TablaColumnas, type ColumnaLeida } from "@/components/shared/tabla-columnas";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { esColumnasFaltantes, type ColumnasFaltantes } from "@/lib/indicadores";
import type { Almacen, Despacho, Empresa } from "@/lib/mock-data";

type ItemPreview = { descripcion: string; cantidad: number; pesoUnitarioKg: number; requiereFrio: boolean };
type GrupoPreview = {
  numeroDocumento: string;
  clienteId: string;
  clienteCodigo: string;
  clienteNombre: string;
  /** Ruta comercial del cliente según el extracto de ventas (columna «ruta», opcional). */
  rutaComercial?: string | null;
  items: ItemPreview[];
};
type ErrorFila = { fila: number; columna?: string | null; motivo: string };
type PreviewResponse = {
  grupos: GrupoPreview[];
  errores: ErrorFila[];
  /** False si el archivo vino sin encabezado: las columnas se reconocieron por su contenido. */
  conEncabezado: boolean;
  columnas: ColumnaLeida[];
};

export function ExcelImportPanel({ origen, creadoPorId }: { origen: Almacen; creadoPorId: string }) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [empresa, setEmpresa] = useState<Empresa | "">("");
  const [archivo, setArchivo] = useState<File | null>(null);
  const [analizando, setAnalizando] = useState(false);
  const [resultado, setResultado] = useState<PreviewResponse | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  // Ver la nota en importar-clientes-dialog.tsx: los fallos que no son "fila
  // con error" se muestran fijos, no solo en un toast que se desvanece.
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  // Archivo sin encabezado al que le falta una columna: no es un fallo de
  // la carga, es un dato que el archivo no trae (ver cargar-ventas-dialog).
  const [faltantes, setFaltantes] = useState<ColumnasFaltantes | null>(null);

  function reiniciar() {
    setArchivo(null);
    setResultado(null);
    setErrorGeneral(null);
    setFaltantes(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function analizar() {
    if (!empresa || !archivo) return;
    setAnalizando(true);
    setResultado(null);
    setErrorGeneral(null);
    setFaltantes(null);
    try {
      const formData = new FormData();
      formData.append("empresa", empresa);
      formData.append("archivo", archivo);
      const data = await apiPostForm<PreviewResponse>("/despachos/importar/preview", formData);
      setResultado(data);
      if (data.grupos.length === 0 && data.errores.length === 0) {
        toast.info("El archivo no tiene filas para importar");
      }
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
    if (!resultado || resultado.grupos.length === 0) return;
    setConfirmando(true);
    setErrorGeneral(null);
    try {
      const creados = await apiPost<Despacho[]>("/despachos/importar/confirmar", {
        creadoPorId,
        grupos: resultado.grupos,
      });
      toast.success(`${creados.length} despacho(s) creado(s)`, {
        description: `Desde ${origen.nombre}, en estado "Pendiente de aprobación".`,
      });
      router.push("/despachos");
      router.refresh();
    } catch (err) {
      const motivo = mensajeDeError(err, "No se pudo confirmar la importación");
      setErrorGeneral(motivo);
      toast.error("No se pudo confirmar la importación", { description: motivo });
      setConfirmando(false);
    }
  }

  return (
    <NumberedCard
      number={1}
      title="Importar Excel del día"
      helpText='Cada fila del Excel es un producto. El número de documento (factura/nota de entrega) agrupa las filas en un despacho por cliente — no el código de cliente, que se repite cuando un pedido tiene varios productos. Si el archivo trae la columna «ruta», esa ruta comercial se guarda en la ficha del cliente y se usa después para sugerir cómo armar los viajes. El encabezado es opcional: el reporte que sale del sistema de ventas, sin encabezado y en cualquier orden de columnas, se lee igual porque cada columna se reconoce por su contenido.'
    >
      <div className="space-y-4">
        <a
          href={`${API_URL}/despachos/importar/plantilla`}
          className="inline-flex w-fit items-center gap-1.5 text-sm text-primary hover:underline"
        >
          <DownloadIcon className="size-3.5" />
          Descargar plantilla (.xlsx)
        </a>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="empresa">¿De qué empresa son estos despachos?</Label>
            <Select
              value={empresa}
              onValueChange={(v) => {
                setEmpresa(v as Empresa);
                reiniciar();
              }}
            >
              <SelectTrigger id="empresa" className="w-full">
                <SelectValue placeholder="ISVAN o TRALOG" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ISVAN">ISVAN</SelectItem>
                <SelectItem value="TRALOG">TRALOG</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="archivo">Archivo (.xlsx)</Label>
            <input
              ref={fileInputRef}
              id="archivo"
              type="file"
              accept=".xlsx"
              disabled={!empresa}
              onChange={(e) => {
                setArchivo(e.target.files?.[0] ?? null);
                setResultado(null);
              }}
              className="flex h-8 w-full rounded-lg border border-input bg-transparent text-sm file:mr-2 file:h-8 file:border-0 file:bg-muted file:px-2.5 file:text-sm file:font-medium disabled:opacity-50"
            />
          </div>
        </div>

        <Button onClick={analizar} disabled={!empresa || !archivo || analizando}>
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
                El archivo no se analizó. Para armar los despachos hacen falta el código de cliente, el número de
                documento, el producto, las unidades y los litros. Agrega la que falta, en cualquier posición, y vuelve
                a subirlo.
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

        {resultado && (
          <div className="space-y-4 border-t border-border pt-4">
            {!resultado.conEncabezado && resultado.columnas.length > 0 && (
              <div className="space-y-1.5 rounded-lg border border-border p-3">
                <p className="text-sm font-medium text-foreground">
                  El archivo no trae encabezado: así se reconoció cada columna
                </p>
                <p className="text-xs text-muted-foreground">
                  Revisa que los ejemplos correspondan a cada dato antes de confirmar. Las demás columnas del archivo no
                  se usan.
                </p>
                <TablaColumnas columnas={resultado.columnas} />
              </div>
            )}
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="flex items-center gap-1.5 text-success">
                <CheckCircle2Icon className="size-4" />
                {resultado.grupos.length} documento(s) listos para crear
              </span>
              {resultado.errores.length > 0 && (
                <span className="flex items-center gap-1.5 text-destructive">
                  <AlertTriangleIcon className="size-4" />
                  {resultado.errores.length} fila(s) con error
                </span>
              )}
            </div>

            {resultado.grupos.length > 0 && (
              <div className="overflow-hidden rounded-lg border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Documento</TableHead>
                      <TableHead>Cliente</TableHead>
                      <TableHead>Ruta</TableHead>
                      <TableHead className="text-right"># Items</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {resultado.grupos.map((g) => (
                      <TableRow key={g.numeroDocumento} className="hover:bg-transparent">
                        <TableCell className="font-medium">{g.numeroDocumento}</TableCell>
                        <TableCell>
                          {g.clienteCodigo} — {g.clienteNombre}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{g.rutaComercial ?? "—"}</TableCell>
                        <TableCell className="text-right">{g.items.length}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            <ErroresFilaList errores={resultado.errores} />

            <div className="flex items-center gap-2">
              <Button onClick={confirmar} disabled={resultado.grupos.length === 0 || confirmando}>
                {confirmando ? "Confirmando..." : `Confirmar importación (${resultado.grupos.length})`}
              </Button>
              <Button variant="outline" onClick={reiniciar} disabled={confirmando}>
                Elegir otro archivo
              </Button>
            </div>
          </div>
        )}
      </div>
    </NumberedCard>
  );
}
