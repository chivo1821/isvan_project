import { BarChart3Icon, RouteIcon } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { ActivacionClientes } from "@/components/modules/indicadores/activacion-clientes";
import { BarraFiltros } from "@/components/modules/indicadores/barra-filtros";
import { DesgloseTabla } from "@/components/modules/indicadores/desglose-tabla";
import { KpiGrid, textoComparacion } from "@/components/modules/indicadores/kpi-grid";
import { MapaVentas } from "@/components/modules/indicadores/mapa-ventas";
import { GraficosVenta } from "@/components/modules/indicadores/serie-chart";
import { apiGet } from "@/lib/api-client";
import {
  hoyCaracas,
  leerFiltros,
  queryApi,
  type OpcionesIndicadoresVendedor,
  type SearchParams,
  type TableroIndicadoresVendedor,
} from "@/lib/indicadores";

function Aviso({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
        <BarChart3Icon className="size-10 text-muted-foreground" />
        <p className="font-medium">{titulo}</p>
        <p className="max-w-md text-sm text-muted-foreground">{children}</p>
      </CardContent>
    </Card>
  );
}

/** Los indicadores de venta de las rutas del vendedor. El backend
 * (app/api/vendedor.py) le pone sus rutas a la fuerza: aunque alguien arme
 * la URL a mano con una ruta ajena, la API responde 403. Aquí además se
 * descartan antes de pedir, para que una URL vieja no rompa la página. */
export default async function IndicadoresVendedorPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const empresaPedida = Array.isArray(params.empresa) ? params.empresa[0] : params.empresa;
  const opciones = await apiGet<OpcionesIndicadoresVendedor>(
    `/vendedor/indicadores/opciones${empresaPedida ? `?empresa=${encodeURIComponent(empresaPedida)}` : ""}`
  );

  if (!("empresa" in opciones)) {
    return (
      <div className="space-y-6">
        <PageHeader title="Indicadores de mis rutas" subtitle="Venta, margen y devoluciones de tus rutas de venta." />
        <Aviso titulo="Todavía no tienes rutas asignadas">
          Cuando el administrador te asigne tus rutas de venta, aquí vas a ver sus indicadores.
        </Aviso>
      </div>
    );
  }

  const { empresa } = opciones;
  const leidos = leerFiltros({ ...params, empresa }, opciones, hoyCaracas());
  const filtros = { ...leidos, rutas: leidos.rutas.filter((r) => opciones.rutas.includes(r)) };
  const tablero =
    opciones.cargasConfirmadas > 0
      ? await apiGet<TableroIndicadoresVendedor>(`/vendedor/indicadores/tablero?${queryApi(filtros)}`)
      : null;
  const actual = tablero?.resumen.actual ?? null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Indicadores de mis rutas"
        subtitle="Venta, margen y devoluciones de tus rutas de venta, a partir del extracto del sistema de ventas. Montos en USD."
      />

      <p className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
        <RouteIcon className="size-4" />
        Tus rutas en {empresa}: <span className="font-medium text-foreground">{opciones.rutas.join(", ")}</span>
      </p>

      <BarraFiltros
        filtros={filtros}
        opciones={opciones}
        disponibles={tablero?.opcionesDisponibles}
        pagina="/vendedor/indicadores"
        empresas={opciones.empresas}
      />

      {!tablero ? (
        <Aviso titulo={`Todavía no hay ventas cargadas de ${empresa}`}>
          Cuando el administrador cargue el extracto del sistema de ventas, aquí vas a ver los indicadores de tus rutas.
        </Aviso>
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

          <GraficosVenta
            serie={tablero.serie}
            proyeccion={tablero.proyeccion}
            filtros={filtros}
            pagina="/vendedor/indicadores"
          />
          <DesgloseTabla desgloses={tablero.desgloses} total={actual?.ventaNeta ?? 0} />
          <MapaVentas mapa={tablero.mapa} />
          {/* key: al cambiar los filtros, las listas vuelven a la primera
              pestaña y al primer tramo. */}
          <ActivacionClientes key={queryApi(filtros)} activacion={tablero.activacion} />
        </>
      )}
    </div>
  );
}
