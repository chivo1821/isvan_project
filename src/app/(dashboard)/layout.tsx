import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { Topbar } from "@/components/layout/topbar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { RUTA_ACTUAL_HEADER } from "@/proxy";
import { INICIO_POR_ROL } from "@/lib/constants";
import { getUsuarioActual } from "@/lib/session";

/** Único módulo al que tiene acceso un REPARTIDOR: su viaje del día. */
const INICIO_REPARTIDOR = "/despachador";

/** Único módulo de un VENDEDOR: los despachos de sus rutas y sus visitas. */
const INICIO_VENDEDOR = "/vendedor";

/** Pantallas solo para ADMIN, además del dashboard ("/"). */
const RUTAS_SOLO_ADMIN = ["/indicadores"];

function esSoloAdmin(ruta: string) {
  return ruta === "/" || RUTAS_SOLO_ADMIN.some((r) => ruta === r || ruta.startsWith(`${r}/`));
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
  if (usuarioActual.rol === "REPARTIDOR") {
    if (!rutaActual.startsWith(INICIO_REPARTIDOR)) redirect(INICIO_REPARTIDOR);
  } else if (usuarioActual.rol === "VENDEDOR") {
    // Igual que el repartidor: su módulo y nada más. La API además le cierra
    // el resto de la operación (ver sin_acceso_vendedor en
    // backend/app/core/permisos.py).
    if (!rutaActual.startsWith(INICIO_VENDEDOR)) redirect(INICIO_VENDEDOR);
  } else if (
    usuarioActual.rol !== "ADMIN" &&
    (esSoloAdmin(rutaActual) || rutaActual.startsWith(INICIO_VENDEDOR))
  ) {
    // El dashboard muestra la operación completa (incluido el rendimiento
    // por conductor) y los indicadores de venta, las cifras del negocio:
    // solo ADMIN. Los demás entran a su propio módulo.
    redirect(INICIO_POR_ROL[usuarioActual.rol]);
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
