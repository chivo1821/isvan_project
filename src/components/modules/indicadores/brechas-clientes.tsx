import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatNumero, formatUsd } from "@/lib/constants";
import { formatFecha, type BrechasClientes as Brechas } from "@/lib/indicadores";

function Lista({ explicacion, total, mostrados, children }: {
  explicacion: ReactNode;
  total: number;
  mostrados: number;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">{explicacion}</p>
      {total > 0 && (
        <div className="max-h-96 overflow-auto rounded-lg border border-border">
          <Table>{children}</Table>
        </div>
      )}
      {total > mostrados && (
        <p className="text-xs text-muted-foreground">
          Se muestran {mostrados} de {formatNumero(total)}.
        </p>
      )}
    </div>
  );
}

/** Cruce con logística: dónde no coinciden los clientes del sistema de
 * ventas con el maestro de clientes de despacho. */
export function BrechasClientes({ brechas }: { brechas: Brechas }) {
  const { fueraDeLogistica: fuera, sinCompras, rutaDistinta } = brechas;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Clientes: ventas frente a logística</CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="fuera">
          <div className="overflow-x-auto">
            <TabsList>
              <TabsTrigger value="fuera">Compran y no están en logística ({formatNumero(fuera.total)})</TabsTrigger>
              <TabsTrigger value="sin-compras">Sin compras ({formatNumero(sinCompras.total)})</TabsTrigger>
              <TabsTrigger value="ruta">Ruta distinta ({formatNumero(rutaDistinta.total)})</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="fuera" className="pt-2">
            <Lista
              total={fuera.total}
              mostrados={fuera.clientes.length}
              explicacion={
                fuera.total === 0
                  ? "Todos los clientes que compraron en el período están en el maestro de clientes de logística."
                  : `${formatNumero(fuera.total)} clientes compraron ${formatUsd(fuera.ventaNeta)} en el período y no están en el maestro de clientes de logística: no se les puede armar un despacho hasta darlos de alta en Clientes.`
              }
            >
              <TableHeader className="sticky top-0 z-10 bg-card">
                <TableRow>
                  <TableHead>Código</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Ruta</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead className="text-right">Venta neta</TableHead>
                  <TableHead className="text-right">Última compra</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {fuera.clientes.map((c) => (
                  <TableRow key={c.codigo}>
                    <TableCell className="text-muted-foreground">{c.codigo}</TableCell>
                    <TableCell className="font-medium">{c.nombre ?? "—"}</TableCell>
                    <TableCell>{c.ruta ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{c.tipo ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatUsd(c.ventaNeta)}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{formatFecha(c.ultimaCompra)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Lista>
          </TabsContent>

          <TabsContent value="sin-compras" className="pt-2">
            <Lista
              total={sinCompras.total}
              mostrados={sinCompras.clientes.length}
              explicacion={
                sinCompras.total === 0
                  ? "Todos los clientes del maestro de logística compraron en el período."
                  : `${formatNumero(sinCompras.total)} clientes del maestro de logística no tienen compras en el período (sin importar los filtros de ruta, grupo y tipo).`
              }
            >
              <TableHeader className="sticky top-0 z-10 bg-card">
                <TableRow>
                  <TableHead>Código</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Ciudad</TableHead>
                  <TableHead>Ruta comercial</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sinCompras.clientes.map((c) => (
                  <TableRow key={c.codigo}>
                    <TableCell className="text-muted-foreground">{c.codigo}</TableCell>
                    <TableCell className="font-medium">{c.nombre}</TableCell>
                    <TableCell className="text-muted-foreground">{c.ciudad}</TableCell>
                    <TableCell>{c.rutaComercial ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Lista>
          </TabsContent>

          <TabsContent value="ruta" className="pt-2">
            <Lista
              total={rutaDistinta.total}
              mostrados={rutaDistinta.clientes.length}
              explicacion={
                <>
                  {formatNumero(rutaDistinta.total)} de {formatNumero(rutaDistinta.enAmbos)} clientes que están en los
                  dos sistemas tienen en logística una ruta comercial distinta a su ruta de venta
                  {rutaDistinta.sinRutaEnLogistica > 0 &&
                    ` (${formatNumero(rutaDistinta.sinRutaEnLogistica)} no tienen ruta comercial en logística)`}
                  . La ruta comercial se usa para sugerir cómo agrupar despachos.
                </>
              }
            >
              <TableHeader className="sticky top-0 z-10 bg-card">
                <TableRow>
                  <TableHead>Código</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Ruta de venta</TableHead>
                  <TableHead>Ruta en logística</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rutaDistinta.clientes.map((c) => (
                  <TableRow key={c.codigo}>
                    <TableCell className="text-muted-foreground">{c.codigo}</TableCell>
                    <TableCell className="font-medium">{c.nombre}</TableCell>
                    <TableCell>{c.rutaVenta}</TableCell>
                    <TableCell>{c.rutaLogistica ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Lista>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
