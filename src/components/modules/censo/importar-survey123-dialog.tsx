"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangleIcon, HistoryIcon, UploadIcon } from "lucide-react";
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
import { formatNumero } from "@/lib/constants";
import type { ResumenImportacion } from "@/lib/censo";

// El límite de Vercel por request. La exportación real pesa ~1 MB.
const TAMANO_MAXIMO_BYTES = 4_500_000;

function Cifra({ etiqueta, valor, pista }: { etiqueta: string; valor: number; pista?: string }) {
  return (
    <div className="rounded-lg border border-border px-3 py-2">
      <p className="text-xs text-muted-foreground">{etiqueta}</p>
      <p className="font-medium tabular-nums">{formatNumero(valor)}</p>
      {pista && <p className="text-xs text-muted-foreground">{pista}</p>}
    </div>
  );
}

/** Importa el histórico del censo hecho en Survey123. Primero una vista
 * previa con los números exactos (se importa en una transacción que se
 * deshace); después la importación. Reimportar es seguro: cada censo se
 * reconoce por su smid. */
export function ImportarSurvey123Dialog() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [analizando, setAnalizando] = useState(false);
  const [importando, setImportando] = useState(false);
  const [previa, setPrevia] = useState<ResumenImportacion | null>(null);

  function limpiar() {
    setArchivo(null);
    setPrevia(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  function elegir(nuevo: File | null) {
    setPrevia(null);
    if (nuevo && nuevo.size > TAMANO_MAXIMO_BYTES) {
      toast.error("El archivo pesa más de 4,5 MB");
      limpiar();
      return;
    }
    setArchivo(nuevo);
  }

  function formulario(): FormData {
    const datos = new FormData();
    datos.append("archivo", archivo!);
    return datos;
  }

  async function analizar() {
    if (!archivo) return;
    setAnalizando(true);
    try {
      setPrevia(await apiPostForm<ResumenImportacion>("/censo/importar/preview", formulario()));
    } catch (e) {
      toast.error("No se pudo leer la exportación", { description: mensajeDeError(e, "Revisa el archivo") });
    } finally {
      setAnalizando(false);
    }
  }

  async function importar() {
    if (!archivo) return;
    setImportando(true);
    try {
      const r = await apiPostForm<ResumenImportacion>("/censo/importar", formulario());
      toast.success(`${formatNumero(r.nuevas)} censos importados`, {
        description: `${formatNumero(r.clientes.CREADO)} clientes creados y ${formatNumero(r.duplicados)} duplicados marcados.`,
      });
      setOpen(false);
      limpiar();
      router.refresh();
    } catch (e) {
      toast.error("No se pudo importar", { description: mensajeDeError(e, "Intenta de nuevo") });
    } finally {
      setImportando(false);
    }
  }

  const sinUsuario = previa ? Object.entries(previa.encuestadoresSinUsuario) : [];

  return (
    <Dialog
      open={open}
      onOpenChange={(abierto) => {
        setOpen(abierto);
        if (!abierto) limpiar();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">
          <HistoryIcon />
          Importar de Survey123
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Importar el histórico de Survey123</DialogTitle>
          <DialogDescription>
            La exportación del censo (CSV, GeoJSON o Excel). Los censos que ya se importaron no se repiten, y cada
            cliente con código se crea o se completa como si el censo llegara desde la página.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="archivo-survey123">Exportación</Label>
          <input
            id="archivo-survey123"
            ref={inputRef}
            type="file"
            accept=".csv,.json,.geojson,.xlsx"
            className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-input file:bg-transparent file:px-3 file:py-1.5 file:text-sm"
            onChange={(e) => elegir(e.target.files?.[0] ?? null)}
          />
          <p className="text-xs text-muted-foreground">
            Carga antes la maestra de cada empresa: con ella se revisa que cada código corresponda al comercio.
          </p>
        </div>

        {!previa ? (
          <Button className="w-fit" onClick={analizar} disabled={!archivo || analizando}>
            <UploadIcon />
            {analizando ? "Analizando…" : "Analizar"}
          </Button>
        ) : (
          <div className="max-h-[45vh] space-y-3 overflow-y-auto [scrollbar-width:thin] [scrollbar-color:var(--muted-foreground)_transparent]">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Cifra etiqueta="Censos nuevos" valor={previa.nuevas} pista={`${formatNumero(previa.yaImportadas)} ya estaban`} />
              <Cifra etiqueta="Clientes a crear" valor={previa.clientes.CREADO} pista={`${formatNumero(previa.clientes.COMPLETADO)} a completar`} />
              <Cifra etiqueta="Duplicados" valor={previa.duplicados} pista="no cuentan" />
              <Cifra etiqueta="Posibles clientes" valor={previa.posiblesClientes} pista="no desean comprar" />
            </div>

            <ul className="list-inside list-disc space-y-0.5 text-sm text-muted-foreground">
              {previa.sinCodigo > 0 && (
                <li>
                  <span className="tabular-nums text-foreground">{formatNumero(previa.sinCodigo)}</span> censo(s) sin
                  código de cliente (el formulario de entonces no lo pedía): entran, pero no se cruzan con la maestra.
                </li>
              )}
              {previa.sinUbicacion + previa.ubicacionInvalida > 0 && (
                <li>
                  <span className="tabular-nums text-foreground">
                    {formatNumero(previa.sinUbicacion + previa.ubicacionInvalida)}
                  </span>{" "}
                  sin ubicación usable
                  {previa.ubicacionInvalida > 0 ? ` (${formatNumero(previa.ubicacionInvalida)} con la coordenada dañada)` : ""}.
                </li>
              )}
              {previa.invertidas > 0 && (
                <li>
                  {formatNumero(previa.invertidas)} con la latitud y la longitud invertidas: se corrigen.
                </li>
              )}
              {sinUsuario.length > 0 && (
                <li>
                  {sinUsuario.length} encuestador(es) sin usuario en la página (sus censos quedan a nombre de
                  “Importado de Survey123”): {sinUsuario.map(([n, c]) => `${n} (${c})`).join(", ")}.
                </li>
              )}
            </ul>

            {previa.clientes.REVISAR > 0 && (
              <div className="space-y-1.5 rounded-lg border border-border px-3 py-2 text-sm">
                <p className="flex items-center gap-1.5 font-medium">
                  <AlertTriangleIcon className="size-4 text-muted-foreground" />
                  {formatNumero(previa.clientes.REVISAR)} código(s) para revisar (no se toca el cliente)
                </p>
                <ul className="space-y-0.5 text-xs text-muted-foreground">
                  {previa.revisar.slice(0, 6).map((r) => (
                    <li key={`${r.smid}-${r.empresa}`}>
                      smid {r.smid}: {r.motivo}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {previa.totalErrores > 0 && (
              <div className="text-sm text-destructive">
                <p>{formatNumero(previa.totalErrores)} fila(s) no se pueden importar:</p>
                <ul className="list-inside list-disc text-xs">
                  {previa.errores.slice(0, 5).map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => setPrevia(null)} disabled={!previa || importando}>
            Volver a elegir
          </Button>
          <Button onClick={importar} disabled={!previa || previa.nuevas === 0 || importando}>
            {importando ? "Importando…" : previa ? `Importar ${formatNumero(previa.nuevas)} censos` : "Importar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
