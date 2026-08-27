"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangleIcon, CheckCircle2Icon, UploadIcon } from "lucide-react";
import { toast } from "sonner";
import { apiPost, apiPostForm } from "@/lib/api-client";
import { NumberedCard } from "@/components/shared/numbered-card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Almacen, Despacho, Empresa } from "@/lib/mock-data";

type ItemPreview = { descripcion: string; cantidad: number; pesoUnitarioKg: number; requiereFrio: boolean };
type GrupoPreview = {
  numeroDocumento: string;
  clienteId: string;
  clienteCodigo: string;
  clienteNombre: string;
  items: ItemPreview[];
};
type ErrorFila = { fila: number; columna?: string | null; motivo: string };
type PreviewResponse = { grupos: GrupoPreview[]; errores: ErrorFila[] };

export function ExcelImportPanel({ origen, creadoPorId }: { origen: Almacen; creadoPorId: string }) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [empresa, setEmpresa] = useState<Empresa | "">("");
  const [archivo, setArchivo] = useState<File | null>(null);
  const [analizando, setAnalizando] = useState(false);
  const [resultado, setResultado] = useState<PreviewResponse | null>(null);
  const [confirmando, setConfirmando] = useState(false);

  function reiniciar() {
    setArchivo(null);
    setResultado(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function analizar() {
    if (!empresa || !archivo) return;
    setAnalizando(true);
    setResultado(null);
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
      toast.error("No se pudo analizar el archivo", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setAnalizando(false);
    }
  }

  async function confirmar() {
    if (!resultado || resultado.grupos.length === 0) return;
    setConfirmando(true);
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
      toast.error("No se pudo confirmar la importación", {
        description: err instanceof Error ? err.message : undefined,
      });
      setConfirmando(false);
    }
  }

  return (
    <NumberedCard
      number={1}
      title="Importar Excel del día"
      helpText='Cada fila del Excel es un producto. El número de documento (factura/nota de entrega) agrupa las filas en un despacho por cliente — no el código de cliente, que se repite cuando un pedido tiene varios productos.'
    >
      <div className="space-y-4">
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

        {resultado && (
          <div className="space-y-4 border-t border-border pt-4">
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
                        <TableCell className="text-right">{g.items.length}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            {resultado.errores.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-sm font-medium text-foreground">Filas con error (no se importan):</p>
                <ul className="space-y-1 text-xs text-muted-foreground">
                  {resultado.errores.map((e, i) => (
                    <li key={i}>
                      Fila {e.fila}
                      {e.columna ? ` (${e.columna})` : ""}: {e.motivo}
                    </li>
                  ))}
                </ul>
              </div>
            )}

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
