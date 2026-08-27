"use client";

import { useRef, useState } from "react";
import { AlertTriangleIcon, CheckCircle2Icon, DownloadIcon, UploadIcon } from "lucide-react";
import { toast } from "sonner";
import { API_URL, apiPost, apiPostForm } from "@/lib/api-client";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Cliente, Empresa } from "@/lib/mock-data";

type ClientePreview = {
  empresa: Empresa;
  codigo: string;
  nombre: string;
  tipo: string;
  direccion: string;
  ciudad: string;
  lat: number;
  lng: number;
  telefono: string;
  email?: string | null;
};
type ErrorFila = { fila: number; columna?: string | null; motivo: string };
type PreviewResponse = { clientes: ClientePreview[]; errores: ErrorFila[] };

export function ImportarClientesDialog({ onImportados }: { onImportados: (clientes: Cliente[]) => void }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [empresa, setEmpresa] = useState<Empresa | "">("");
  const [archivo, setArchivo] = useState<File | null>(null);
  const [analizando, setAnalizando] = useState(false);
  const [resultado, setResultado] = useState<PreviewResponse | null>(null);
  const [confirmando, setConfirmando] = useState(false);

  function reiniciarArchivo() {
    setArchivo(null);
    setResultado(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function reiniciarTodo() {
    setEmpresa("");
    reiniciarArchivo();
  }

  async function analizar() {
    if (!empresa || !archivo) return;
    setAnalizando(true);
    setResultado(null);
    try {
      const formData = new FormData();
      formData.append("empresa", empresa);
      formData.append("archivo", archivo);
      const data = await apiPostForm<PreviewResponse>("/clientes/importar/preview", formData);
      setResultado(data);
      if (data.clientes.length === 0 && data.errores.length === 0) {
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
    if (!resultado || resultado.clientes.length === 0) return;
    setConfirmando(true);
    try {
      const creados = await apiPost<Cliente[]>("/clientes/importar/confirmar", { clientes: resultado.clientes });
      onImportados(creados);
      toast.success(`${creados.length} cliente(s) creado(s)`);
      setOpen(false);
      reiniciarTodo();
    } catch (err) {
      toast.error("No se pudo confirmar la importación", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setConfirmando(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) reiniciarTodo();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">
          <UploadIcon />
          Importar Excel
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Importar clientes desde Excel</DialogTitle>
          <DialogDescription>
            Cada fila es un cliente. El código lo asignan ustedes — el archivo debe traerlo, nunca se genera acá.
            Código, nombre, tipo, dirección, ciudad, coordenadas y teléfono son obligatorios.
          </DialogDescription>
        </DialogHeader>

        <a
          href={`${API_URL}/clientes/importar/plantilla`}
          className="inline-flex w-fit items-center gap-1.5 text-sm text-primary hover:underline"
        >
          <DownloadIcon className="size-3.5" />
          Descargar plantilla (.xlsx)
        </a>

        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="empresa-clientes">¿De qué empresa son estos clientes?</Label>
              <Select
                value={empresa}
                onValueChange={(v) => {
                  setEmpresa(v as Empresa);
                  reiniciarArchivo();
                }}
              >
                <SelectTrigger id="empresa-clientes" className="w-full">
                  <SelectValue placeholder="ISVAN o TRALOG" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ISVAN">ISVAN</SelectItem>
                  <SelectItem value="TRALOG">TRALOG</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="archivo-clientes">Archivo (.xlsx)</Label>
              <input
                ref={fileInputRef}
                id="archivo-clientes"
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
            <div className="max-h-[22rem] space-y-4 overflow-y-auto border-t border-border pt-4">
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <span className="flex items-center gap-1.5 text-success">
                  <CheckCircle2Icon className="size-4" />
                  {resultado.clientes.length} cliente(s) listos para crear
                </span>
                {resultado.errores.length > 0 && (
                  <span className="flex items-center gap-1.5 text-destructive">
                    <AlertTriangleIcon className="size-4" />
                    {resultado.errores.length} fila(s) con error
                  </span>
                )}
              </div>

              {resultado.clientes.length > 0 && (
                <div className="overflow-hidden rounded-lg border border-border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Código</TableHead>
                        <TableHead>Nombre</TableHead>
                        <TableHead>Ciudad</TableHead>
                        <TableHead>Teléfono</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {resultado.clientes.map((c) => (
                        <TableRow key={c.codigo} className="hover:bg-transparent">
                          <TableCell className="font-medium">{c.codigo}</TableCell>
                          <TableCell>{c.nombre}</TableCell>
                          <TableCell className="text-muted-foreground">{c.ciudad}</TableCell>
                          <TableCell className="text-muted-foreground">{c.telefono}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              <ErroresFilaList errores={resultado.errores} />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={reiniciarArchivo} disabled={confirmando}>
            Elegir otro archivo
          </Button>
          <Button onClick={confirmar} disabled={!resultado || resultado.clientes.length === 0 || confirmando}>
            {confirmando ? "Confirmando..." : `Confirmar importación (${resultado?.clientes.length ?? 0})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
