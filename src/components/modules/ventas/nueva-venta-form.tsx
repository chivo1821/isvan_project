"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { Controller, useFieldArray, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { apiPost } from "@/lib/api-client";
import { NumberedCard } from "@/components/shared/numbered-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatBs, formatCurrency, formatDualCurrency } from "@/lib/constants";
import type { Cliente, Factura, Producto, StockAlmacen, Venta } from "@/lib/mock-data";

const ventaSchema = z.object({
  clienteId: z.string().min(1, "Selecciona un cliente"),
  items: z
    .array(
      z.object({
        productoId: z.string().min(1, "Selecciona un producto"),
        cantidad: z.number({ error: "Ingresa una cantidad" }).int().positive("La cantidad debe ser mayor a 0"),
      })
    )
    .min(1, "Agrega al menos un producto"),
});

type VentaFormValues = z.infer<typeof ventaSchema>;

export function NuevaVentaForm({
  clientes,
  productos,
  facturas,
  stock,
  vendedorId,
}: {
  clientes: Cliente[];
  productos: Producto[];
  facturas: Factura[];
  stock: StockAlmacen[];
  vendedorId: string;
}) {
  const router = useRouter();
  const {
    control,
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<VentaFormValues>({
    resolver: zodResolver(ventaSchema),
    defaultValues: { clienteId: "", items: [{ productoId: "", cantidad: 1 }] },
  });

  const { fields, append, remove } = useFieldArray({ control, name: "items" });
  const clienteId = watch("clienteId");
  const items = watch("items");

  const facturasPendientesCliente = clienteId
    ? facturas.filter((f) => f.clienteId === clienteId && (f.estado === "PENDIENTE" || f.estado === "VENCIDA"))
    : [];

  function stockDisponible(productoId: string) {
    return stock
      .filter((s) => s.productoId === productoId)
      .reduce((sum, s) => sum + s.cantidad, 0);
  }

  const total = items.reduce((sum, item) => {
    const producto = productos.find((p) => p.id === item.productoId);
    const cantidad = Number(item.cantidad) || 0;
    return sum + (producto ? producto.precioUnitario * cantidad : 0);
  }, 0);

  async function onSubmit(values: VentaFormValues) {
    const cliente = clientes.find((c) => c.codigo === values.clienteId);
    try {
      const venta = await apiPost<Venta>("/ventas", {
        clienteId: values.clienteId,
        vendedorId,
        items: values.items,
      });

      if (venta.estado === "EN_REVISION") {
        toast.warning("Venta enviada a revisión", {
          description: `${cliente?.nombre} tiene facturas pendientes o vencidas. Un aprobador debe revisar esta venta antes de generar el despacho.`,
        });
      } else {
        toast.success("Venta aprobada automáticamente", {
          description: `${cliente?.nombre} no tiene facturas pendientes. Ya se puede generar el despacho desde "Nuevo despacho".`,
        });
      }
      router.push(`/ventas/${venta.id}`);
      router.refresh();
    } catch (err) {
      toast.error("No se pudo registrar la venta", {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <NumberedCard number={1} title="Cliente" helpText="Si el cliente tiene facturas pendientes o vencidas, la venta pasará a revisión en vez de aprobarse automáticamente.">
        <div className="space-y-2">
          <Label htmlFor="clienteId">Cliente</Label>
          <Controller
            control={control}
            name="clienteId"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id="clienteId" className="w-full">
                  <SelectValue placeholder="Selecciona un cliente" />
                </SelectTrigger>
                <SelectContent>
                  {clientes.map((c) => (
                    <SelectItem key={c.codigo} value={c.codigo}>
                      {c.codigo} — {c.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
          {errors.clienteId && <p className="text-xs text-destructive">{errors.clienteId.message}</p>}

          {clienteId && (
            <div className="pt-1">
              {facturasPendientesCliente.length > 0 ? (
                <StatusBadge
                  tone="warning"
                  label={`${facturasPendientesCliente.length} factura(s) pendiente(s) — esta venta requerirá revisión`}
                />
              ) : (
                <StatusBadge tone="success" label="Sin facturas pendientes — se aprobaría automáticamente" />
              )}
            </div>
          )}
        </div>
      </NumberedCard>

      <NumberedCard number={2} title="Productos">
        <div className="space-y-3">
          {fields.length === 0 && (
            <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
              No hay productos agregados. Usa &quot;Agregar producto&quot; para empezar.
            </p>
          )}
          {fields.map((field, index) => {
            const productoId = items[index]?.productoId;
            const producto = productos.find((p) => p.id === productoId);
            const cantidad = Number(items[index]?.cantidad) || 0;
            const disponible = productoId ? stockDisponible(productoId) : null;
            const superaStock = disponible !== null && cantidad > disponible;
            return (
              <div key={field.id} className="flex flex-col gap-2 rounded-lg border border-border p-3 sm:flex-row sm:items-end">
                <div className="flex-1 space-y-1.5">
                  <Label>Producto</Label>
                  <Controller
                    control={control}
                    name={`items.${index}.productoId`}
                    render={({ field: selectField }) => (
                      <Select value={selectField.value} onValueChange={selectField.onChange}>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Selecciona un producto" />
                        </SelectTrigger>
                        <SelectContent>
                          {productos.map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.nombre} — {formatDualCurrency(p.precioUnitario)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                  {disponible !== null && (
                    <p className={`text-xs ${superaStock ? "text-warning" : "text-muted-foreground"}`}>
                      Disponible en almacén: {disponible}
                    </p>
                  )}
                </div>
                <div className="w-full space-y-1.5 sm:w-28">
                  <Label>Cantidad</Label>
                  <Input
                    type="number"
                    min={1}
                    {...register(`items.${index}.cantidad`, { valueAsNumber: true })}
                  />
                </div>
                <div className="w-full text-sm leading-tight text-muted-foreground sm:w-32 sm:text-right">
                  {producto ? (
                    <>
                      <p>{formatCurrency(producto.precioUnitario * cantidad)}</p>
                      <p className="text-xs">{formatBs(producto.precioUnitario * cantidad)}</p>
                    </>
                  ) : (
                    "—"
                  )}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => remove(index)}
                  aria-label="Quitar producto"
                >
                  <Trash2Icon />
                </Button>
                {superaStock && (
                  <p className="w-full text-xs text-warning sm:order-last">
                    ⚠ Pide {cantidad - disponible} más de lo que hay en almacén — la venta se registra igual; el
                    despacho se ajustará a lo disponible.
                  </p>
                )}
              </div>
            );
          })}
          {(errors.items?.root?.message ?? errors.items?.message) && (
            <p className="text-xs text-destructive">{errors.items?.root?.message ?? errors.items?.message}</p>
          )}

          <Button type="button" variant="outline" size="sm" onClick={() => append({ productoId: "", cantidad: 1 })}>
            <PlusIcon />
            Agregar producto
          </Button>
        </div>
      </NumberedCard>

      <div className="flex items-center justify-between rounded-lg border border-border bg-card p-4">
        <div>
          <p className="text-sm text-muted-foreground">Total de la venta</p>
          <p className="text-2xl font-bold text-foreground">{formatCurrency(total)}</p>
          <p className="text-sm text-muted-foreground">{formatBs(total)}</p>
        </div>
        <Button type="submit" disabled={isSubmitting}>
          Registrar venta
        </Button>
      </div>
    </form>
  );
}
