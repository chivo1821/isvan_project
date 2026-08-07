import Link from "next/link";
import {
  CarIcon,
  ClipboardCheckIcon,
  MapPinnedIcon,
  PackageXIcon,
  ShoppingCartIcon,
  UserCheckIcon,
} from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { convertirUsdABs, ESTADO_VENTA_META, formatBs, formatBsAmount, formatCurrency, formatDate } from "@/lib/constants";
import {
  getDespachosEnTransito,
  getDespachosPendientesAprobacion,
  getProductosBajoStock,
  getVehiculosDisponibles,
  getVentasConDetalle,
  getVentasEnRevision,
} from "@/lib/mock-data";
import {
  DespachosTransitoMap,
  type DespachoMapPoint,
} from "@/components/modules/despachos/despachos-transito-map";

const HOY = "2026-08-07";

export default function DashboardPage() {
  const ventas = getVentasConDetalle();
  const ventasHoy = ventas.filter((v) => v.fecha === HOY);
  const totalVentasHoy = ventasHoy.reduce((sum, v) => sum + v.total, 0);
  // Suma el Bs de cada venta con su propia tasa (todas del mismo dia, pero
  // consistente con el resto de la app donde cada venta usa su tasaBcv).
  const totalVentasHoyBs = ventasHoy.reduce((sum, v) => sum + convertirUsdABs(v.total, v.tasaBcv), 0);
  const ventasEnRevision = getVentasEnRevision();
  const productosBajoStock = getProductosBajoStock();
  const despachosPendientes = getDespachosPendientesAprobacion();
  const despachosEnTransito = getDespachosEnTransito();
  const vehiculosDisponibles = getVehiculosDisponibles();

  const ventasRecientes = [...ventas]
    .sort((a, b) => (a.fecha < b.fecha ? 1 : -1))
    .slice(0, 5);

  const puntosTransito: DespachoMapPoint[] = despachosEnTransito.map((d) => {
    const ultimoPunto = d.ruta[d.ruta.length - 1];
    return {
      id: d.id,
      numero: d.numero,
      clienteNombre: d.destinoCliente.nombre,
      position: ultimoPunto ? [ultimoPunto.lat, ultimoPunto.lng] : [d.origen.lat, d.origen.lng],
      tone: "info",
    };
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Inicio"
        subtitle="Resumen general de ventas, inventario, despachos y flota"
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard
          icon={ShoppingCartIcon}
          label="Ventas del día"
          value={String(ventasHoy.length)}
          trend={`${formatCurrency(totalVentasHoy)} · ${formatBsAmount(totalVentasHoyBs)}`}
          tone="primary"
        />
        <StatCard
          icon={ClipboardCheckIcon}
          label="Ventas en revisión"
          value={String(ventasEnRevision.length)}
          tone="warning"
        />
        <StatCard
          icon={PackageXIcon}
          label="Stock bajo"
          value={String(productosBajoStock.length)}
          tone="destructive"
        />
        <StatCard
          icon={UserCheckIcon}
          label="Despachos por aprobar"
          value={String(despachosPendientes.length)}
          tone="warning"
        />
        <StatCard
          icon={MapPinnedIcon}
          label="Despachos en tránsito"
          value={String(despachosEnTransito.length)}
          tone="info"
        />
        <StatCard
          icon={CarIcon}
          label="Vehículos disponibles"
          value={String(vehiculosDisponibles.length)}
          tone="success"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Ventas recientes</CardTitle>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/ventas">Ver todas</Link>
            </Button>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>N° Venta</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ventasRecientes.map((venta) => (
                  <TableRow key={venta.id}>
                    <TableCell className="font-medium">
                      <Link href={`/ventas/${venta.id}`} className="hover:underline">
                        {venta.numero}
                      </Link>
                    </TableCell>
                    <TableCell>{venta.cliente.nombre}</TableCell>
                    <TableCell>{formatDate(venta.fecha)}</TableCell>
                    <TableCell>
                      <StatusBadge {...ESTADO_VENTA_META[venta.estado]} />
                    </TableCell>
                    <TableCell className="text-right leading-tight">
                      <p>{formatCurrency(venta.total)}</p>
                      <p className="text-xs text-muted-foreground">{formatBs(venta.total, venta.tasaBcv)}</p>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Despachos en tránsito</CardTitle>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/seguimiento">Ver seguimiento</Link>
            </Button>
          </CardHeader>
          <CardContent>
            {puntosTransito.length > 0 ? (
              <DespachosTransitoMap
                puntos={puntosTransito}
                center={[10.3, -67.8]}
                zoom={6}
                className="h-72"
              />
            ) : (
              <p className="flex h-72 items-center justify-center text-sm text-muted-foreground">
                No hay despachos en tránsito en este momento.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
