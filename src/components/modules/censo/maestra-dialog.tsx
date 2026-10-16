"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangleIcon, ContactIcon, UploadIcon } from "lucide-react";
import { toast } from "sonner";
import { apiGet, apiPostForm, mensajeDeError } from "@/lib/api-client";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDateTime, formatNumero } from "@/lib/constants";
import type { EmpresaMaestra, MaestraCarga, MaestrasVigentes, PreviewMaestra } from "@/lib/censo";

// El límite de Vercel por request. El archivo real pesa ~0,1 MB.
const TAMANO_MAXIMO_BYTES = 4_500_000;
const EMPRESAS: EmpresaMaestra[] = ["TRALOG", "ISVAN"];

function Cifra({ etiqueta, valor, pista }: { etiqueta: string; valor: string; pista?: string }) {
  return (
    <div className="rounded-lg border border-border px-3 py-2">
      <p className="text-xs text-muted-foreground">{etiqueta}</p>
      <p className="font-medium tabular-nums">{valor}</p>
      {pista && <p className="text-xs text-muted-foreground">{pista}</p>}
    </div>
  );
}

function Reparto({ titulo, datos }: { titulo: string; datos: Record<string, number> }) {
  const filas = Object.entries(datos);
  if (!filas.length) return null;
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{titulo}</p>
      <div className="flex flex-wrap gap-1.5">
        {filas.map(([clave, n]) => (
          <span key={clave} className="rounded-md bg-muted px-2 py-0.5 text-xs">
            {clave} <span className="tabular-nums text-muted-foreground">{formatNumero(n)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function Vigente({ carga }: { carga: MaestraCarga | null | undefined }) {
  if (carga === undefined) return null;
  if (!carga) return <p className="text-sm text-muted-foreground">Esta empresa todavía no tiene maestra cargada.</p>;
  return (
    <p className="text-sm text-muted-foreground">
      Vigente: <span className="text-foreground">{carga.archivo}</span> · {formatNumero(carga.filas)} clientes ·
      cargada {formatDateTime(carga.subidaEn)}
      {carga.subidaPor ? ` por ${carga.subidaPor}` : ""}
    </p>
  );
}

/** Carga de la maestra de clientes por empresa: el padrón del cliente, con
 * la ruta, el día de visita y la zona de cada uno. Contra ella se calcula
 * quién falta por censar. En dos pasos, como la carga de ventas: primero se
 * analiza y se ve el contraste contra lo facturado, y solo después se
 * guarda. Cada carga es una foto completa y pasa a ser la vigente. */
export function MaestraDialog() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [empresa, setEmpresa] = useState<EmpresaMaestra>("TRALOG");
  const [archivo, setArchivo] = useState<File | null>(null);
  const [analizando, setAnalizando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [previa, setPrevia] = useState<PreviewMaestra | null>(null);
  const [vigentes, setVigentes] = useState<MaestrasVigentes | null>(null);

  useEffect(() => {
    if (!open) return;
    let activo = true;
    apiGet<MaestrasVigentes>("/censo/maestra")
      .then((r) => activo && setVigentes(r))
      .catch(() => {
        /* si falla, simplemente no se muestra cuál está vigente */
      });
    return () => {
      activo = false;
    };
  }, [open]);

  function limpiar() {
    setArchivo(null);
    setPrevia(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  function cambiarEmpresa(nueva: string) {
    setEmpresa(nueva as EmpresaMaestra);
    setPrevia(null);
  }

  function elegir(archivoNuevo: File | null) {
    setPrevia(null);
    if (archivoNuevo && archivoNuevo.size > TAMANO_MAXIMO_BYTES) {
      toast.error("El archivo pesa más de 4,5 MB");
      if (inputRef.current) inputRef.current.value = "";
      setArchivo(null);
      return;
    }
    setArchivo(archivoNuevo);
  }

  function formulario(): FormData {
    const datos = new FormData();
    datos.append("empresa", empresa);
    datos.append("archivo", archivo!);
    return datos;
  }

  async function analizar() {
    if (!archivo) return;
    setAnalizando(true);
    try {
      setPrevia(await apiPostForm<PreviewMaestra>("/censo/maestra/preview", formulario()));
    } catch (e) {
      toast.error("No se pudo leer la maestra", { description: mensajeDeError(e, "Revisa el archivo") });
    } finally {
      setAnalizando(false);
    }
  }

  async function guardar() {
    if (!archivo) return;
    setGuardando(true);
    try {
      const r = await apiPostForm<{ carga: MaestraCarga }>("/censo/maestra", formulario());
      toast.success(`Maestra de ${empresa} cargada`, {
        description: `${formatNumero(r.carga.filas)} clientes. Ya cuenta para el avance del censo.`,
      });
      setOpen(false);
      limpiar();
      router.refresh();
    } catch (e) {
      toast.error("No se pudo guardar la maestra", { description: mensajeDeError(e, "Intenta de nuevo") });
    } finally {
      setGuardando(false);
    }
  }

  const resumen = previa?.resumen;
  const contraste = previa?.contraste;

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
          <ContactIcon />
          Maestra de clientes
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Maestra de clientes</DialogTitle>
          <DialogDescription>
            El padrón de clientes de cada empresa, con su ruta, día de visita y zona. Contra él se calcula quién falta
            por censar. Cada archivo es una foto completa y reemplaza al anterior de su empresa.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={empresa} onValueChange={cambiarEmpresa}>
          <TabsList>
            {EMPRESAS.map((e) => (
              <TabsTrigger key={e} value={e} disabled={analizando || guardando}>
                {e}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Vigente carga={vigentes ? vigentes[empresa] : undefined} />

        <div className="space-y-2">
          <Label htmlFor="archivo-maestra">Archivo de {empresa} (.xlsx)</Label>
          <input
            id="archivo-maestra"
            ref={inputRef}
            type="file"
            accept=".xlsx"
            className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-input file:bg-transparent file:px-3 file:py-1.5 file:text-sm"
            onChange={(e) => elegir(e.target.files?.[0] ?? null)}
          />
          <p className="text-xs text-muted-foreground">
            Con las columnas Código, Ruta, Día, Razón Social, Dirección y Zona. El encabezado puede estar debajo del
            nombre de la empresa.
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
              <Cifra etiqueta="Clientes" valor={formatNumero(resumen!.clientes)} pista={`hoja “${resumen!.hoja}”`} />
              <Cifra
                etiqueta="Por censar"
                valor={formatNumero(resumen!.activos)}
                pista={`sin los ${formatNumero(resumen!.deBaja)} de la ruta 77`}
              />
              <Cifra
                etiqueta="Mismo cliente en ventas"
                valor={`${formatNumero(contraste!.mismoCliente)} de ${formatNumero(contraste!.codigosEnComun)}`}
                pista="códigos en común"
              />
              <Cifra
                etiqueta="Facturaron"
                valor={formatNumero(contraste!.clientesConVentas)}
                pista={`${formatNumero(contraste!.conVentasSinMaestraTotal)} no están en la maestra`}
              />
            </div>

            <Reparto titulo="Clientes por ruta" datos={resumen!.porRuta} />
            <Reparto titulo="Por tipo" datos={resumen!.porTipo} />

            {(contraste!.nombreDistintoTotal > 0 || contraste!.conVentasSinMaestraTotal > 0) && (
              <div className="space-y-1.5 rounded-lg border border-border px-3 py-2 text-sm">
                <p className="flex items-center gap-1.5 font-medium">
                  <AlertTriangleIcon className="size-4 text-muted-foreground" />
                  Diferencias con lo facturado
                </p>
                {contraste!.nombreDistintoTotal > 0 && (
                  <div className="text-muted-foreground">
                    <p>
                      <span className="tabular-nums text-foreground">
                        {formatNumero(contraste!.nombreDistintoTotal)}
                      </span>{" "}
                      código(s) con otro nombre en ventas (puede ser un código equivocado):
                    </p>
                    <ul className="mt-1 space-y-0.5 text-xs">
                      {contraste!.nombreDistinto.slice(0, 5).map((c) => (
                        <li key={c.codigo}>
                          <span className="tabular-nums text-foreground">{c.codigo}</span>: {c.nombreMaestra} ·
                          ventas: {c.nombreVentas}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {contraste!.conVentasSinMaestraTotal > 0 && (
                  <p className="text-muted-foreground">
                    <span className="tabular-nums text-foreground">
                      {formatNumero(contraste!.conVentasSinMaestraTotal)}
                    </span>{" "}
                    cliente(s) facturaron y no están en la maestra (
                    {contraste!.conVentasSinMaestra
                      .slice(0, 4)
                      .map((c) => c.codigo)
                      .join(", ")}
                    {contraste!.conVentasSinMaestraTotal > 4 ? "…" : ""}).
                  </p>
                )}
              </div>
            )}

            {(resumen!.conVariosActivos > 0 || resumen!.avisos.length > 0) && (
              <ul className="list-inside list-disc text-sm text-muted-foreground">
                {resumen!.conVariosActivos > 0 && (
                  <li>
                    {formatNumero(resumen!.conVariosActivos)} cliente(s) vienen en varias filas, una por nevera: se
                    cuentan una vez.
                  </li>
                )}
                {resumen!.avisos.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => setPrevia(null)} disabled={!previa || guardando}>
            Volver a elegir
          </Button>
          <Button onClick={guardar} disabled={!previa || guardando}>
            {guardando ? "Guardando…" : `Guardar como vigente de ${empresa}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
