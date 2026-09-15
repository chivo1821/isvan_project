import Link from "next/link";
import { BarChart3Icon, HistoryIcon } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ActivacionClientes } from "@/components/modules/indicadores/activacion-clientes";
import { AlertasCalidad } from "@/components/modules/indicadores/alertas-calidad";
import { BarraFiltros } from "@/components/modules/indicadores/barra-filtros";
import { BrechasClientes } from "@/components/modules/indicadores/brechas-clientes";
import { CargarVentasDialog } from "@/components/modules/indicadores/cargar-ventas-dialog";
import { DesgloseTabla } from "@/components/modules/indicadores/desglose-tabla";
import { KpiGrid, textoComparacion } from "@/components/modules/indicadores/kpi-grid";
import { MapaVentas } from "@/components/modules/indicadores/mapa-ventas";
import { GraficosEvolucion } from "@/components/modules/indicadores/serie-chart";
import { apiGet } from "@/lib/api-client";
import {
  empresaDeParams,
  hoyCaracas,
  leerFiltros,
  queryApi,
  type OpcionesIndicadores,
  type SearchParams,
  type TableroIndicadores,
} from "@/lib/indicadores";

// Solo ADMIN: lo aplica (dashboard)/layout.tsx y, de verdad, la API.
export default async function IndicadoresPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const empresa = empresaDeParams(params);
  const opciones = await apiGet<OpcionesIndicadores>(`/indicadores/opciones?empresa=${empresa}`);
  const filtros = leerFiltros(params, opciones, hoyCaracas());
  const tablero =
    opciones.cargasConfirmadas > 0
      ? await apiGet<TableroIndicadores>(`/indicadores/tablero?${queryApi(filtros)}`)
      : null;
  const actual = tablero?.resumen.actual ?? null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Indicadores de venta"
        subtitle="Venta, margen y devoluciones a partir del extracto del sistema de ventas. Montos en USD."
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href={`/indicadores/cargas?empresa=${empresa}`}>
                <HistoryIcon />
                Cargas y cobertura
              </Link>
            </Button>
            <CargarVentasDialog empresa={empresa} />
          </>
        }
      />

      <BarraFiltros filtros={filtros} opciones={opciones} disponibles={tablero?.opcionesDisponibles} />

      {!tablero ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <BarChart3Icon className="size-10 text-muted-foreground" />
            <p className="font-medium">Todavía no hay ventas cargadas de {empresa}</p>
            <p className="max-w-md text-sm text-muted-foreground">
              Sube el extracto del sistema de ventas (el mensual o uno diario). Antes de que cuente vas a ver una
              validación del archivo: período, totales, productos sin costo, solapes con otras cargas.
            </p>
            <CargarVentasDialog empresa={empresa} />
          </CardContent>
        </Card>
      ) : (
        <>
          {actual ? (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                Cambios {textoComparacion(tablero.resumen.comparacion)}.
              </p>
              <KpiGrid actual={actual} variacion={tablero.resumen.variacion} activacion={tablero.activacion} />
            </div>
          ) : (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                No hay ventas en este período con estos filtros.
              </CardContent>
            </Card>
          )}

          <GraficosEvolucion serie={tablero.serie} filtros={filtros} />
          <DesgloseTabla desgloses={tablero.desgloses} total={actual?.ventaNeta ?? 0} />

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
            <div className="xl:col-span-3">
              <MapaVentas mapa={tablero.mapa} />
            </div>
            <div className="xl:col-span-2">
              <AlertasCalidad alertas={tablero.alertas} ventaNeta={actual?.ventaNeta ?? 0} />
            </div>
          </div>

          <BrechasClientes brechas={tablero.brechas} />
          {/* key: al cambiar los filtros, las listas vuelven a la primera
              pestaña y al primer tramo. */}
          <ActivacionClientes key={queryApi(filtros)} activacion={tablero.activacion} />
        </>
      )}
    </div>
  );
}
