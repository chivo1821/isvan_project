"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/shared/data-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { ESTADO_RUTA_META, TIPO_VEHICULO_META, formatDate } from "@/lib/constants";
import type { RutaConDetalle } from "@/lib/mock-data";

export function RutasTable({ rutas }: { rutas: RutaConDetalle[] }) {
  const router = useRouter();

  const columns: ColumnDef<RutaConDetalle>[] = [
    {
      accessorKey: "numero",
      header: "N° Ruta",
      cell: ({ row }) => (
        <Link href={`/rutas/${row.original.id}`} className="font-medium hover:underline">
          {row.original.numero}
        </Link>
      ),
    },
    {
      id: "vehiculo",
      header: "Vehículo",
      accessorFn: (row) => row.vehiculo.placa,
      cell: ({ row }) => (
        <div>
          <p>{row.original.vehiculo.placa}</p>
          <p className="text-xs text-muted-foreground">{TIPO_VEHICULO_META[row.original.vehiculo.tipo].label}</p>
        </div>
      ),
    },
    {
      id: "conductor",
      header: "Conductor",
      accessorFn: (row) => row.conductor ?? "",
      cell: ({ row }) =>
        row.original.conductor ?? <span className="text-xs text-muted-foreground">Sin asignar</span>,
    },
    {
      id: "paradas",
      header: "Paradas",
      accessorFn: (row) => row.despachos.length,
    },
    {
      id: "distancia",
      header: "Distancia",
      cell: ({ row }) =>
        row.original.distanciaTotalKm != null ? `${row.original.distanciaTotalKm.toLocaleString("es-VE")} km` : "—",
    },
    {
      accessorKey: "fechaCreacion",
      header: "Fecha",
      cell: ({ row }) => formatDate(row.original.fechaCreacion),
    },
    {
      accessorKey: "estado",
      header: "Estado",
      cell: ({ row }) => <StatusBadge {...ESTADO_RUTA_META[row.original.estado]} />,
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={rutas}
      onRowClick={(ruta) => router.push(`/rutas/${ruta.id}`)}
      emptyMessage="No hay rutas registradas."
    />
  );
}
