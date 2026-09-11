import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { CargarVentasDialog } from "@/components/modules/indicadores/cargar-ventas-dialog";
import { CargasHistorial } from "@/components/modules/indicadores/cargas-historial";
import { apiGet } from "@/lib/api-client";
import { EMPRESAS, empresaDeParams, type CargaVenta, type SearchParams } from "@/lib/indicadores";

export default async function CargasVentasPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const empresa = empresaDeParams(await searchParams);
  const cargas = await apiGet<CargaVenta[]>(`/indicadores/cargas?empresa=${empresa}`);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Cargas de ventas"
        subtitle="Cada archivo subido queda registrado. Revertir una carga la saca de los indicadores y devuelve lo que había reemplazado."
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href={`/indicadores?empresa=${empresa}`}>
                <ArrowLeftIcon />
                Indicadores
              </Link>
            </Button>
            <CargarVentasDialog empresa={empresa} />
          </>
        }
      />

      <div className="flex gap-2">
        {EMPRESAS.map((e) => (
          <Button key={e} size="sm" variant={e === empresa ? "default" : "outline"} asChild>
            <Link href={`/indicadores/cargas?empresa=${e}`}>{e}</Link>
          </Button>
        ))}
      </div>

      <CargasHistorial cargas={cargas} />
    </div>
  );
}
