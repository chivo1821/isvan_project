import Link from "next/link";
import { ClipboardCheckIcon, PlusIcon } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { VentasTable } from "@/components/modules/ventas/ventas-table";
import { getVentasConDetalle, getVentasEnRevision } from "@/lib/mock-data";

export default function VentasPage() {
  const ventas = getVentasConDetalle().sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
  const enRevision = getVentasEnRevision().length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Ventas"
        subtitle="Todas las ventas registradas"
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href="/ventas/revision">
                <ClipboardCheckIcon />
                Revisión de ventas
                {enRevision > 0 && (
                  <span className="ml-1 flex size-5 items-center justify-center rounded-full bg-warning/15 text-xs font-semibold text-warning">
                    {enRevision}
                  </span>
                )}
              </Link>
            </Button>
            <Button asChild>
              <Link href="/ventas/nueva">
                <PlusIcon />
                Nueva venta
              </Link>
            </Button>
          </>
        }
      />
      <VentasTable ventas={ventas} />
    </div>
  );
}
