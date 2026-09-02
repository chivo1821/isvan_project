import { PageHeader } from "@/components/layout/page-header";
import { UsuariosTable } from "@/components/modules/usuarios/usuarios-table";
import { getUsuariosRaw, getVehiculosRaw } from "@/lib/mock-data";
import { getUsuarioActual } from "@/lib/session";

export default async function UsuariosPage() {
  const [usuarios, vehiculos, usuarioActual] = await Promise.all([
    getUsuariosRaw(),
    getVehiculosRaw(),
    getUsuarioActual(),
  ]);
  const esAdmin = usuarioActual?.rol === "ADMIN";
  return (
    <div className="space-y-6">
      <PageHeader
        title="Usuarios"
        subtitle="Personas con acceso al sistema"
        helpText="A un repartidor hay que asignarle un vehículo: solo verá la ruta activa de ese vehículo, y nada más de la operación."
      />
      <UsuariosTable usuarios={usuarios} vehiculos={vehiculos} esAdmin={esAdmin} />
    </div>
  );
}
