import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { Topbar } from "@/components/layout/topbar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { RUTA_ACTUAL_HEADER } from "@/proxy";
import { getUsuarioActual } from "@/lib/session";

/** Único módulo al que tiene acceso un REPARTIDOR: su viaje del día. */
const INICIO_REPARTIDOR = "/despachador";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const usuarioActual = await getUsuarioActual();
  // Segunda capa de proteccion (la primera es src/middleware.ts, que solo
  // mira si existe la cookie): si la sesion existe pero ya no es valida
  // (expirada, usuario desactivado), GET /auth/me da 401 y se redirige aca.
  if (!usuarioActual) redirect("/login");

  // Un repartidor solo entra al despachador: cualquier otra pantalla del
  // dashboard lo devuelve ahí. Es la puerta de la interfaz; la de verdad
  // está en la API, que además le filtra los datos a su vehículo asignado
  // (ver backend/app/core/permisos.py).
  if (usuarioActual.rol === "REPARTIDOR") {
    const rutaActual = (await headers()).get(RUTA_ACTUAL_HEADER) ?? "";
    if (!rutaActual.startsWith(INICIO_REPARTIDOR)) redirect(INICIO_REPARTIDOR);
  }

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
