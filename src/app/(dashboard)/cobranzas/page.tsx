import Link from "next/link";
import {
  AlertTriangleIcon,
  BanknoteIcon,
  CalendarClockIcon,
  FilterIcon,
  HandCoinsIcon,
  InboxIcon,
  UserCheckIcon,
  UserXIcon,
} from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { GraficoAntiguedad, GraficoVendidoCobrado } from "@/components/modules/cobranzas/graficos-cobranzas";
import { apiGet } from "@/lib/api-client";
import type { ResumenCobranzas, TableroCobranzas } from "@/lib/cobranzas";
import { formatDate, formatNumero, formatPct, formatUsd } from "@/lib/constants";

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const SELECT = "h-9 rounded-md border border-input bg-transparent px-3 text-sm";

export default async function CobranzasTableroPage({ searchParams }: PageProps<"/cobranzas">) {
  const params = await searchParams;
  const leer = (k: string) => (typeof params[k] === "string" ? (params[k] as string) : "");
  const filtros = {
    empresa: ["ISVAN", "TRALOG"].includes(leer("empresa")) ? leer("empresa") : "",
    desde: FECHA.test(leer("desde")) ? leer("desde") : "",
    hasta: FECHA.test(leer("hasta")) ? leer("hasta") : "",
    ruta: leer("ruta").slice(0, 40),
  };
  const query = new URLSearchParams(Object.entries(filtros).filter(([, v]) => v)).toString();
  const [tablero, resumen] = await Promise.all([
    apiGet<TableroCobranzas>(`/cobranzas/tablero${query ? `?${query}` : ""}`),
    apiGet<ResumenCobranzas>("/cobranzas/resumen"),
  ]);
  const { kpis, parametros } = tablero;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Cobranzas"
        subtitle={`Cartera de hoy y lo cobrado del ${formatDate(parametros.desde)} al ${formatDate(parametros.hasta)}. Montos en USD.`}
        helpText="Lo vendido sale del mismo extracto que los indicadores de venta (facturas y notas de entrega menos devoluciones); lo cobrado, de los pagos verificados."
        actions={
          <Button asChild>
            <Link href="/cobranzas/pagos">
              <InboxIcon aria-hidden />
              Pagos por verificar ({resumen.pagosPorVerificar})
            </Link>
          </Button>
        }
      />

      {!parametros.bloqueoActivo && (
        <div role="status" className="flex items-start gap-3 rounded-lg border border-warning/40 bg-warning/5 p-4 text-sm">
          <AlertTriangleIcon className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden />
          <p>
            <strong>El bloqueo de despachos está apagado:</strong> falta definir la fecha de inicio de la cartera. Sin
            ella todo el historial cuenta como deuda.{" "}
            <Link href="/cobranzas/ajustes" className="font-medium text-primary underline-offset-4 hover:underline">
              Configurarla en Ajustes
            </Link>
          </p>
        </div>
      )}

      <form className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-3">
        <div className="space-y-1.5">
          <Label htmlFor="empresa">Empresa</Label>
          <select id="empresa" name="empresa" defaultValue={filtros.empresa} className={SELECT}>
            <option value="">Ambas</option>
            <option value="ISVAN">ISVAN</option>
            <option value="TRALOG">TRALOG</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="desde">Desde</Label>
          <Input id="desde" name="desde" type="date" defaultValue={filtros.desde || parametros.desde} className="w-40" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="hasta">Hasta</Label>
          <Input id="hasta" name="hasta" type="date" defaultValue={filtros.hasta || parametros.hasta} className="w-40" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ruta">Ruta</Label>
          <select id="ruta" name="ruta" defaultValue={filtros.ruta} className={SELECT}>
            <option value="">Todas</option>
            {tablero.rutasDisponibles.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" variant="secondary">
          <FilterIcon aria-hidden />
          Aplicar
        </Button>
        {query && (
          <Button variant="link" asChild>
            <Link href="/cobranzas">Quitar filtros</Link>
          </Button>
        )}
      </form>

      <section aria-label="Indicadores" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={BanknoteIcon} label="Cartera por cobrar" value={formatUsd(kpis.carteraUsd)} trend={`${formatNumero(kpis.clientesConSaldo)} clientes con saldo`} />
        <StatCard
          icon={CalendarClockIcon}
          label="Vencido"
          value={formatUsd(kpis.vencidoUsd)}
          trend={`${formatPct(kpis.pctVencido)} de la cartera · vence a los ${parametros.diasTolerancia} días`}
          tone="destructive"
        />
        <StatCard
          icon={HandCoinsIcon}
          label="Cobrado en el período"
          value={formatUsd(kpis.cobradoUsd)}
          trend={`${kpis.pctCobrado != null ? `${formatPct(kpis.pctCobrado)} de lo vendido (${formatUsd(kpis.vendidoUsd)})` : "Sin ventas en el período"}`}
          tone="success"
        />
        <StatCard
          icon={InboxIcon}
          label="Pagos por verificar"
          value={formatNumero(kpis.pagosPorVerificar)}
          trend={`${formatUsd(kpis.porVerificarUsd)} reportados por los clientes`}
          tone="warning"
        />
        <StatCard
          icon={UserXIcon}
          label="Clientes bloqueados"
          value={formatNumero(kpis.clientesBloqueados)}
          trend={parametros.bloqueoActivo ? "Con algún documento vencido" : "Bloqueo apagado (sin inicio de cartera)"}
          tone="destructive"
        />
        <StatCard
          icon={UserCheckIcon}
          label="Disponibles para despacho"
          value={formatNumero(kpis.clientesDisponibles)}
          trend="Compraron en el período y no tienen deuda vencida"
          tone="success"
        />
        <StatCard
          icon={CalendarClockIcon}
          label="Días de venta en la calle"
          value={kpis.diasCobro != null ? formatNumero(kpis.diasCobro, 1) : "—"}
          trend="Cartera ÷ venta diaria promedio del período"
          tone="info"
        />
        <StatCard
          icon={BanknoteIcon}
          label="Tasa BCV"
          value={resumen.tasa ? formatNumero(resumen.tasa.tasa, 2) : "—"}
          trend={resumen.tasa ? `Bs/USD · ${formatDate(resumen.tasa.fecha)}` : "Sin tasa registrada"}
          tone="info"
        />
      </section>

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Vendido vs. cobrado</CardTitle>
            <CardDescription>Por mes, en USD.</CardDescription>
          </CardHeader>
          <CardContent>
            <GraficoVendidoCobrado serie={tablero.serie} />
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Antigüedad de la deuda</CardTitle>
            <CardDescription>Saldo pendiente según los días de atraso.</CardDescription>
          </CardHeader>
          <CardContent>
            <GraficoAntiguedad antiguedad={tablero.antiguedad} />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Mayores deudas vencidas</CardTitle>
            <CardDescription>Los 15 clientes con más saldo vencido.</CardDescription>
          </CardHeader>
          <CardContent>
            {tablero.deudores.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Ningún cliente tiene deuda vencida.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cliente</TableHead>
                    <TableHead className="text-right">Vencido</TableHead>
                    <TableHead className="hidden text-right sm:table-cell">Atraso</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tablero.deudores.map((d) => (
                    <TableRow key={`${d.empresa}:${d.codigoCliente}`}>
                      <TableCell>
                        <Link
                          href={`/cobranzas/clientes/${d.empresa}/${encodeURIComponent(d.codigoCliente)}`}
                          className="font-medium text-primary underline-offset-4 hover:underline"
                        >
                          {d.nombre}
                        </Link>
                        <span className="block text-xs text-muted-foreground">
                          {d.empresa} {d.codigoCliente} · ruta {d.ruta}
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums text-destructive">{formatUsd(d.vencidoUsd, 2)}</TableCell>
                      <TableCell className="hidden text-right tabular-nums sm:table-cell">{d.diasAtraso} días</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Por ruta</CardTitle>
            <CardDescription>Cartera de hoy; vendido y cobrado en el período.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ruta</TableHead>
                  <TableHead className="text-right">Saldo</TableHead>
                  <TableHead className="text-right">Vencido</TableHead>
                  <TableHead className="hidden text-right md:table-cell">Vendido</TableHead>
                  <TableHead className="hidden text-right md:table-cell">Cobrado</TableHead>
                  <TableHead className="text-right">Bloqueados</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tablero.rutas.map((r) => (
                  <TableRow key={r.ruta}>
                    <TableCell className="font-medium">{r.ruta}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatUsd(r.saldoUsd)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatUsd(r.vencidoUsd)}</TableCell>
                    <TableCell className="hidden text-right tabular-nums md:table-cell">{formatUsd(r.vendidoUsd)}</TableCell>
                    <TableCell className="hidden text-right tabular-nums md:table-cell">{formatUsd(r.cobradoUsd)}</TableCell>
                    <TableCell className="text-right">
                      {r.bloqueados > 0 ? <StatusBadge label={String(r.bloqueados)} tone="destructive" /> : "0"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
