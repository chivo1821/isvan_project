"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { UploadIcon } from "lucide-react";
import { toast } from "sonner";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiPost, apiPostForm, mensajeDeError } from "@/lib/api-client";
import { formatDate, formatDateTime, formatNumero } from "@/lib/constants";
import type { Ajuste, Existencia } from "@/lib/administrativo";
import { ESTADO_TEXTO, ESTADO_TONO } from "./comunes";

type Almacen = { id: string; nombre: string };

export function ExistenciasTabla({ existencias, almacenes }: { existencias: Existencia[]; almacenes: Almacen[] }) {
  const [buscar, setBuscar] = useState("");
  const nombreAlmacen = Object.fromEntries(almacenes.map((a) => [a.id, a.nombre]));
  const t = buscar.trim().toLowerCase();
  const filtradas = t ? existencias.filter((e) => `${e.codigo} ${e.nombre} ${e.grupo ?? ""}`.toLowerCase().includes(t)) : existencias;
  return (
    <div className="space-y-3">
      <Input className="w-64" placeholder="Buscar producto" value={buscar} onChange={(e) => setBuscar(e.target.value)} aria-label="Buscar producto" />
      {filtradas.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Sin existencias. Carga el conteo inicial con un Excel.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow><TableHead>Producto</TableHead><TableHead>Almacén</TableHead><TableHead className="text-right">Cajas</TableHead><TableHead className="text-right">Reservado</TableHead><TableHead className="text-right">Disponible</TableHead><TableHead>Lotes (vence primero arriba)</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {filtradas.map((e) => (
                <TableRow key={`${e.productoId}-${e.almacenId}`}>
                  <TableCell className="font-medium">{e.nombre}<span className="block text-xs text-muted-foreground">{e.codigo} · {e.grupo ?? "sin grupo"}</span></TableCell>
                  <TableCell>{nombreAlmacen[e.almacenId] ?? e.almacenId}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumero(e.cajas, 2)}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{formatNumero(e.reservado, 2)}</TableCell>
                  <TableCell className={`text-right font-semibold tabular-nums ${e.disponible <= 0 ? "text-destructive" : ""}`}>{formatNumero(e.disponible, 2)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {e.lotes.map((l) => `${l.lote}${l.vencimiento ? ` (${formatDate(l.vencimiento)})` : ""}: ${formatNumero(l.cajas, 2)}`).join(" · ")}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

type Vista = { renglones: { fila: number; codigo: number; nombre: string; cajas: number; lote: string | null; vencimiento: string | null }[]; problemas: { fila: number; motivo: string }[] };

export function ConteoExcel({ empresaId, almacenes }: { empresaId: string; almacenes: Almacen[] }) {
  const router = useRouter();
  const [almacenId, setAlmacenId] = useState(almacenes[0]?.id ?? "");
  const [archivo, setArchivo] = useState<File | null>(null);
  const [vista, setVista] = useState<Vista | null>(null);
  const [referencia, setReferencia] = useState("Conteo inicial");

  async function enviar(confirmar: boolean, f: File | null = archivo) {
    if (!f) return;
    const form = new FormData();
    form.append("archivo", f);
    const q = new URLSearchParams({ empresaId, almacenId, referencia, confirmar: String(confirmar) });
    try {
      const r = await apiPostForm<Vista>(`/inventario/entradas/excel?${q}`, form);
      if (confirmar) {
        toast.success(`${r.renglones.length} renglón(es) cargados al inventario`);
        setVista(null);
        setArchivo(null);
        router.refresh();
      } else {
        setVista(r);
      }
    } catch (err) {
      toast.error("No se pudo cargar", { description: mensajeDeError(err, "Revisa el archivo") });
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-border p-4">
      <p className="text-sm font-medium">Entrada desde Excel (conteo inicial o recepción)</p>
      <p className="text-xs text-muted-foreground">Columnas: código del producto, cajas, lote (opcional), vencimiento (opcional, dd/mm/aaaa).</p>
      <div className="flex flex-wrap items-end gap-2">
        <select className="h-8 rounded-md border border-input bg-transparent px-2 text-sm" value={almacenId} onChange={(e) => setAlmacenId(e.target.value)} aria-label="Almacén">
          {almacenes.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
        </select>
        <Input className="w-48" value={referencia} onChange={(e) => setReferencia(e.target.value)} aria-label="Referencia" />
        <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-input px-2.5 text-sm">
          <UploadIcon className="size-4" /> {archivo ? archivo.name : "Elegir Excel"}
          <input type="file" accept=".xlsx" className="sr-only" onChange={(e) => { const f = e.target.files?.[0] ?? null; setArchivo(f); setVista(null); if (f) enviar(false, f); }} />
        </label>
      </div>
      {vista && (
        <div className="space-y-2 text-sm">
          <p>{vista.renglones.length} renglón(es) listos{vista.problemas.length ? `, ${vista.problemas.length} con problemas` : ""}.</p>
          {vista.problemas.slice(0, 10).map((p) => <p key={p.fila} className="text-destructive">Fila {p.fila}: {p.motivo}</p>)}
          <Button onClick={() => enviar(true)} disabled={vista.problemas.length > 0 || vista.renglones.length === 0}>Confirmar entrada</Button>
        </div>
      )}
    </div>
  );
}

export function NuevoAjuste({ empresaId, almacenes, existencias }: { empresaId: string; almacenes: Almacen[]; existencias: Existencia[] }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [almacenId, setAlmacenId] = useState(almacenes[0]?.id ?? "");
  const [lote, setLote] = useState("");
  const [cajas, setCajas] = useState("");
  const [motivo, setMotivo] = useState("");
  const opciones = existencias.filter((e) => e.almacenId === almacenId).flatMap((e) => e.lotes.map((l) => ({ ...l, productoId: e.productoId, nombre: e.nombre })));
  const elegido = opciones.find((o) => o.loteId === lote);

  async function proponer() {
    if (!elegido) return;
    try {
      await apiPost("/inventario/ajustes", { empresaId, almacenId, motivo, items: [{ productoId: elegido.productoId, loteId: elegido.loteId, cajas: Number(cajas.replace(",", ".")) }] });
      toast.success("Ajuste propuesto: lo aprueba otra persona");
      setAbierto(false);
      router.refresh();
    } catch (err) {
      toast.error("No se pudo proponer", { description: mensajeDeError(err, "Revisa los datos") });
    }
  }
  return (
    <Dialog open={abierto} onOpenChange={setAbierto}>
      <DialogTrigger asChild><Button variant="outline">Proponer ajuste</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ajuste de inventario</DialogTitle>
          <DialogDescription>Positivo suma, negativo resta. Lo aprueba alguien distinto de quien lo propone.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <select className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm" value={almacenId} onChange={(e) => setAlmacenId(e.target.value)} aria-label="Almacén">
            {almacenes.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
          </select>
          <select className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm" value={lote} onChange={(e) => setLote(e.target.value)} aria-label="Producto y lote">
            <option value="">Producto y lote…</option>
            {opciones.map((o) => <option key={o.loteId} value={o.loteId}>{o.nombre} — {o.lote} ({formatNumero(o.cajas, 2)} cajas)</option>)}
          </select>
          <Input inputMode="decimal" placeholder="Cajas (ej. -2)" value={cajas} onChange={(e) => setCajas(e.target.value)} aria-label="Cajas" />
          <div className="space-y-1.5">
            <Label htmlFor="aj-motivo">Motivo</Label>
            <Input id="aj-motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setAbierto(false)}>Cancelar</Button>
          <Button onClick={proponer} disabled={!elegido || !Number(cajas.replace(",", ".")) || motivo.trim().length < 3}>Proponer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AjustesTabla({ ajustes, existencias }: { ajustes: Ajuste[]; existencias: Existencia[] }) {
  const router = useRouter();
  const nombre = Object.fromEntries(existencias.map((e) => [e.productoId, e.nombre]));
  async function resolver(id: string, decision: "aprobar" | "rechazar") {
    try {
      await apiPost(`/inventario/ajustes/${id}/${decision}`);
      toast.success(decision === "aprobar" ? "Ajuste aprobado" : "Ajuste rechazado");
      router.refresh();
    } catch (err) {
      toast.error("No se pudo resolver", { description: mensajeDeError(err, "Intenta de nuevo") });
    }
  }
  if (ajustes.length === 0) return null;
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <Table>
        <TableHeader><TableRow><TableHead>Propuesto</TableHead><TableHead>Motivo</TableHead><TableHead>Renglones</TableHead><TableHead>Estado</TableHead><TableHead /></TableRow></TableHeader>
        <TableBody>
          {ajustes.map((a) => (
            <TableRow key={a.id}>
              <TableCell className="whitespace-nowrap">{formatDateTime(a.creadoEn)}<span className="block text-xs text-muted-foreground">{a.propuestoPor} · {a.almacen}</span></TableCell>
              <TableCell>{a.motivo}</TableCell>
              <TableCell className="text-xs">{a.items.map((i) => `${nombre[i.productoId] ?? i.productoId}: ${i.cajas}`).join(" · ")}</TableCell>
              <TableCell><StatusBadge label={ESTADO_TEXTO[a.estado]} tone={ESTADO_TONO[a.estado]} />{a.resueltoPor && <span className="block text-xs text-muted-foreground">{a.resueltoPor}</span>}</TableCell>
              <TableCell className="whitespace-nowrap text-right">
                {a.estado === "PROPUESTO" && (
                  <>
                    <Button size="sm" onClick={() => resolver(a.id, "aprobar")}>Aprobar</Button>
                    <Button size="sm" variant="ghost" onClick={() => resolver(a.id, "rechazar")}>Rechazar</Button>
                  </>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
