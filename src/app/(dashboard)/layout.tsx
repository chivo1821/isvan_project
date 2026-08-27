import { redirect } from "next/navigation";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { Topbar } from "@/components/layout/topbar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { getUsuarioActual } from "@/lib/session";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const usuarioActual = await getUsuarioActual();
  // Segunda capa de proteccion (la primera es src/middleware.ts, que solo
  // mira si existe la cookie): si la sesion existe pero ya no es valida
  // (expirada, usuario desactivado), GET /auth/me da 401 y se redirige aca.
  if (!usuarioActual) redirect("/login");

  return (
    <SidebarProvider>
      <AppSidebar rol={usuarioActual.rol} />
      <SidebarInset>
        <Topbar user={usuarioActual} />
        <div className="flex-1 space-y-6 p-6">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
