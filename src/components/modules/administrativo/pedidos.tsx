"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiGet, apiPost, mensajeDeError } from "@/lib/api-client";
import { formatDateTime, formatUsd } from "@/lib/constants";
import type { ClienteFiscal, PedidoResumen, Producto } from "@/lib/administrativo";
import { ESTADO_TEXTO, ESTADO_TONO } from "./comunes";

type Almacen = { id: string; nombre: string };

export function NuevoPedido({ empresaId, almacenes, productos }: { empresaId: string; almacenes: Almacen[]; productos: Producto[] }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [buscar, setBuscar] = useState("");
  const [clientes, setClientes] = useState<ClienteFiscal[]>([]);
  const [clienteId, setClienteId] = useState("");
  const [almacenId, setAlmacenId] = useState(almacenes[0]?.id ?? "");
  const [renglones, setRenglones] = useState<{ productoId: string; cajas: string }[]>([{ productoId: "", cajas: "" }]);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    if (!abierto) return;
    const t = setTimeout(() => {
      apiGet<ClienteFiscal[]>(`/catalogo/clientes?empresaId=${empresaId}${buscar ? `&buscar=${encodeURIComponent(buscar)}` : ""}`)
        .then(setClientes).catch(() => setClientes([]));
    }, 300);
    return () => clearTimeout(t);
  }, [buscar, abierto, empresaId]);

  const cliente = clientes.find((c) => c.id === clienteId);
  const listos = renglones.filter((r) => r.productoId && Number(r.cajas) > 0);

  async function crear() {
    setEnviando(true);
    try {
      await apiPost("/ventas/pedidos", {
        id: crypto.randomUUID(), empresaId, clienteId, almacenId,
        items: listos.map((r) => ({ productoId: r.productoId, cajas: Number(r.cajas) })),
      });
      toast.success("Pedido creado en borrador");
      setAbierto(false);
      setRenglones([{ productoId: "", cajas: "" }]);
      setClienteId("");
      router.refresh();
    } catch (err) {
      toast.error("No se pudo crear el pedido", { description: mensajeDeError(err, "Revisa los datos") });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Dialog open={abierto} onOpenChange={setAbierto}>
      <DialogTrigger asChild><Button><PlusIcon />Nuevo pedido</Button></DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Nuevo pedido</DialogTitle>
          <DialogDescription>Los precios salen de la lista del cliente.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="ped-buscar">Cliente</Label>
            <Input id="ped-buscar" placeholder="Buscar por nombre, código o RIF" value={buscar} onChange={(e) => setBuscar(e.target.value)} />
            <select className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm" value={clienteId}
              onChange={(e) => setClienteId(e.target.value)} aria-label="Elegir cliente">
              <option value="">Elegir…</option>
              {clientes.map((c) => <option key={c.id} value={c.id}>{c.codigo} — {c.razonSocial ?? c.nombre}</option>)}
            </select>
            {cliente && (
              <p className="text-xs text-muted-foreground">
                Lista {cliente.listaPrecioCodigo ?? "sin lista"} · {cliente.rifCedula ?? "sin RIF (no se le puede facturar)"}
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ped-almacen">Almacén</Label>
            <select id="ped-almacen" className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm" value={almacenId} onChange={(e) => setAlmacenId(e.target.value)}>
              {almacenes.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
            </select>
          </div>
        </div>
        <div className="space-y-2">
          {renglones.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <select className="h-8 flex-1 rounded-md border border-input bg-transparent px-2 text-sm" value={r.productoId}
                aria-label={`Producto del renglón ${i + 1}`}
                onChange={(e) => setRenglones((rs) => rs.map((x, j) => (j === i ? { ...x, productoId: e.target.value } : x)))}>
                <option value="">Producto…</option>
                {productos.map((p) => <option key={p.id} value={p.id}>{p.codigo} — {p.nombre}</option>)}
              </select>
              <Input className="w-24" inputMode="decimal" placeholder="Cajas" value={r.cajas} aria-label={`Cajas del renglón ${i + 1}`}
                onChange={(e) => setRenglones((rs) => rs.map((x, j) => (j === i ? { ...x, cajas: e.target.value } : x)))} />
              <Button variant="ghost" size="icon" aria-label="Quitar renglón" onClick={() => setRenglones((rs) => rs.filter((_, j) => j !== i))}>
                <Trash2Icon />
              </Button>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={() => setRenglones((rs) => [...rs, { productoId: "", cajas: "" }])}>Agregar renglón</Button>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setAbierto(false)}>Cancelar</Button>
          <Button onClick={crear} disabled={enviando || !clienteId || !almacenId || listos.length === 0}>
            {enviando ? "Creando..." : `Crear pedido (${listos.length} renglón(es))`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Facturar({ pedido }: { pedido: PedidoResumen }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [divisas, setDivisas] = useState(false);
  async function facturar(tipo: "FA" | "NE") {
    try {
      const r = await apiPost<{ documentoId: string }>(`/ventas/pedidos/${pedido.id}/facturar`, { tipo, pagoEnDivisas: divisas });
      toast.success(tipo === "FA" ? "Factura enviada a emitir" : "Nota de entrega enviada a emitir");
      setAbierto(false);
      router.push(`/administrativo/documentos/${r.documentoId}`);
    } catch (err) {
      toast.error("No se pudo facturar", { description: mensajeDeError(err, "Intenta de nuevo") });
    }
  }
  return (
    <Dialog open={abierto} onOpenChange={setAbierto}>
      <DialogTrigger asChild><Button size="sm">Facturar</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Facturar {pedido.numero}</DialogTitle>
          <DialogDescription>{pedido.cliente} · {formatUsd(pedido.subtotalUsd, 2)} sin IVA</DialogDescription>
        </DialogHeader>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={divisas} onCheckedChange={(v) => setDivisas(v === true)} />
          Lo paga en divisas (se cobra el IGTF del 3 %)
        </label>
        <DialogFooter>
          <Button variant="outline" onClick={() => facturar("NE")}>Nota de entrega</Button>
          <Button onClick={() => facturar("FA")}>Factura</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PedidosTabla({ pedidos }: { pedidos: PedidoResumen[] }) {
  const router = useRouter();
  async function accion(pedido: PedidoResumen, que: "confirmar" | "anular") {
    try {
      if (que === "anular") {
        const motivo = window.prompt(`Motivo para anular ${pedido.numero}`);
        if (!motivo || motivo.trim().length < 3) return;
        await apiPost(`/ventas/pedidos/${pedido.id}/anular`, { motivo });
      } else {
        await apiPost(`/ventas/pedidos/${pedido.id}/confirmar`);
      }
      toast.success(que === "anular" ? "Pedido anulado" : "Pedido confirmado: la mercancía queda reservada");
      router.refresh();
    } catch (err) {
      toast.error(que === "anular" ? "No se pudo anular" : "No se pudo confirmar", { description: mensajeDeError(err, "Intenta de nuevo") });
    }
  }
  if (pedidos.length === 0) return <p className="py-8 text-center text-sm text-muted-foreground">No hay pedidos.</p>;
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow><TableHead>Pedido</TableHead><TableHead>Creado</TableHead><TableHead>Cliente</TableHead><TableHead>Origen</TableHead><TableHead className="text-right">Subtotal</TableHead><TableHead>Estado</TableHead><TableHead /></TableRow>
        </TableHeader>
        <TableBody>
          {pedidos.map((p) => (
            <TableRow key={p.id}>
              <TableCell className="font-medium">{p.numero}</TableCell>
              <TableCell className="whitespace-nowrap text-muted-foreground">{formatDateTime(p.creadoEn)}</TableCell>
              <TableCell>{p.cliente}<span className="block text-xs text-muted-foreground">{p.clienteCodigo}{p.vendedor ? ` · ${p.vendedor}` : ""}</span></TableCell>
              <TableCell>{p.origen}</TableCell>
              <TableCell className="text-right tabular-nums">{formatUsd(p.subtotalUsd, 2)}</TableCell>
              <TableCell><StatusBadge label={ESTADO_TEXTO[p.estado]} tone={ESTADO_TONO[p.estado]} /></TableCell>
              <TableCell className="whitespace-nowrap text-right">
                {p.estado === "BORRADOR" && <Button size="sm" variant="outline" onClick={() => accion(p, "confirmar")}>Confirmar</Button>}
                {p.estado === "CONFIRMADO" && <Facturar pedido={p} />}
                {(p.estado === "BORRADOR" || p.estado === "CONFIRMADO") && (
                  <Button size="sm" variant="ghost" onClick={() => accion(p, "anular")}>Anular</Button>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
