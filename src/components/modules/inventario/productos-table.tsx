"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { useRouter } from "next/navigation";
import { DataTable } from "@/components/shared/data-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CATEGORIA_PRODUCTO_META, formatBs, formatCurrency } from "@/lib/constants";
import type { Producto } from "@/lib/mock-data";

export type ProductoConStock = Producto & { stockTotal: number; stockBajo: boolean };

const FILTERS = [
  { value: "todos", label: "Todos" },
  { value: "HELADO", label: "Helados" },
  { value: "PIZZA", label: "Pizzas" },
  { value: "bajo", label: "Stock bajo" },
] as const;

export function ProductosTable({ productos }: { productos: ProductoConStock[] }) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["value"]>("todos");
  const router = useRouter();

  const filtered = useMemo(() => {
    if (filter === "todos") return productos;
    if (filter === "bajo") return productos.filter((p) => p.stockBajo);
    return productos.filter((p) => p.categoria === filter);
  }, [productos, filter]);

  const columns: ColumnDef<ProductoConStock>[] = [
    {
      accessorKey: "sku",
      header: "SKU",
      cell: ({ row }) => <span className="font-mono text-xs text-muted-foreground">{row.original.sku}</span>,
    },
    {
      accessorKey: "nombre",
      header: "Producto",
      cell: ({ row }) => (
        <Link href={`/inventario/${row.original.id}`} className="font-medium hover:underline">
          {row.original.nombre}
        </Link>
      ),
    },
    {
      accessorKey: "categoria",
      header: "Categoría",
      cell: ({ row }) => <StatusBadge {...CATEGORIA_PRODUCTO_META[row.original.categoria]} />,
    },
    { accessorKey: "subcategoria", header: "Subcategoría" },
    {
      accessorKey: "stockTotal",
      header: "Stock total",
      cell: ({ row }) => <span>{row.original.stockTotal.toLocaleString("es-VE")} {row.original.unidadMedida}</span>,
    },
    {
      id: "estadoStock",
      header: "Estado de stock",
      cell: ({ row }) =>
        row.original.stockBajo ? (
          <StatusBadge label="Stock bajo" tone="warning" />
        ) : (
          <StatusBadge label="Stock ok" tone="success" />
        ),
    },
    {
      accessorKey: "precioUnitario",
      header: "Precio",
      cell: ({ row }) => (
        <div className="leading-tight">
          <p>{formatCurrency(row.original.precioUnitario)}</p>
          <p className="text-xs text-muted-foreground">{formatBs(row.original.precioUnitario)}</p>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <Tabs value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
        <TabsList>
          {FILTERS.map((f) => (
            <TabsTrigger key={f.value} value={f.value}>
              {f.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <DataTable
        columns={columns}
        data={filtered}
        onRowClick={(producto) => router.push(`/inventario/${producto.id}`)}
        emptyMessage="No hay productos que coincidan con este filtro."
      />
    </div>
  );
}
