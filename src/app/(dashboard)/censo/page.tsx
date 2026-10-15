import { PageHeader } from "@/components/layout/page-header";
import { FiltrosDelCenso } from "@/components/modules/censo/filtros-censo";
import { ImportarSurvey123Dialog } from "@/components/modules/censo/importar-survey123-dialog";
import { MaestraDialog } from "@/components/modules/censo/maestra-dialog";
import { TableroDelCenso } from "@/components/modules/censo/tablero-censo";
import { apiGet } from "@/lib/api-client";
import { leerFiltrosCenso, queryCenso, type ListaCensos, type TableroCenso } from "@/lib/censo";

type Params = Record<string, string | string[] | undefined>;

/** Tablero del censo de clientes. Solo ADMIN: lo aplica
 * (dashboard)/layout.tsx y, de verdad, la API. */
export default async function CensosPage({ searchParams }: { searchParams: Promise<Params> }) {
  const filtros = leerFiltrosCenso(await searchParams);
  const [tablero, lista] = await Promise.all([
    apiGet<TableroCenso>(`/censo/tablero?${queryCenso(filtros, false)}`),
    apiGet<ListaCensos>(`/censo?${queryCenso(filtros)}`),
  ]);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Censo de clientes"
        subtitle="Lo que censan los vendedores: indicadores, avance contra la maestra de clientes y alertas."
        actions={
          <div className="flex flex-wrap gap-2">
            <MaestraDialog />
            <ImportarSurvey123Dialog />
          </div>
        }
      />
      <FiltrosDelCenso filtros={filtros} opciones={lista.opciones} />
      <TableroDelCenso tablero={tablero} lista={lista} filtros={filtros} />
    </div>
  );
}
