import Link from "next/link";
import { ClipboardCheckIcon, PlusIcon } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { DescargarReporteButton } from "@/components/shared/descargar-reporte-button";
import { DespachosTable } from "@/components/modules/despachos/despachos-table";
import { getDespachosConDetalle, getDespachosPendientesAprobacion } from "@/lib/mock-data";
import { getUsuarioActual } from "@/lib/session";

export default async function DespachosPage() {
  const [despachosSinOrdenar, pendientesLista, usuarioActual] = await Promise.all([
    getDespachosConDetalle(),
    getDespachosPendientesAprobacion(),
    getUsuarioActual(),
  ]);
  const despachos = despachosSinOrdenar.sort((a, b) => (a.fechaCreacion < b.fechaCreacion ? 1 : -1));
  const pendientes = pendientesLista.length;
  const puedeCrear = usuarioActual?.rol === "ADMIN" || usuarioActual?.rol === "DESPACHOS";
  const puedeAprobar = usuarioActual?.rol === "ADMIN" || usuarioActual?.rol === "APROBADOR";
  const puedeDescargar = usuarioActual != null && usuarioActual.rol !== "REPARTIDOR";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Despachos"
        subtitle="Todos los despachos, creados por Excel o carga manual"
        actions={
          <>
            {puedeDescargar && <DescargarReporteButton reporte="despachos" />}
            {puedeAprobar && (
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
            )}
            {puedeCrear && (
              <Button asChild>
                <Link href="/despachos/nuevo">
                  <PlusIcon />
                  Nuevo despacho
                </Link>
              </Button>
            )}
          </>
        }
      />
      <DespachosTable despachos={despachos} />
    </div>
  );
}
