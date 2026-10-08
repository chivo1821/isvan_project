// Guardia gruesa de acceso: solo mira si existe la cookie de sesion (rapido,
// compatible con Edge — no hace una llamada a la API en cada request). La
// validacion real (sesion vigente, usuario activo) pasa en
// (dashboard)/layout.tsx via GET /auth/me; si esa llamada da 401 ahi se
// redirige de nuevo, como segunda capa.
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const SESSION_COOKIE_NAME = "sesion_id";
const PUBLIC_PATHS = ["/login"];

// Portal de clientes: otra sesión (cookie portal_sesion, ver
// backend/app/core/portal_auth.py) y su propia puerta de entrada. La
// validación real la hace el layout del portal contra GET /portal/me.
const PORTAL = "/portal";
const PORTAL_COOKIE = "portal_sesion";
const PORTAL_PUBLICO = ["/portal/ingresar", "/portal/registro", "/portal/confirmar", "/portal/recuperar"];

/** Cabecera con la ruta pedida, que inyecta este proxy y lee
 * (dashboard)/layout.tsx para aplicar el acceso por rol. */
export const RUTA_ACTUAL_HEADER = "x-ruta-actual";

function enRuta(pathname: string, path: string) {
  return pathname === path || pathname.startsWith(`${path}/`);
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.some((path) => enRuta(pathname, path))) {
    return NextResponse.next();
  }

  if (enRuta(pathname, PORTAL)) {
    if (PORTAL_PUBLICO.some((path) => enRuta(pathname, path)) || request.cookies.has(PORTAL_COOKIE)) {
      return NextResponse.next();
    }
    return NextResponse.redirect(new URL("/portal/ingresar", request.url));
  }

  if (!request.cookies.has(SESSION_COOKIE_NAME)) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("from", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Un Server Component no puede saber qué ruta se está pidiendo, y el
  // layout del dashboard la necesita para mandar a un REPARTIDOR a su única
  // pantalla. Se la pasamos en una cabecera de la request.
  const headers = new Headers(request.headers);
  headers.set(RUTA_ACTUAL_HEADER, pathname);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
