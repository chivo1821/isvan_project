import { PageHeader } from "@/components/layout/page-header";
import { VehiculosTable } from "@/components/modules/flota/vehiculos-table";
import { getAlmacenesRaw, getVehiculosRaw } from "@/lib/mock-data";
import { getUsuarioActual } from "@/lib/session";

export default async function FlotaPage() {
  const [almacenes, vehiculos, usuarioActual] = await Promise.all([
    getAlmacenesRaw(),
    getVehiculosRaw(),
    getUsuarioActual(),
  ]);
  const puedeEditar = usuarioActual?.rol === "ADMIN" || usuarioActual?.rol === "DESPACHOS";
  return (
    <div className="space-y-6">
      <PageHeader
        title="Flota"
        subtitle="Vehículos propios de la empresa (compartida entre ISVAN y TRALOG) y su disponibilidad para rutas"
        helpText="Solo los vehículos en estado Funcional y no asignados a una ruta activa se consideran disponibles para la sugerencia automática de vehículo."
      />
      <VehiculosTable vehiculos={vehiculos} almacenes={almacenes} puedeEditar={puedeEditar} />
    </div>
  );
}
