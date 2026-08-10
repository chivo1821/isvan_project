"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2Icon, PackageIcon, WarehouseIcon } from "lucide-react";
import { toast } from "sonner";
import { apiPost } from "@/lib/api-client";
import { NumberedCard } from "@/components/shared/numbered-card";
import { StepWizard, type WizardStep } from "@/components/shared/step-wizard";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatBs, formatCurrency, formatDualCurrency } from "@/lib/constants";
import type { Almacen, Despacho, VentaConDetalle } from "@/lib/mock-data";

const STEPS: WizardStep[] = [
  { id: "venta", label: "Venta" },
  { id: "confirmar", label: "Confirmar" },
];

export function NuevoDespachoWizard({
  ventasElegibles,
  origen,
  creadoPorId,
}: {
  ventasElegibles: VentaConDetalle[];
  origen: Almacen;
  creadoPorId: string;
}) {
  const router = useRouter();
  const [ventaId, setVentaId] = useState("");
  const [confirmando, setConfirmando] = useState(false);

  const venta = ventasElegibles.find((v) => v.id === ventaId);
  const ventaLista = Boolean(venta);
  const currentStep = !ventaLista ? 1 : 2;

  async function confirmarDespacho() {
    if (!venta) return;
    setConfirmando(true);
    try {
      const despacho = await apiPost<Despacho>("/despachos", { ventaId: venta.id, creadoPorId });
      toast.success("Despacho creado", {
        description: `Se creó el despacho ${despacho.numero}: ${origen.nombre} → ${venta.cliente.nombre}, en estado "Pendiente de aprobación".`,
      });
      router.push("/despachos");
      router.refresh();
    } catch (err) {
      toast.error("No se pudo crear el despacho", {
        description: err instanceof Error ? err.message : undefined,
      });
      setConfirmando(false);
    }
  }

  return (
    <div className="space-y-6">
      <StepWizard steps={STEPS} currentStep={currentStep} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <NumberedCard
            number={1}
            title="Venta aprobada"
            helpText="Solo se listan ventas aprobadas que todavía no generaron un despacho. Los productos y el destino se toman directo de la venta."
          >
            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="venta">Venta</Label>
                {ventasElegibles.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No hay ventas aprobadas pendientes de despacho en este momento.
                  </p>
                ) : (
                  <Select value={ventaId} onValueChange={setVentaId}>
                    <SelectTrigger id="venta" className="w-full">
                      <SelectValue placeholder="Selecciona una venta aprobada" />
                    </SelectTrigger>
                    <SelectContent>
                      {ventasElegibles.map((v) => (
                        <SelectItem key={v.id} value={v.id}>
                          {v.numero} — {v.cliente.nombre} ({formatDualCurrency(v.total, v.tasaBcv)})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              {venta && (
                <div className="space-y-3 rounded-lg border border-border p-3">
                  <div className="flex items-center justify-between gap-4">
                    <div className="text-sm">
                      <p className="font-medium text-foreground">{venta.cliente.nombre}</p>
                      <p className="text-muted-foreground">
                        {venta.cliente.codigo} · {venta.cliente.direccion}, {venta.cliente.ciudad}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                      <WarehouseIcon className="size-3.5" />
                      Sale de {origen.nombre}
                    </div>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Producto</TableHead>
                        <TableHead className="text-right">Cantidad</TableHead>
                        <TableHead className="text-right">Subtotal</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {venta.itemsConProducto.map((item) => (
                        <TableRow key={item.id} className="hover:bg-transparent">
                          <TableCell>{item.producto.nombre}</TableCell>
                          <TableCell className="text-right">{item.cantidad}</TableCell>
                          <TableCell className="text-right leading-tight">
                            <p>{formatCurrency(item.subtotal)}</p>
                            <p className="text-xs text-muted-foreground">{formatBs(item.subtotal, venta.tasaBcv)}</p>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          </NumberedCard>
        </div>

        <div className="lg:sticky lg:top-6 lg:self-start">
          <NumberedCard number={2} title="Confirmar despacho" helpText="Revisa el resumen antes de crear el despacho.">
            {!ventaLista ? (
              <div className="flex flex-col items-center gap-2 py-6 text-center">
                <PackageIcon className="size-8 text-muted-foreground" />
                <p className="text-sm font-medium text-foreground">Aún no elegiste una venta</p>
                <p className="text-xs text-muted-foreground">
                  Selecciona una venta aprobada para poder confirmar el despacho.
                </p>
              </div>
            ) : (
              <div className="space-y-3 text-sm">
                <Row label="Venta" value={venta!.numero} />
                <Row label="Origen" value={origen.nombre} />
                <Row label="Destino" value={venta!.cliente.nombre} />
                <div className="space-y-1 border-t border-border pt-2">
                  {venta!.itemsConProducto.map((item) => (
                    <div key={item.id} className="flex justify-between text-xs text-muted-foreground">
                      <span>
                        {item.cantidad}× {item.producto.nombre}
                      </span>
                      <span>{formatDualCurrency(item.subtotal, venta!.tasaBcv)}</span>
                    </div>
                  ))}
                </div>
                <div className="flex justify-between border-t border-border pt-2 font-medium text-foreground">
                  <span>Total</span>
                  <span className="text-right">
                    <span className="block">{formatCurrency(venta!.total)}</span>
                    <span className="block text-xs font-normal text-muted-foreground">{formatBs(venta!.total, venta!.tasaBcv)}</span>
                  </span>
                </div>
              </div>
            )}
            <Button className="mt-4 w-full" disabled={!ventaLista || confirmando} onClick={confirmarDespacho}>
              <CheckCircle2Icon />
              {confirmando ? "Confirmando..." : "Confirmar despacho"}
            </Button>
          </NumberedCard>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  );
}
