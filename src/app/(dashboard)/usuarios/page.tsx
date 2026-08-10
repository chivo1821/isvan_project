import { PageHeader } from "@/components/layout/page-header";
import { UsuariosTable } from "@/components/modules/usuarios/usuarios-table";
import { getUsuariosRaw } from "@/lib/mock-data";

export default async function UsuariosPage() {
  const usuarios = await getUsuariosRaw();
  return (
    <div className="space-y-6">
      <PageHeader title="Usuarios" subtitle="Personas con acceso al sistema" />
      <UsuariosTable usuarios={usuarios} />
    </div>
  );
}
