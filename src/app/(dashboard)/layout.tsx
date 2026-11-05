import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { Topbar } from "@/components/layout/topbar";
import { VigilanteSesion } from "@/components/shared/vigilante-sesion";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { RUTA_ACTUAL_HEADER } from "@/proxy";
import { INICIO_POR_ROL, MODULOS_POR_ROL, enModulo } from "@/lib/constants";
import { getUsuarioActual } from "@/lib/session";

/** Pantallas solo para ADMIN, además del dashboard ("/"): las cifras del
 * negocio y los módulos de vendedor, cobranzas y supervisor (un DESPACHOS
 * no entra a ellos). El despachador sí es de la operación. */
const RUTAS_SOLO_ADMIN = ["/indicadores", "/delivery", "/censo", "/vendedor", "/cobranzas", "/supervisor"];

function esSoloAdmin(ruta: string) {
  return ruta === "/" || RUTAS_SOLO_ADMIN.some((r) => enModulo(ruta, r));
}

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
  const rutaActual = (await headers()).get(RUTA_ACTUAL_HEADER) ?? "";
  const modulos = MODULOS_POR_ROL[usuarioActual.rol];
  if (modulos) {
    // Repartidor, vendedor, cobranzas y supervisor: sus pantallas y nada
    // más. La API además les cierra el resto de la operación (ver
    // solo_su_modulo en backend/app/core/permisos.py).
    if (!modulos.some((m) => enModulo(rutaActual, m))) redirect(modulos[0]);
  } else if (usuarioActual.rol !== "ADMIN" && esSoloAdmin(rutaActual)) {
    // El dashboard muestra la operación completa (incluido el rendimiento
    // por conductor) y los indicadores de venta, las cifras del negocio:
    // solo ADMIN. Los demás entran a su propio módulo.
    redirect(INICIO_POR_ROL[usuarioActual.rol]);
  }

  return (
    <SidebarProvider>
      <VigilanteSesion ruta="/auth/me" />
      <AppSidebar rol={usuarioActual.rol} />
      {/* min-w-0: sin esto, una tabla ancha (aunque tenga su propio scroll)
          estira el contenido y toda la página se corre de lado. */}
      <SidebarInset className="min-w-0">
        <Topbar user={usuarioActual} />
        <div className="controles-tactiles flex-1 space-y-6 p-4 sm:p-6">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
