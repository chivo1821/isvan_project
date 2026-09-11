import Link from "next/link";
import type { ReactNode } from "react";
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
import { RendimientoReparto, type ResumenRendimiento } from "@/components/modules/dashboard/rendimiento-reparto";
import { RendimientoVendedoresCard } from "@/components/modules/dashboard/rendimiento-vendedores";
import { ResumenVentas, type VentasEmpresa } from "@/components/modules/dashboard/resumen-ventas";
import { apiGet } from "@/lib/api-client";
import {
  EMPRESAS,
  finDeMes,
  inicioDeMes,
  type OpcionesIndicadores,
  type ResumenIndicadores,
} from "@/lib/indicadores";
import { sinUbicacion } from "@/lib/ubicacion";
import type { RendimientoVendedores } from "@/lib/vendedor";

export default async function DashboardPage() {
  const [
    despachos,
    despachosPendientes,
    despachosSinRuta,
    rutasActivas,
    vehiculosDisponibles,
    clientes,
    resumen,
    ventas,
    rendimientoVendedores,
  ] = await Promise.all([
    getDespachosConDetalle(),
    getDespachosPendientesAprobacion(),
    getDespachosDisponiblesParaRutaRaw(),
    getRutasActivas(),
    getVehiculosDisponibles(),
    getClientesRaw(),
    // Los indicadores de rendimiento, de venta y de vendedores son
    // información adicional: si alguno falla, el dashboard muestra el resto.
    apiGet<ResumenRendimiento>("/reportes/resumen").catch(() => null),
    ventasDelUltimoMes(),
    apiGet<RendimientoVendedores>("/vendedor/rendimiento").catch(() => null),
  ]);

  const rutasEnTransito = rutasActivas.filter((r) => r.estado === "EN_TRANSITO");
  // Un cliente en (0, 0) cuenta como sin ubicación: es un dato faltante
  // cargado como cero, no una coordenada real (ver src/lib/ubicacion.ts).
  const clientesSinUbicacion = clientes.filter(sinUbicacion).length;
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
    <div className="space-y-8">
      <PageHeader title="Inicio" subtitle="Primero la venta y después la operación: cómo se vende y cómo se entrega" />

      <Seccion
        titulo="Ventas"
        descripcion="El último mes con ventas cargadas y el trabajo de los vendedores esta semana"
        accion={
          <Button variant="ghost" size="sm" asChild>
            <Link href="/indicadores">Indicadores de venta</Link>
          </Button>
        }
      >
        <ResumenVentas ventas={ventas} />
        {rendimientoVendedores && <RendimientoVendedoresCard rendimiento={rendimientoVendedores} />}
      </Seccion>

      <Seccion titulo="Despachos" descripcion="Despachos, rutas y flota">
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
            label="Clientes sin ubicación"
            value={String(clientesSinUbicacion)}
            tone="destructive"
          />
        </div>

        {resumen && <RendimientoReparto resumen={resumen} />}

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
      </Seccion>
    </div>
  );
}

/** Por empresa, los indicadores del último mes con ventas cargadas. Una
 * empresa sin ventas (o si la API falla) simplemente no aparece. */
async function ventasDelUltimoMes(): Promise<VentasEmpresa[]> {
  const porEmpresa = await Promise.all(
    EMPRESAS.map(async (empresa): Promise<VentasEmpresa | null> => {
      try {
        const opciones = await apiGet<OpcionesIndicadores>(`/indicadores/opciones?empresa=${empresa}`);
        if (!opciones.fechaMax) return null;
        const desde = inicioDeMes(opciones.fechaMax);
        const hasta = finDeMes(opciones.fechaMax);
        const resumen = await apiGet<ResumenIndicadores>(
          `/indicadores/resumen?empresa=${empresa}&desde=${desde}&hasta=${hasta}`
        );
        return resumen.actual ? { empresa, desde, hasta, resumen } : null;
      } catch {
        return null;
      }
    })
  );
  return porEmpresa.filter((v): v is VentasEmpresa => v !== null);
}

/** Un bloque del dashboard con su título, para distinguir de un vistazo lo
 * que es de venta de lo que es de despacho. */
function Seccion({
  titulo,
  descripcion,
  accion,
  children,
}: {
  titulo: string;
  descripcion: string;
  accion?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-4">
      <div className="flex items-end justify-between gap-2 border-b border-border pb-2">
        <div>
          <h2 className="text-lg font-semibold text-foreground">{titulo}</h2>
          <p className="text-sm text-muted-foreground">{descripcion}</p>
        </div>
        {accion}
      </div>
      {children}
    </section>
  );
}
