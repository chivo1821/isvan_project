import { AlertTriangleIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatNumero, formatUsd } from "@/lib/constants";
import type { ParadaDelivery, ResumenDelivery } from "@/lib/delivery";
import { LiquidarDialog } from "./liquidar-dialog";

/** Cuánto le toca a cada motorizado en el período y el botón para cerrar su
 * pago. Una moto sin repartidor asignado aparece igual, con su placa, para
 * que esas entregas no se pierdan del reporte. */
export function ResumenMotorizados({
  resumen,
  paradas,
}: {
  resumen: ResumenDelivery;
  paradas: ParadaDelivery[];
}) {
  const pendientesPorMotorizado = new Map<string, number>();
  for (const p of paradas) {
    if (p.liquidada || p.montoUsd == null) continue;
    const clave = p.repartidorId ?? `placa:${p.placa}`;
    pendientesPorMotorizado.set(clave, (pendientesPorMotorizado.get(clave) ?? 0) + 1);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pago por motorizado</CardTitle>
      </CardHeader>
      <CardContent>
        {resumen.porMotorizado.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No hay entregas en moto con marca de entrega en este período.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Motorizado</TableHead>
                  <TableHead>Moto</TableHead>
                  <TableHead className="text-right">Entregas</TableHead>
                  <TableHead className="text-right">Documentos</TableHead>
                  <TableHead className="text-right">Km</TableHead>
                  <TableHead className="text-right">Pendiente</TableHead>
                  <TableHead className="text-right">Pagado</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {resumen.porMotorizado.map((m) => {
                  const clave = m.repartidorId ?? `placa:${m.placas[0]}`;
                  return (
                    <TableRow key={clave}>
                      <TableCell className="font-medium">
                        {m.conductor ?? (
                          <span className="text-muted-foreground">
                            Sin chofer asignado
                            <span className="block text-xs">
                              Asígnale un repartidor a la moto en Vehículos → Choferes para poder pagarle.
                            </span>
                          </span>
                        )}
                        {m.sinDistancia > 0 && (
                          <span
                            className="ml-1.5 inline-flex items-center gap-1 text-xs text-warning"
                            title="Sus distancias todavía no se pudieron calcular: esas entregas no tienen monto"
                          >
                            <AlertTriangleIcon className="size-3.5" />
                            {formatNumero(m.sinDistancia)} sin distancia
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{m.placas.join(", ")}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatNumero(m.entregas)}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {formatNumero(m.despachos)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {formatNumero(m.km, 1)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatUsd(m.pendienteUsd, 2)}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {formatUsd(m.liquidadoUsd, 2)}
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">{formatUsd(m.totalUsd, 2)}</TableCell>
                      <TableCell className="text-right">
                        <LiquidarDialog
                          motorizado={m}
                          desde={resumen.desde}
                          hasta={resumen.hasta}
                          entregasPendientes={pendientesPorMotorizado.get(clave) ?? 0}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
