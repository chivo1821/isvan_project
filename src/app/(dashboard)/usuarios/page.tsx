import { PageHeader } from "@/components/layout/page-header";
import { UsuariosTable } from "@/components/modules/usuarios/usuarios-table";
import { getUsuariosRaw } from "@/lib/mock-data";
import { getUsuarioActual } from "@/lib/session";

export default async function UsuariosPage() {
  const [usuarios, usuarioActual] = await Promise.all([getUsuariosRaw(), getUsuarioActual()]);
  const esAdmin = usuarioActual?.rol === "ADMIN";
  return (
    <div className="space-y-6">
      <PageHeader title="Usuarios" subtitle="Personas con acceso al sistema" />
      <UsuariosTable usuarios={usuarios} esAdmin={esAdmin} />
    </div>
  );
}
