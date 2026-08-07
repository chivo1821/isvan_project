import { PageHeader } from "@/components/layout/page-header";
import { VehiculosTable } from "@/components/modules/flota/vehiculos-table";
import { almacenes, vehiculos } from "@/lib/mock-data";

export default function FlotaPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Flota"
        subtitle="Vehículos propios de la empresa y su disponibilidad para despachos"
        helpText="Solo los vehículos en estado Funcional y no asignados a un despacho activo se consideran disponibles para la sugerencia automática de vehículo."
      />
      <VehiculosTable vehiculos={vehiculos} almacenes={almacenes} />
    </div>
  );
}
