import { DownloadIcon } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { CargarGastosDialog } from "@/components/modules/gastos/cargar-gastos-dialog";
import { CargasGastos } from "@/components/modules/gastos/cargas-gastos";
import { EstadoResultados } from "@/components/modules/gastos/estado-resultados";
import { FiltrosGastosBarra } from "@/components/modules/gastos/filtros-gastos";
import { ListaGastos } from "@/components/modules/gastos/lista-gastos";
import { API_URL, apiGet } from "@/lib/api-client";
import {
  leerFiltrosGastos,
  queryApiGastos,
  type CargaGasto,
  type ListaGastos as Lista,
  type Resultados,
} from "@/lib/gastos";
import type { SearchParams } from "@/lib/indicadores";

export default async function GastosPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const filtros = leerFiltrosGastos(await searchParams);

  let contenido: React.ReactNode;
  if (filtros.vista === "gastos") {
    const datos = await apiGet<Lista>(`/gastos?${queryApiGastos(filtros, true)}`);
    contenido = <ListaGastos datos={datos} filtros={filtros} />;
  } else if (filtros.vista === "cargas") {
    const cargas = await apiGet<CargaGasto[]>(`/gastos/cargas?empresa=${filtros.empresa}`);
    contenido = <CargasGastos cargas={cargas} />;
  } else {
    const datos = await apiGet<Resultados>(`/gastos/resultados?${queryApiGastos(filtros)}`);
    contenido = <EstadoResultados datos={datos} />;
  }

  return (
    <div className="min-w-0 space-y-6">
      <PageHeader
        title="Resultados y gastos"
        subtitle="El resultado de las operaciones por mes: la venta neta, menos lo que costó lo vendido, menos los gastos cargados desde Excel."
        actions={
          <>
            <Button variant="outline" asChild>
              <a href={`${API_URL}/gastos/plantilla`}>
                <DownloadIcon />
                Plantilla
              </a>
            </Button>
            <CargarGastosDialog key={filtros.empresa} empresaInicial={filtros.empresa === "TODAS" ? undefined : filtros.empresa} />
          </>
        }
      />
      <FiltrosGastosBarra key={`${filtros.desde}-${filtros.hasta}`} filtros={filtros} />
      {contenido}
    </div>
  );
}
