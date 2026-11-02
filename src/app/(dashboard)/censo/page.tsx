import { PageHeader } from "@/components/layout/page-header";
import { FiltrosDelCenso } from "@/components/modules/censo/filtros-censo";
import { MaestraDialog } from "@/components/modules/censo/maestra-dialog";
import { TableroDelCenso } from "@/components/modules/censo/tablero-censo";
import { apiGet } from "@/lib/api-client";
import { leerFiltrosCenso, queryCenso, type ListaCensos, type TableroCenso } from "@/lib/censo";
import type { DefinicionFormulario } from "@/lib/formulario/motor";
import { getUsuarioActual } from "@/lib/session";

type Params = Record<string, string | string[] | undefined>;

/** Tablero del censo de clientes. ADMIN y SUPERVISOR (este solo mira: sin
 * cargar la maestra ni descartar duplicados). Lo aplica
 * (dashboard)/layout.tsx y, de verdad, la API. */
export default async function CensosPage({ searchParams }: { searchParams: Promise<Params> }) {
  const filtros = leerFiltrosCenso(await searchParams);
  const [tablero, lista, definicion, usuario] = await Promise.all([
    apiGet<TableroCenso>(`/censo/tablero?${queryCenso(filtros, false)}`),
    apiGet<ListaCensos>(`/censo?${queryCenso(filtros)}`),
    // Para mostrar la encuesta completa en el popup del mapa.
    apiGet<DefinicionFormulario>("/censo/formulario"),
    getUsuarioActual(),
  ]);
  const esAdmin = usuario?.rol === "ADMIN";
  return (
    <div className="space-y-6">
      <PageHeader
        title="Censo de clientes"
        subtitle="Lo que censan los vendedores: indicadores, avance contra la maestra de clientes y alertas."
        actions={esAdmin ? <MaestraDialog /> : undefined}
      />
      <FiltrosDelCenso filtros={filtros} opciones={lista.opciones} />
      <TableroDelCenso tablero={tablero} lista={lista} filtros={filtros} definicion={definicion} esAdmin={esAdmin} />
    </div>
  );
}
