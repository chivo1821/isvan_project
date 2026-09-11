import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatDateTime, formatNumero, formatUsd } from "@/lib/constants";
import { formatMes } from "@/lib/indicadores";
import type { RendimientoVendedores } from "@/lib/vendedor";

/** Cómo va cada vendedor esta semana: a cuántos de sus clientes atendió,
 * cuánto tarda en cada uno y si las visitas se hicieron en el cliente. */
export function RendimientoVendedoresCard({ rendimiento: r }: { rendimiento: RendimientoVendedores }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Rendimiento por vendedor</CardTitle>
        <CardDescription>
          Visitas de la semana del {formatDate(r.semana)}
          {r.mesVenta && ` · venta de sus rutas en ${formatMes(r.mesVenta)}`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {r.porVendedor.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Todavía no hay vendedores. Créalos en Usuarios con el rol Vendedor y asígnales sus rutas de venta.
          </p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Vendedor</TableHead>
                    <TableHead>Rutas</TableHead>
                    <TableHead className="text-right">Atendidos</TableHead>
                    <TableHead className="text-right">Visitas</TableHead>
                    <TableHead className="text-right">Prom. en el cliente</TableHead>
                    <TableHead className="text-right">Lejos del cliente</TableHead>
                    <TableHead>Última visita</TableHead>
                    <TableHead className="text-right">Venta del mes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {r.porVendedor.map((v) => (
                    <TableRow key={v.vendedorId}>
                      <TableCell className="font-medium">{v.nombre}</TableCell>
                      <TableCell>
                        {v.rutas.length > 0 ? (
                          <span className="text-muted-foreground">{v.rutas.join(", ")}</span>
                        ) : (
                          <StatusBadge tone="warning" label="Sin rutas" />
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {v.clientesAtendidos} / {v.clientesAsignados}
                        {v.coberturaPct != null && (
                          <span className="ml-1 text-xs text-muted-foreground">
                            ({formatNumero(v.coberturaPct, 1)} %)
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">{v.visitas}</TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {v.promedioMinEnCliente != null ? `${formatNumero(v.promedioMinEnCliente, 1)} min` : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        {v.visitasLejos > 0 ? (
                          <StatusBadge tone="warning" label={String(v.visitasLejos)} />
                        ) : (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {v.ultimaVisita ? formatDateTime(v.ultimaVisita) : "—"}
                      </TableCell>
                      <TableCell className="text-right">{formatUsd(v.ventaNetaMes)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              «Lejos del cliente»: la ubicación del teléfono al empezar la visita quedó a más de {r.distanciaMaxM} m
              de la del cliente en el maestro.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
