import { PageHeader } from "@/components/layout/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import {
  SeguimientoOverview,
  type RutaSeguimientoItem,
} from "@/components/modules/seguimiento/seguimiento-overview";
import { ESTADO_RUTA_META } from "@/lib/constants";
import { getRutasActivas } from "@/lib/mock-data";

export default async function SeguimientoPage() {
  const rutasActivas = await getRutasActivas();

  const puntos: RutaSeguimientoItem[] = rutasActivas.map((r) => {
    const ultimoPunto = r.puntos[r.puntos.length - 1];
    return {
      id: r.id,
      numero: r.numero,
      vehiculoPlaca: r.vehiculo.placa,
      paradas: r.despachos.length,
      estado: r.estado,
      position: ultimoPunto ? [ultimoPunto.lat, ultimoPunto.lng] : [r.origen.lat, r.origen.lng],
    };
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Seguimiento"
        subtitle="Ubicación de las rutas activas (planificadas listas para salir y en tránsito)"
      />
      <div className="flex flex-wrap gap-2">
        <StatusBadge {...ESTADO_RUTA_META.PLANIFICADA} />
        <StatusBadge {...ESTADO_RUTA_META.EN_TRANSITO} />
      </div>
      <SeguimientoOverview rutas={puntos} center={[10.3, -67.8]} />
    </div>
  );
}
