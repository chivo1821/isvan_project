"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/shared/data-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { ESTADO_DESPACHO_META, formatDate } from "@/lib/constants";
import type { DespachoConDetalle } from "@/lib/mock-data";

export function DespachosTable({ despachos }: { despachos: DespachoConDetalle[] }) {
  const router = useRouter();

  const columns: ColumnDef<DespachoConDetalle>[] = [
    {
      accessorKey: "numero",
      header: "N° Despacho",
      cell: ({ row }) => (
        <Link href={`/despachos/${row.original.id}`} className="font-medium hover:underline">
          {row.original.numero}
        </Link>
      ),
    },
    { id: "origen", header: "Origen", accessorFn: (row) => row.origen.nombre },
    {
      id: "destino",
      header: "Destino",
      accessorFn: (row) => row.destinoCliente.nombre,
      cell: ({ row }) => (
        <div>
          <p>{row.original.destinoCliente.nombre}</p>
          <p className="text-xs text-muted-foreground">{row.original.destinoCliente.ciudad}</p>
        </div>
      ),
    },
    {
      accessorKey: "fechaCreacion",
      header: "Fecha",
      cell: ({ row }) => formatDate(row.original.fechaCreacion),
    },
    {
      id: "creadoPor",
      header: "Creado por",
      accessorFn: (row) => row.creadoPor.nombre,
    },
    {
      accessorKey: "estado",
      header: "Estado",
      cell: ({ row }) => <StatusBadge {...ESTADO_DESPACHO_META[row.original.estado]} />,
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={despachos}
      onRowClick={(despacho) => router.push(`/despachos/${despacho.id}`)}
      emptyMessage="No hay despachos registrados."
    />
  );
}
