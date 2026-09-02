// Guardia gruesa de acceso: solo mira si existe la cookie de sesion (rapido,
// compatible con Edge — no hace una llamada a la API en cada request). La
// validacion real (sesion vigente, usuario activo) pasa en
// (dashboard)/layout.tsx via GET /auth/me; si esa llamada da 401 ahi se
// redirige de nuevo, como segunda capa.
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const SESSION_COOKIE_NAME = "sesion_id";
const PUBLIC_PATHS = ["/login"];

/** Cabecera con la ruta pedida, que inyecta este proxy y lee
 * (dashboard)/layout.tsx para aplicar el acceso por rol. */
export const RUTA_ACTUAL_HEADER = "x-ruta-actual";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))) {
    return NextResponse.next();
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
