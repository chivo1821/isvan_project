import { BanknoteIcon, BikeIcon, CircleCheckIcon, ClockIcon, MapPinnedIcon } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DetalleParadas } from "@/components/modules/delivery/detalle-paradas";
import { FiltrosDeliveryBarra } from "@/components/modules/delivery/filtros-delivery";
import { apiGet } from "@/lib/api-client";
import { formatDate, formatNumero, formatUsd } from "@/lib/constants";
import {
  hoyCaracas,
  leerFiltros,
  textoRango,
  type MiCuentaDelivery,
  type SearchParams,
} from "@/lib/delivery";

/** El estado de cuenta del repartidor: lo que le toca cobrar por sus
 * entregas en moto y lo que ya le pagaron. Siempre el de su sesión: la API
 * no recibe un repartidor, así que no puede ver el de otro ni cambiarlo. Solo
 * se elige el período. */
export default async function MiCuentaPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const filtros = leerFiltros(await searchParams, hoyCaracas());
  const cuenta = await apiGet<MiCuentaDelivery>(`/delivery/mi-cuenta?desde=${filtros.desde}&hasta=${filtros.hasta}`);
  const { totales } = cuenta;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Mi estado de cuenta"
        subtitle={`${cuenta.repartidor}${cuenta.placa ? ` · ${cuenta.placa}` : ""} · lo que te toca cobrar por tus entregas en moto y lo que ya te pagaron`}
      />

      <FiltrosDeliveryBarra filtros={{ ...filtros, repartidor: "" }} ruta="/despachador/cuenta" />

      {!cuenta.enMoto && totales.entregas === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <BikeIcon className="size-10 text-muted-foreground" />
            <p className="font-medium">El delivery se paga solo en moto</p>
            <p className="max-w-md text-sm text-muted-foreground">
              Tu vehículo asignado no es una moto, así que no tienes entregas por cobrar en este módulo.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
            <StatCard
              icon={BanknoteIcon}
              label="Total del período"
              value={formatUsd(totales.totalUsd, 2)}
              trend={`${formatNumero(totales.entregas)} entrega(s)`}
              tone="primary"
            />
            <StatCard
              icon={ClockIcon}
              label="Por cobrar"
              value={formatUsd(totales.pendienteUsd, 2)}
              trend="todavía no liquidado"
              tone={totales.pendienteUsd > 0 ? "warning" : "info"}
            />
            <StatCard
              icon={CircleCheckIcon}
              label="Ya pagado"
              value={formatUsd(totales.liquidadoUsd, 2)}
              trend="de este período"
              tone="success"
            />
            <StatCard
              icon={MapPinnedIcon}
              label="Kilómetros"
              value={formatNumero(totales.km, 1)}
              trend={totales.promedioUsd != null ? `${formatUsd(totales.promedioUsd, 2)} por entrega` : undefined}
              tone="info"
            />
          </div>

          {totales.entregas === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
                <BikeIcon className="size-10 text-muted-foreground" />
                <p className="font-medium">No tienes entregas en este período</p>
                <p className="max-w-md text-sm text-muted-foreground">
                  Cada cliente que entregas en una ruta de moto, y que marcas como entregado en el despachador, suma
                  aquí. Prueba con otro período.
                </p>
              </CardContent>
            </Card>
          ) : (
            <DetalleParadas paradas={cuenta.paradas} conMotorizado={false} />
          )}

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Pagos recibidos</CardTitle>
              </CardHeader>
              <CardContent>
                {cuenta.pagos.length === 0 ? (
                  <p className="py-4 text-center text-sm text-muted-foreground">Todavía no tienes pagos registrados.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Pagado el</TableHead>
                          <TableHead>Período</TableHead>
                          <TableHead className="text-right">Entregas</TableHead>
                          <TableHead className="text-right">Monto</TableHead>
                          <TableHead>Nota</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {cuenta.pagos.map((p) => (
                          <TableRow key={p.id} className={p.anuladaEn ? "text-muted-foreground" : undefined}>
                            <TableCell className="whitespace-nowrap">{formatDate(p.creadoEn)}</TableCell>
                            <TableCell className="whitespace-nowrap text-muted-foreground">
                              {formatDate(p.desde)} – {formatDate(p.hasta)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">{formatNumero(p.entregas)}</TableCell>
                            <TableCell
                              className={`text-right font-medium tabular-nums ${p.anuladaEn ? "line-through" : ""}`}
                            >
                              {formatUsd(p.totalUsd, 2)}
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              {/* Anulado: se dio por no hecho y esas entregas volvieron a pendientes. */}
                              {p.anuladaEn ? (
                                <>
                                  <StatusBadge label="Anulado" tone="neutral" />
                                  <span className="mt-0.5 block text-xs">{p.motivoAnulacion}</span>
                                </>
                              ) : (
                                (p.nota ?? "—")
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Cuánto se paga por entrega</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p className="text-muted-foreground">
                  Según la distancia del almacén al cliente. Se paga una vez por cliente visitado, aunque lleve varios
                  documentos.
                </p>
                <ul className="divide-y rounded-md border">
                  {cuenta.tabulador.map((r, i) => (
                    <li key={i} className="flex items-center justify-between px-3 py-2">
                      <span>{textoRango(cuenta.tabulador, i)}</span>
                      <span className="font-medium tabular-nums">{formatUsd(r.montoUsd, 2)}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
