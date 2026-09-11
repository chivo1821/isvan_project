import { PageHeader } from "@/components/layout/page-header";
import { ChoferesTable, type RutaDelVehiculo } from "@/components/modules/flota/choferes-table";
import { getRutasActivas, getUsuariosRaw, getVehiculosRaw } from "@/lib/mock-data";
import { getUsuarioActual } from "@/lib/session";

export default async function ChoferesPage() {
  const [usuarios, vehiculos, rutasActivas, usuarioActual] = await Promise.all([
    getUsuariosRaw(),
    getVehiculosRaw(),
    getRutasActivas(),
    getUsuarioActual(),
  ]);
  const puedeEditar = usuarioActual?.rol === "ADMIN" || usuarioActual?.rol === "DESPACHOS";
  const choferes = usuarios
    .filter((u) => u.rol === "REPARTIDOR" && u.activo)
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
  // Un vehículo lleva una sola ruta activa a la vez (ver backend crear_ruta).
  const rutaPorVehiculo: Record<string, RutaDelVehiculo> = Object.fromEntries(
    rutasActivas.map((r) => [r.vehiculoId, { id: r.id, numero: r.numero, estado: r.estado }])
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Choferes"
        subtitle="Quién maneja cada vehículo. El cambio es inmediato: desde ese momento el chofer ve la ruta activa de su vehículo nuevo"
        helpText="Un chofer es un usuario con rol Repartidor. Para agregar uno, créalo en Usuarios."
      />
      <ChoferesTable
        choferes={choferes}
        vehiculos={vehiculos}
        rutaPorVehiculo={rutaPorVehiculo}
        puedeEditar={puedeEditar}
      />
    </div>
  );
}
