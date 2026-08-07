import Link from "next/link";
import { ClipboardCheckIcon, PlusIcon } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { DespachosTable } from "@/components/modules/despachos/despachos-table";
import { getDespachosConDetalle, getDespachosPendientesAprobacion } from "@/lib/mock-data";

export default function DespachosPage() {
  const despachos = getDespachosConDetalle().sort((a, b) => (a.fechaCreacion < b.fechaCreacion ? 1 : -1));
  const pendientes = getDespachosPendientesAprobacion().length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Despachos"
        subtitle="Todos los despachos, generados a partir de ventas aprobadas"
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href="/despachos/aprobacion">
                <ClipboardCheckIcon />
                Aprobación de despachos
                {pendientes > 0 && (
                  <span className="ml-1 flex size-5 items-center justify-center rounded-full bg-warning/15 text-xs font-semibold text-warning">
                    {pendientes}
                  </span>
                )}
              </Link>
            </Button>
            <Button asChild>
              <Link href="/despachos/nuevo">
                <PlusIcon />
                Nuevo despacho
              </Link>
            </Button>
          </>
        }
      />
      <DespachosTable despachos={despachos} />
    </div>
  );
}
