import { BikeIcon, BanknoteIcon, MapPinnedIcon, PackageCheckIcon } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { DescargarReporteButton } from "@/components/shared/descargar-reporte-button";
import { Card, CardContent } from "@/components/ui/card";
import { DetalleParadas } from "@/components/modules/delivery/detalle-paradas";
import { FiltrosDeliveryBarra } from "@/components/modules/delivery/filtros-delivery";
import { ResumenMotorizados } from "@/components/modules/delivery/resumen-motorizados";
import { TabuladorDialog } from "@/components/modules/delivery/tabulador-dialog";
import { apiGet } from "@/lib/api-client";
import { formatNumero, formatUsd } from "@/lib/constants";
import {
  hoyCaracas,
  leerFiltros,
  queryDelivery,
  type ResumenDelivery,
  type SearchParams,
} from "@/lib/delivery";

// Solo ADMIN: lo aplica (dashboard)/layout.tsx y, de verdad, la API.
export default async function DeliveryPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const filtros = leerFiltros(await searchParams, hoyCaracas());
  const resumen = await apiGet<ResumenDelivery>(`/delivery/resumen?${queryDelivery(filtros)}`);
  const { totales } = resumen;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Delivery en moto"
        subtitle="Lo que hay que pagarle a cada motorizado, según la distancia del almacén al cliente. Se paga una vez por cliente visitado, y solo las entregas marcadas."
        actions={
          <>
            <TabuladorDialog tabulador={resumen.tabulador} />
            <DescargarReporteButton
              reporte="delivery"
              query={`desde=${filtros.desde}&hasta=${filtros.hasta}`}
            />
          </>
        }
      />

      <FiltrosDeliveryBarra filtros={filtros} motorizados={resumen.motorizados} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={BanknoteIcon}
          label="Total del período"
          value={formatUsd(totales.totalUsd, 2)}
          trend={`${formatUsd(totales.pendienteUsd, 2)} pendientes de pago`}
          tone="primary"
        />
        <StatCard
          icon={PackageCheckIcon}
          label="Entregas pagables"
          value={formatNumero(totales.entregas)}
          trend={`${formatNumero(totales.despachos)} documentos`}
          tone="success"
        />
        <StatCard
          icon={MapPinnedIcon}
          label="Kilómetros"
          value={formatNumero(totales.km, 1)}
          trend={totales.promedioUsd != null ? `${formatUsd(totales.promedioUsd, 2)} por entrega` : undefined}
          tone="info"
        />
        <StatCard
          icon={BikeIcon}
          label="Motorizados"
          value={formatNumero(resumen.porMotorizado.length)}
          trend={
            totales.sinDistancia > 0
              ? `${formatNumero(totales.sinDistancia)} entregas sin distancia calculada`
              : "todas las entregas con distancia"
          }
          tone={totales.sinDistancia > 0 ? "warning" : "info"}
        />
      </div>

      {totales.entregas === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <BikeIcon className="size-10 text-muted-foreground" />
            <p className="font-medium">No hay entregas en moto en este período</p>
            <p className="max-w-md text-sm text-muted-foreground">
              Se paga por cada cliente visitado en una ruta de moto, cuando el motorizado marca la entrega desde el
              módulo Despachador. Prueba con otro período o revisa que las rutas se hayan armado con una moto.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <ResumenMotorizados resumen={resumen} paradas={resumen.paradas} />
          <DetalleParadas paradas={resumen.paradas} />
        </>
      )}
    </div>
  );
}
