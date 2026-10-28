import { ClockIcon, PackageCheckIcon, TruckIcon, WeightIcon } from "lucide-react";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/** Respuesta de GET /reportes/resumen (ver backend/app/api/reportes.py). */
export type ResumenRendimiento = {
  dias: number;
  entregas: number;
  kgEntregados: number;
  paradasMedidas: number;
  promedioAtencionMin?: number | null;
  promedioTrasladoMin?: number | null;
  porConductor: {
    conductor?: string | null;
    placa: string;
    viajes: number;
    entregas: number;
    distanciaKm: number;
    /** Paradas que el repartidor marcó «No se pudo entregar». */
    noEntregados: number;
    /** Despachos de sus rutas que reversó la oficina (no cuentan contra él). */
    reversadosOficina: number;
  }[];
};

function minutos(valor?: number | null) {
  return valor == null ? "—" : `${valor.toLocaleString("es-VE", { maximumFractionDigits: 1 })} min`;
}

/** Rendimiento del reparto en el dashboard. Los promedios salen de las dos
 * marcas que pone el repartidor en la calle (llegada y entrega), así que
 * están vacíos hasta que se cierren viajes con ese flujo. */
export function RendimientoReparto({ resumen }: { resumen: ResumenRendimiento }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={PackageCheckIcon}
          label={`Entregas (${resumen.dias} días)`}
          value={String(resumen.entregas)}
          tone="success"
        />
        <StatCard
          icon={WeightIcon}
          label={`Kg entregados (${resumen.dias} días)`}
          value={resumen.kgEntregados.toLocaleString("es-VE", { maximumFractionDigits: 0 })}
          tone="info"
        />
        <StatCard
          icon={ClockIcon}
          label="Promedio en el cliente"
          value={minutos(resumen.promedioAtencionMin)}
          tone="primary"
        />
        <StatCard
          icon={TruckIcon}
          label="Promedio de traslado"
          value={minutos(resumen.promedioTrasladoMin)}
          tone="warning"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Rendimiento por conductor</CardTitle>
        </CardHeader>
        <CardContent>
          {resumen.porConductor.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Todavía no hay viajes en los últimos {resumen.dias} días.
            </p>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Conductor</TableHead>
                    <TableHead>Vehículo</TableHead>
                    <TableHead className="text-right">Viajes</TableHead>
                    <TableHead className="text-right">Entregas</TableHead>
                    <TableHead className="text-right">Distancia</TableHead>
                    <TableHead className="text-right">No entregados</TableHead>
                    <TableHead className="text-right">Reversados por la oficina</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {resumen.porConductor.map((c) => (
                    <TableRow key={c.placa}>
                      <TableCell className="font-medium">
                        {c.conductor ?? <span className="text-muted-foreground">Sin asignar</span>}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{c.placa}</TableCell>
                      <TableCell className="text-right">{c.viajes}</TableCell>
                      <TableCell className="text-right">{c.entregas}</TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {c.distanciaKm.toLocaleString("es-VE", { maximumFractionDigits: 1 })} km
                      </TableCell>
                      <TableCell className="text-right">
                        {c.noEntregados > 0 ? (
                          <StatusBadge tone="warning" label={String(c.noEntregados)} />
                        ) : (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">{c.reversadosOficina}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <p className="mt-3 text-xs text-muted-foreground">
                «No entregados»: paradas que el repartidor marcó «No se pudo entregar». «Reversados por la
                oficina»: despachos que sacó de sus rutas el coordinador (por ejemplo, una ruta cancelada); no
                cuentan contra el repartidor. Los motivos están en la hoja «Reversos» del Excel de rutas.
              </p>
              {resumen.paradasMedidas === 0 && (
                <p className="mt-3 text-xs text-muted-foreground">
                  Los promedios de tiempo aparecerán cuando los repartidores marquen la llegada y la
                  entrega en cada parada desde el módulo Despachador.
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
