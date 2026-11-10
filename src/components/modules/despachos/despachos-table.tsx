"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { SearchIcon } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/shared/data-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { Input } from "@/components/ui/input";
import { coincideBusqueda } from "@/lib/busqueda";
import { ESTADO_DESPACHO_META, documentoDespacho, formatDate } from "@/lib/constants";
import type { DespachoConDetalle } from "@/lib/mock-data";

export function DespachosTable({ despachos }: { despachos: DespachoConDetalle[] }) {
  const router = useRouter();
  // Pedido del cliente: buscar por código o nombre del cliente y por
  // documento (factura o nota de entrega); también por número de despacho.
  const [busqueda, setBusqueda] = useState("");
  const visibles = despachos.filter((d) =>
    coincideBusqueda(busqueda, [
      d.destinoCliente.codigo,
      d.destinoCliente.nombre,
      documentoDespacho(d),
      d.numeroDocumento,
      d.numero,
    ])
  );

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
    { id: "numeroDocumento", header: "Documento", accessorFn: (row) => documentoDespacho(row) },
    { id: "origen", header: "Origen", accessorFn: (row) => row.origen.nombre },
    {
      id: "rutaComercial",
      header: "Ruta cliente",
      accessorFn: (row) => row.destinoCliente.rutaComercial ?? "",
      cell: ({ row }) =>
        row.original.destinoCliente.rutaComercial ? (
          <StatusBadge tone="neutral" label={row.original.destinoCliente.rutaComercial} />
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      id: "destino",
      header: "Destino",
      accessorFn: (row) => row.destinoCliente.nombre,
      cell: ({ row }) => (
        <div>
          <p>{row.original.destinoCliente.nombre}</p>
          <p className="text-xs text-muted-foreground">
            cód. {row.original.destinoCliente.codigo} · {row.original.destinoCliente.ciudad}
          </p>
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
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <div className="relative w-full sm:max-w-sm">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por código o nombre del cliente, o documento"
            aria-label="Buscar despachos"
            className="pl-8"
          />
        </div>
        {busqueda.trim() && (
          <p className="text-xs text-muted-foreground">
            {visibles.length} de {despachos.length} despacho(s)
          </p>
        )}
      </div>
      <DataTable
        columns={columns}
        data={visibles}
        onRowClick={(despacho) => router.push(`/despachos/${despacho.id}`)}
        emptyMessage={
          busqueda.trim() ? `Ningún despacho coincide con «${busqueda.trim()}».` : "No hay despachos registrados."
        }
      />
    </div>
  );
}
