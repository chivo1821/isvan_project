import { PageHeader } from "@/components/layout/page-header";
import { ListaDeCensos } from "@/components/modules/censo/lista-censos";
import { ImportarSurvey123Dialog } from "@/components/modules/censo/importar-survey123-dialog";
import { MaestraDialog } from "@/components/modules/censo/maestra-dialog";
import { apiGet } from "@/lib/api-client";
import { leerFiltrosCenso, queryCenso, type ListaCensos } from "@/lib/censo";

type Params = Record<string, string | string[] | undefined>;

/** Revisión del censo de clientes. Solo ADMIN: lo aplica
 * (dashboard)/layout.tsx y, de verdad, la API. */
export default async function CensosPage({ searchParams }: { searchParams: Promise<Params> }) {
  const filtros = leerFiltrosCenso(await searchParams);
  const datos = await apiGet<ListaCensos>(`/censo?${queryCenso(filtros)}`);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Censo de clientes"
        subtitle="Los censos que envían los vendedores desde la app, con su ubicación y sus fotos."
        actions={
          <div className="flex flex-wrap gap-2">
            <MaestraDialog />
            <ImportarSurvey123Dialog />
          </div>
        }
      />
      <ListaDeCensos datos={datos} filtros={filtros} />
    </div>
  );
}
