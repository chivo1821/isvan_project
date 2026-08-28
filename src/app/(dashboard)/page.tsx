import Link from "next/link";
import {
  AlertTriangleIcon,
  ClipboardCheckIcon,
  MapPinnedIcon,
  PackageSearchIcon,
  RouteIcon,
  TruckIcon,
} from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ESTADO_DESPACHO_META, formatDate } from "@/lib/constants";
import {
  getClientesRaw,
  getDespachosConDetalle,
  getDespachosDisponiblesParaRutaRaw,
  getDespachosPendientesAprobacion,
  getRutasActivas,
  getVehiculosDisponibles,
} from "@/lib/mock-data";
import {
  DespachosTransitoMap,
  type DespachoMapPoint,
} from "@/components/modules/despachos/despachos-transito-map";

export default async function DashboardPage() {
  const [despachos, despachosPendientes, despachosSinRuta, rutasActivas, vehiculosDisponibles, clientes] =
    await Promise.all([
      getDespachosConDetalle(),
      getDespachosPendientesAprobacion(),
      getDespachosDisponiblesParaRutaRaw(),
      getRutasActivas(),
      getVehiculosDisponibles(),
      getClientesRaw(),
    ]);

  const rutasEnTransito = rutasActivas.filter((r) => r.estado === "EN_TRANSITO");
  const clientesSinCoordenadas = clientes.filter((c) => c.lat == null || c.lng == null).length;
  const despachosRecientes = [...despachos]
    .sort((a, b) => (a.fechaCreacion < b.fechaCreacion ? 1 : -1))
    .slice(0, 5);

  const puntosTransito: DespachoMapPoint[] = rutasEnTransito.map((r) => {
    const ultimoPunto = r.puntos[r.puntos.length - 1];
    return {
      id: r.id,
      numero: r.numero,
      clienteNombre: `${r.despachos.length} parada(s)`,
      position: ultimoPunto ? [ultimoPunto.lat, ultimoPunto.lng] : [r.origen.lat, r.origen.lng],
      tone: "info",
    };
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Inicio" subtitle="Resumen general de despachos, rutas y flota" />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard
          icon={ClipboardCheckIcon}
          label="Despachos por aprobar"
          value={String(despachosPendientes.length)}
          tone="warning"
        />
        <StatCard
          icon={PackageSearchIcon}
          label="Aprobados sin ruta"
          value={String(despachosSinRuta.length)}
          tone="info"
        />
        <StatCard icon={RouteIcon} label="Rutas en tránsito" value={String(rutasEnTransito.length)} tone="info" />
        <StatCard icon={MapPinnedIcon} label="Rutas activas" value={String(rutasActivas.length)} tone="primary" />
        <StatCard
          icon={TruckIcon}
          label="Vehículos disponibles"
          value={String(vehiculosDisponibles.length)}
          tone="success"
        />
        <StatCard
          icon={AlertTriangleIcon}
          label="Clientes sin coordenadas"
          value={String(clientesSinCoordenadas)}
          tone="destructive"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Despachos recientes</CardTitle>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/despachos">Ver todos</Link>
            </Button>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>N° Despacho</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {despachosRecientes.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="font-medium">
                      <Link href={`/despachos/${d.id}`} className="hover:underline">
                        {d.numero}
                      </Link>
                    </TableCell>
                    <TableCell>{d.destinoCliente.nombre}</TableCell>
                    <TableCell>{formatDate(d.fechaCreacion)}</TableCell>
                    <TableCell>
                      <StatusBadge {...ESTADO_DESPACHO_META[d.estado]} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Rutas en tránsito</CardTitle>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/seguimiento">Ver seguimiento</Link>
            </Button>
          </CardHeader>
          <CardContent>
            {puntosTransito.length > 0 ? (
              <DespachosTransitoMap puntos={puntosTransito} center={[10.3, -67.8]} zoom={6} className="h-72" />
            ) : (
              <p className="flex h-72 items-center justify-center text-sm text-muted-foreground">
                No hay rutas en tránsito en este momento.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
