"use client";

import { useState, type ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatNumero, formatUsd } from "@/lib/constants";
import { formatFecha, type BrechasClientes as Brechas } from "@/lib/indicadores";
import { ItemMovil, ListaMovil } from "./item-movil";

function Lista({ explicacion, total, mostrados, movil, children }: {
  explicacion: ReactNode;
  total: number;
  mostrados: number;
  /** Las mismas filas para el teléfono (ItemMovil). */
  movil: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">{explicacion}</p>
      {total > 0 && (
        <>
          <ListaMovil>{movil}</ListaMovil>
          <div className="hidden max-h-96 overflow-auto rounded-lg border border-border sm:block">
            <Table>{children}</Table>
          </div>
        </>
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
  const [vista, setVista] = useState("fuera");
  const pestanas = [
    { valor: "fuera", texto: `Compran y no están en logística (${formatNumero(fuera.total)})` },
    { valor: "sin-compras", texto: `Sin compras (${formatNumero(sinCompras.total)})` },
    { valor: "ruta", texto: `Ruta distinta (${formatNumero(rutaDistinta.total)})` },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Clientes: ventas frente a logística</CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs value={vista} onValueChange={setVista}>
          {/* En el teléfono las tres pestañas no caben en una línea: ahí se
              elige la lista con un desplegable. */}
          <Select value={vista} onValueChange={setVista}>
            <SelectTrigger className="w-full sm:hidden" aria-label="Lista de clientes">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {pestanas.map((p) => (
                <SelectItem key={p.valor} value={p.valor}>
                  {p.texto}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <TabsList className="hidden sm:inline-flex">
            {pestanas.map((p) => (
              <TabsTrigger key={p.valor} value={p.valor}>
                {p.texto}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="fuera" className="pt-2">
            <Lista
              total={fuera.total}
              mostrados={fuera.clientes.length}
              movil={fuera.clientes.map((c) => (
                <ItemMovil
                  key={c.codigo}
                  nombre={c.nombre ?? "—"}
                  detalle={[c.codigo, c.ruta, c.tipo].filter(Boolean).join(" · ")}
                  valor={formatUsd(c.ventaNeta)}
                  valorDetalle={formatFecha(c.ultimaCompra)}
                />
              ))}
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
              movil={sinCompras.clientes.map((c) => (
                <ItemMovil
                  key={c.codigo}
                  nombre={c.nombre}
                  detalle={[c.codigo, c.ciudad].filter(Boolean).join(" · ")}
                  valor={c.rutaComercial ?? "—"}
                  valorDetalle="ruta comercial"
                />
              ))}
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
              movil={rutaDistinta.clientes.map((c) => (
                <ItemMovil
                  key={c.codigo}
                  nombre={c.nombre}
                  detalle={c.codigo}
                  valor={`Venta: ${c.rutaVenta}`}
                  valorDetalle={`Logística: ${c.rutaLogistica ?? "—"}`}
                />
              ))}
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
