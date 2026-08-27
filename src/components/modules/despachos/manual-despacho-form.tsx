"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PlusIcon, TrashIcon } from "lucide-react";
import { toast } from "sonner";
import { apiPost } from "@/lib/api-client";
import { NumberedCard } from "@/components/shared/numbered-card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Almacen, Cliente, Despacho } from "@/lib/mock-data";

type ItemForm = { descripcion: string; cantidad: string; pesoUnitarioKg: string; requiereFrio: boolean };

function itemVacio(): ItemForm {
  return { descripcion: "", cantidad: "", pesoUnitarioKg: "", requiereFrio: true };
}

export function ManualDespachoForm({
  clientes,
  origen,
  creadoPorId,
}: {
  clientes: Cliente[];
  origen: Almacen;
  creadoPorId: string;
}) {
  const router = useRouter();
  const [clienteId, setClienteId] = useState("");
  const [numeroDocumento, setNumeroDocumento] = useState("");
  const [items, setItems] = useState<ItemForm[]>([itemVacio()]);
  const [enviando, setEnviando] = useState(false);

  function actualizarItem(index: number, cambios: Partial<ItemForm>) {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, ...cambios } : it)));
  }

  function agregarItem() {
    setItems((prev) => [...prev, itemVacio()]);
  }

  function quitarItem(index: number) {
    setItems((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));
  }

  const itemsValidos = items.filter(
    (it) => it.descripcion.trim() && Number(it.cantidad) > 0 && Number(it.pesoUnitarioKg) >= 0
  );
  const puedeEnviar = Boolean(clienteId) && numeroDocumento.trim().length > 0 && itemsValidos.length > 0;

  function pesoTotalItem(item: ItemForm) {
    const cantidad = Number(item.cantidad);
    const peso = Number(item.pesoUnitarioKg);
    return Number.isFinite(cantidad) && Number.isFinite(peso) ? cantidad * peso : 0;
  }
  const pesoTotalGeneral = items.reduce((sum, item) => sum + pesoTotalItem(item), 0);

  async function enviar() {
    if (!puedeEnviar) return;
    setEnviando(true);
    try {
      const despacho = await apiPost<Despacho>("/despachos", {
        destinoClienteId: clienteId,
        numeroDocumento: numeroDocumento.trim(),
        creadoPorId,
        items: itemsValidos.map((it) => ({
          descripcion: it.descripcion.trim(),
          cantidad: Number(it.cantidad),
          pesoUnitarioKg: Number(it.pesoUnitarioKg),
          requiereFrio: it.requiereFrio,
        })),
      });
      toast.success("Despacho creado", {
        description: `Se creó el despacho ${despacho.numero} desde ${origen.nombre}, en estado "Pendiente de aprobación".`,
      });
      router.push("/despachos");
      router.refresh();
    } catch (err) {
      toast.error("No se pudo crear el despacho", {
        description: err instanceof Error ? err.message : undefined,
      });
      setEnviando(false);
    }
  }

  return (
    <NumberedCard
      number={1}
      title="Carga manual"
      helpText="Útil para un pedido suelto sin planilla — elige el cliente y agrega los ítems a mano."
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="cliente">Cliente</Label>
            <Select value={clienteId} onValueChange={setClienteId}>
              <SelectTrigger id="cliente" className="w-full">
                <SelectValue placeholder="Selecciona un cliente" />
              </SelectTrigger>
              <SelectContent>
                {clientes.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    [{c.empresa}] {c.codigo} — {c.nombre}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="numeroDocumento">N° de documento</Label>
            <Input
              id="numeroDocumento"
              placeholder="Ej. ISV-2026-0123"
              value={numeroDocumento}
              onChange={(e) => setNumeroDocumento(e.target.value)}
            />
          </div>
        </div>

        <div className="space-y-2">
          <div className="overflow-hidden rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Descripción</TableHead>
                  <TableHead className="w-24 text-right">Cantidad</TableHead>
                  <TableHead className="w-28 text-right">Peso por unidad (kg)</TableHead>
                  <TableHead className="w-24 text-right">Peso total</TableHead>
                  <TableHead className="w-20 text-center">Frío</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item, index) => (
                  <TableRow key={index} className="hover:bg-transparent">
                    <TableCell>
                      <Input
                        value={item.descripcion}
                        onChange={(e) => actualizarItem(index, { descripcion: e.target.value })}
                        placeholder="Ej. Tarrina Vainilla 1L"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        min={1}
                        className="text-right"
                        value={item.cantidad}
                        onChange={(e) => actualizarItem(index, { cantidad: e.target.value })}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        min={0}
                        step="0.1"
                        className="text-right"
                        placeholder="Peso de 1 unidad"
                        value={item.pesoUnitarioKg}
                        onChange={(e) => actualizarItem(index, { pesoUnitarioKg: e.target.value })}
                      />
                    </TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground">
                      {pesoTotalItem(item).toLocaleString("es-VE", { maximumFractionDigits: 2 })} kg
                    </TableCell>
                    <TableCell className="text-center">
                      <Checkbox
                        checked={item.requiereFrio}
                        onCheckedChange={(v) => actualizarItem(index, { requiereFrio: v === true })}
                      />
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => quitarItem(index)}
                        disabled={items.length === 1}
                        aria-label="Quitar item"
                      >
                        <TrashIcon />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="flex items-center justify-between">
            <Button variant="outline" size="sm" onClick={agregarItem}>
              <PlusIcon />
              Agregar ítem
            </Button>
            <p className="text-sm text-muted-foreground">
              Peso total del despacho:{" "}
              <span className="font-medium text-foreground">
                {pesoTotalGeneral.toLocaleString("es-VE", { maximumFractionDigits: 2 })} kg
              </span>
            </p>
          </div>
        </div>

        <Button onClick={enviar} disabled={!puedeEnviar || enviando}>
          {enviando ? "Creando..." : "Crear despacho"}
        </Button>
      </div>
    </NumberedCard>
  );
}
