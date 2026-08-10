import { PageHeader } from "@/components/layout/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import {
  SeguimientoOverview,
  type DespachoSeguimientoItem,
} from "@/components/modules/seguimiento/seguimiento-overview";
import { ESTADO_DESPACHO_META } from "@/lib/constants";
import { getDespachosConDetalle } from "@/lib/mock-data";

const ESTADOS_ACTIVOS = ["EN_TRANSITO", "EN_PREPARACION"] as const;

export default async function SeguimientoPage() {
  const despachos = await getDespachosConDetalle();
  const despachosActivos = despachos.filter((d) => (ESTADOS_ACTIVOS as readonly string[]).includes(d.estado));

  const puntos: DespachoSeguimientoItem[] = despachosActivos.map((d) => {
    const ultimoPunto = d.ruta[d.ruta.length - 1];
    return {
      id: d.id,
      numero: d.numero,
      destinoNombre: d.destinoCliente.nombre,
      destinoCiudad: d.destinoCliente.ciudad,
      estado: d.estado,
      position: ultimoPunto ? [ultimoPunto.lat, ultimoPunto.lng] : [d.origen.lat, d.origen.lng],
    };
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Seguimiento"
        subtitle="Ubicación de los despachos activos (en preparación y en tránsito)"
      />
      <div className="flex flex-wrap gap-2">
        <StatusBadge {...ESTADO_DESPACHO_META.EN_TRANSITO} />
        <StatusBadge {...ESTADO_DESPACHO_META.EN_PREPARACION} />
      </div>
      <SeguimientoOverview despachos={puntos} center={[10.3, -67.8]} />
    </div>
  );
}
