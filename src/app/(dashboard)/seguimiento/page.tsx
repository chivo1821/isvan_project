import { PageHeader } from "@/components/layout/page-header";
import { AutoRefresco } from "@/components/shared/auto-refresco";
import { StatusBadge } from "@/components/shared/status-badge";
import {
  SeguimientoOverview,
  type RutaSeguimientoItem,
} from "@/components/modules/seguimiento/seguimiento-overview";
import { ESTADO_RUTA_META, contarParadas } from "@/lib/constants";
import { getRutasActivas } from "@/lib/mock-data";
import { apiGet } from "@/lib/api-client";
import type { RepartidoresEnVivo } from "@/lib/seguimiento";

export default async function SeguimientoPage() {
  const [rutasActivas, repartidores] = await Promise.all([
    getRutasActivas(),
    // La ubicación en vivo es un extra: si falla, se ve lo de siempre.
    apiGet<RepartidoresEnVivo>("/rutas/seguimiento/repartidores").catch(() => null),
  ]);

  const puntos: RutaSeguimientoItem[] = rutasActivas.map((r) => {
    const ultimoPunto = r.puntos[r.puntos.length - 1];
    return {
      id: r.id,
      numero: r.numero,
      vehiculoPlaca: r.vehiculo?.placa ?? "Sin vehículo",
      paradas: contarParadas(r.despachos),
      estado: r.estado,
      position: ultimoPunto ? [ultimoPunto.lat, ultimoPunto.lng] : [r.origen.lat, r.origen.lng],
    };
  });

  return (
    <div className="space-y-6">
      <AutoRefresco versionPath="/rutas/seguimiento/version" />
      <PageHeader
        title="Seguimiento"
        subtitle="Las rutas activas (planificadas y en tránsito). Las que van con la app se ven donde está el repartidor; el detalle muestra por dónde pasó y qué entregó"
      />
      <div className="flex flex-wrap gap-2">
        <StatusBadge {...ESTADO_RUTA_META.PLANIFICADA} />
        <StatusBadge {...ESTADO_RUTA_META.EN_TRANSITO} />
      </div>
      <SeguimientoOverview rutas={puntos} center={[10.3, -67.8]} repartidoresIniciales={repartidores} />
    </div>
  );
}
