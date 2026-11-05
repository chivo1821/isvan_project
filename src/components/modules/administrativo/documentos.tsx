"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PrinterIcon } from "lucide-react";
import { toast } from "sonner";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { apiPost, mensajeDeError } from "@/lib/api-client";
import { formatBs, formatDate, formatNumero, formatUsd } from "@/lib/constants";
import { IMPUESTO, TIPO_DOCUMENTO, type DocumentoDetalle, type DocumentoResumen } from "@/lib/administrativo";
import { ESTADO_TEXTO, ESTADO_TONO } from "./comunes";

export function DocumentosTabla({ documentos }: { documentos: DocumentoResumen[] }) {
  if (documentos.length === 0) return <p className="py-8 text-center text-sm text-muted-foreground">No hay documentos en este período.</p>;
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow><TableHead>Documento</TableHead><TableHead>Control</TableHead><TableHead>Fecha</TableHead><TableHead>Cliente</TableHead><TableHead className="text-right">Total USD</TableHead><TableHead className="text-right">Total Bs</TableHead><TableHead>Estado</TableHead></TableRow>
        </TableHeader>
        <TableBody>
          {documentos.map((d) => (
            <TableRow key={d.id}>
              <TableCell className="font-medium">
                <Link href={`/administrativo/documentos/${d.id}`} className="hover:underline">{d.numero ?? `${TIPO_DOCUMENTO[d.tipo]} (sin número)`}</Link>
                {d.documentoAfectado && <span className="block text-xs text-muted-foreground">sobre {d.documentoAfectado}</span>}
              </TableCell>
              <TableCell className="text-muted-foreground">{d.numeroControl ?? "—"}</TableCell>
              <TableCell className="whitespace-nowrap">{d.fechaEmision ? formatDate(d.fechaEmision) : "—"}</TableCell>
              <TableCell>{d.cliente}<span className="block text-xs text-muted-foreground">{d.clienteCodigo}</span></TableCell>
              <TableCell className="text-right tabular-nums">{formatUsd(d.totalUsd, 2)}</TableCell>
              <TableCell className="text-right tabular-nums">{d.totalBs ? formatBs(d.totalBs) : "—"}</TableCell>
              <TableCell>
                <StatusBadge label={ESTADO_TEXTO[d.estado]} tone={ESTADO_TONO[d.estado]} />
                {d.errorEmision && <span className="mt-0.5 block max-w-56 text-xs text-destructive">{d.errorEmision}</span>}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function NotaDialog({ doc }: { doc: DocumentoDetalle }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [tipo, setTipo] = useState<"NC" | "ND">("NC");
  const [motivo, setMotivo] = useState("");
  const [devolver, setDevolver] = useState(true);
  const [cajas, setCajas] = useState<Record<string, string>>({});
  const renglones = doc.items
    .map((it) => ({ productoId: it.productoId, cajas: Number((cajas[it.id] ?? "").replace(",", ".")) }))
    .filter((r) => r.cajas > 0);

  async function crear() {
    try {
      const r = await apiPost<{ documentoId: string }>(`/ventas/documentos/${doc.id}/notas`, {
        tipo, motivo, devuelveInventario: tipo === "NC" && devolver, items: renglones,
      });
      toast.success(tipo === "NC" ? "Nota de crédito enviada a emitir" : "Nota de débito enviada a emitir");
      setAbierto(false);
      router.push(`/administrativo/documentos/${r.documentoId}`);
    } catch (err) {
      toast.error("No se pudo crear la nota", { description: mensajeDeError(err, "Revisa las cantidades") });
    }
  }

  return (
    <Dialog open={abierto} onOpenChange={setAbierto}>
      <DialogTrigger asChild><Button variant="outline">Nota de crédito o débito</Button></DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Nota sobre {doc.numero}</DialogTitle>
          <DialogDescription>Una factura emitida no se edita: se corrige con una nota. Elige las cajas de cada producto.</DialogDescription>
        </DialogHeader>
        <div className="flex gap-2">
          {(["NC", "ND"] as const).map((t) => (
            <Button key={t} size="sm" variant={tipo === t ? "default" : "outline"} onClick={() => setTipo(t)}>{TIPO_DOCUMENTO[t]}</Button>
          ))}
        </div>
        <div className="space-y-2">
          {doc.items.map((it) => (
            <div key={it.id} className="flex items-center justify-between gap-3 text-sm">
              <span className="min-w-0 flex-1">{it.descripcion}<span className="block text-xs text-muted-foreground">{formatNumero(it.cajas, 2)} cajas a {formatUsd(it.precioCajaUsd, 2)}</span></span>
              <Input className="w-24" inputMode="decimal" placeholder="Cajas" value={cajas[it.id] ?? ""} aria-label={`Cajas de ${it.descripcion}`}
                onChange={(e) => setCajas((c) => ({ ...c, [it.id]: e.target.value }))} />
            </div>
          ))}
        </div>
        {tipo === "NC" && (
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={devolver} onCheckedChange={(v) => setDevolver(v === true)} />
            La mercancía vuelve al inventario (a los mismos lotes)
          </label>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="nota-motivo">Motivo</Label>
          <Textarea id="nota-motivo" rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setAbierto(false)}>Cancelar</Button>
          <Button onClick={crear} disabled={motivo.trim().length < 3 || renglones.length === 0}>Emitir {TIPO_DOCUMENTO[tipo].toLowerCase()}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Vigila un documento que se está emitiendo y refresca hasta que salga. */
function EsperarEmision() {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(t);
  }, [router]);
  return <p className="text-sm text-muted-foreground">Emitiendo con la imprenta digital… se actualiza solo.</p>;
}

export function DocumentoVista({ doc }: { doc: DocumentoDetalle }) {
  const router = useRouter();
  async function reintentar() {
    try {
      await apiPost(`/ventas/documentos/${doc.id}/reintentar`);
      toast.success("Enviado a emitir de nuevo");
      router.refresh();
    } catch (err) {
      toast.error("No se pudo reintentar", { description: mensajeDeError(err, "Corrige los datos primero") });
    }
  }
  const e = doc.empresa;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <StatusBadge label={ESTADO_TEXTO[doc.estado]} tone={ESTADO_TONO[doc.estado]} />
        {doc.estado === "EN_EMISION" && <EsperarEmision />}
        {doc.estado === "RECHAZADA" && (
          <>
            <span className="text-sm text-destructive">{doc.errorEmision}</span>
            <Button size="sm" onClick={reintentar}>Corregí los datos: emitir de nuevo</Button>
          </>
        )}
        <div className="ml-auto flex gap-2">
          {doc.estado === "EMITIDA" && (doc.tipo === "FA" || doc.tipo === "NE") && <NotaDialog doc={doc} />}
          <Button variant="outline" onClick={() => window.print()}><PrinterIcon />Imprimir</Button>
        </div>
      </div>
      {doc.emisorFiscal === "SIMULADO" && (
        <p className="rounded-lg bg-warning/10 px-3 py-2 text-sm font-medium">Documento SIMULADO: sin validez fiscal (emisor de prueba).</p>
      )}
      <article className="space-y-4 rounded-xl border border-border bg-card p-6 text-sm print:border-0 print:p-0">
        <header className="flex flex-wrap justify-between gap-4">
          <div>
            <p className="text-lg font-semibold">{e.razonSocial}</p>
            <p>RIF {e.rif ?? "—"}</p>
            <p className="max-w-sm text-muted-foreground">{e.domicilioFiscal}</p>
            {e.correo && <p className="text-muted-foreground">{e.correo}</p>}
          </div>
          <div className="text-right">
            <p className="text-lg font-semibold">{TIPO_DOCUMENTO[doc.tipo]}</p>
            <p>N° {doc.numero ?? "sin número"}</p>
            <p>N° de control {doc.numeroControl ?? "—"}</p>
            <p>Fecha {doc.fechaEmision ? formatDate(doc.fechaEmision) : "—"}</p>
            {doc.vencimiento && <p className="text-muted-foreground">Vence {formatDate(doc.vencimiento)}</p>}
            {doc.afectado && <p>Afecta a {doc.afectado.numero}</p>}
          </div>
        </header>
        <section className="rounded-lg bg-muted/40 p-3">
          <p className="font-medium">{doc.clienteRazonSocial ?? doc.cliente.razonSocial ?? doc.cliente.nombre}</p>
          <p>RIF / C.I. {doc.clienteRif ?? doc.cliente.rifCedula ?? "—"} · Código {doc.cliente.codigo}</p>
          <p className="text-muted-foreground">{doc.clienteDomicilio ?? doc.cliente.direccion}</p>
          {doc.motivo && <p className="mt-1">Motivo: {doc.motivo}</p>}
        </section>
        <Table>
          <TableHeader>
            <TableRow><TableHead>Código</TableHead><TableHead>Descripción</TableHead><TableHead className="text-right">Cajas</TableHead><TableHead className="text-right">Precio caja</TableHead><TableHead className="text-right">Desc.</TableHead><TableHead>Impuesto</TableHead><TableHead className="text-right">Subtotal USD</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {doc.items.map((it) => (
              <TableRow key={it.id}>
                <TableCell className="tabular-nums">{it.codigoProducto}</TableCell>
                <TableCell>{it.descripcion}</TableCell>
                <TableCell className="text-right tabular-nums">{formatNumero(it.cajas, 2)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatUsd(it.precioCajaUsd, 2)}</TableCell>
                <TableCell className="text-right tabular-nums">{it.descuentoPct ? `${it.descuentoPct} %` : "—"}</TableCell>
                <TableCell>{IMPUESTO[it.impuestoCodigo] ?? it.impuestoCodigo}</TableCell>
                <TableCell className="text-right tabular-nums">{formatUsd(it.subtotalUsd, 2)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <section className="ml-auto grid max-w-md grid-cols-3 gap-x-4 gap-y-1 tabular-nums">
          <span />
          <span className="text-right font-medium">USD</span>
          <span className="text-right font-medium">Bs{doc.tasa ? ` (tasa ${formatNumero(doc.tasa, 4)})` : ""}</span>
          {[
            ["Exento", doc.exentoUsd, doc.exentoBs],
            ...(doc.impuestos ?? []).filter((i) => i.porcentaje > 0).flatMap((i) => [
              [`Base ${i.porcentaje} %`, i.baseUsd, i.baseBs],
              [`IVA ${i.porcentaje} %`, i.ivaUsd, i.ivaBs],
            ]),
            ...(doc.igtfUsd ? [[`IGTF ${doc.igtfPorcentaje} %`, doc.igtfUsd, doc.igtfBs]] : []),
            ["Total", doc.totalUsd, doc.totalBs],
          ].map(([texto, usd, bs]) => (
            <div key={String(texto)} className="contents">
              <span className={texto === "Total" ? "font-semibold" : "text-muted-foreground"}>{texto}</span>
              <span className={`text-right ${texto === "Total" ? "font-semibold" : ""}`}>{formatUsd(Number(usd), 2)}</span>
              <span className={`text-right ${texto === "Total" ? "font-semibold" : ""}`}>{doc.tasa ? formatBs(Number(bs)) : "—"}</span>
            </div>
          ))}
        </section>
        {doc.retencionIvaEsperadaBs != null && (
          <p className="text-muted-foreground">Cliente contribuyente especial: retiene {formatBs(doc.retencionIvaEsperadaBs)} de IVA.</p>
        )}
      </article>
      {doc.notas.length > 0 && (
        <section className="space-y-1 print:hidden">
          <p className="text-sm font-medium">Notas sobre este documento</p>
          {doc.notas.map((n) => (
            <Link key={n.id} href={`/administrativo/documentos/${n.id}`} className="block text-sm hover:underline">
              {TIPO_DOCUMENTO[n.tipo]} {n.numero ?? "(sin número)"} · {ESTADO_TEXTO[n.estado]} · {formatUsd(n.totalUsd, 2)}
            </Link>
          ))}
        </section>
      )}
    </div>
  );
}
