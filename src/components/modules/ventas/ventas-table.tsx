"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/shared/data-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { ESTADO_VENTA_META, formatBs, formatCurrency, formatDate } from "@/lib/constants";
import type { VentaConDetalle } from "@/lib/mock-data";

export function VentasTable({ ventas }: { ventas: VentaConDetalle[] }) {
  const router = useRouter();

  const columns: ColumnDef<VentaConDetalle>[] = [
    {
      accessorKey: "numero",
      header: "N° Venta",
      cell: ({ row }) => (
        <Link href={`/ventas/${row.original.id}`} className="font-medium hover:underline">
          {row.original.numero}
        </Link>
      ),
    },
    {
      id: "cliente",
      header: "Cliente",
      accessorFn: (row) => row.cliente.nombre,
      cell: ({ row }) => (
        <div>
          <p>{row.original.cliente.nombre}</p>
          <p className="text-xs text-muted-foreground">{row.original.cliente.codigo}</p>
        </div>
      ),
    },
    {
      accessorKey: "fecha",
      header: "Fecha",
      cell: ({ row }) => formatDate(row.original.fecha),
    },
    {
      accessorKey: "estado",
      header: "Estado",
      cell: ({ row }) => <StatusBadge {...ESTADO_VENTA_META[row.original.estado]} />,
    },
    {
      accessorKey: "total",
      header: "Total",
      cell: ({ row }) => (
        <div className="leading-tight">
          <p className="font-medium">{formatCurrency(row.original.total)}</p>
          <p className="text-xs text-muted-foreground">{formatBs(row.original.total, row.original.tasaBcv)}</p>
        </div>
      ),
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={ventas}
      onRowClick={(venta) => router.push(`/ventas/${venta.id}`)}
      emptyMessage="No hay ventas registradas."
    />
  );
}
