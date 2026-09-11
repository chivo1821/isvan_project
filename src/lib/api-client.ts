// Cliente HTTP hacia la API FastAPI real (ver backend/app/main.py). Se usa
// desde Server Components (fetch server->server) y desde Client Components
// (fetch del navegador, por eso FastAPI tiene CORS habilitado para
// localhost:3000). "cache: no-store" porque siempre hace falta el dato mas
// fresco (sesion, estados de despacho/ruta cambian todo el tiempo).
//
// Sesion (ver backend/app/core/auth.py): la cookie httpOnly la maneja el
// navegador solo en Client Components (de ahi "credentials: include", para
// que viaje en la llamada cross-origin :3000 -> :8000). Los Server
// Components corren en Node y no tienen acceso al "cookie jar" del
// navegador -- hay que leer la cookie de la request entrante (next/headers)
// y reenviarla a mano como header Cookie.

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

async function cookieHeader(): Promise<HeadersInit> {
  if (typeof window !== "undefined") return {};
  const { cookies } = await import("next/headers");
  const header = (await cookies()).toString();
  return header ? { Cookie: header } : {};
}

/** Error de la API con el detalle que mandó FastAPI ya separado del ruido
 * técnico. `message` mantiene el formato de siempre ("400 en /ruta: ...")
 * para logs; `detalle` es lo que se le muestra al usuario. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    readonly detalle: string
  ) {
    super(`${status} en ${path}${detalle ? `: ${detalle}` : ""}`);
    this.name = "ApiError";
  }
}

/** Texto a mostrarle al usuario ante un error de la API: el detalle que
 * explica qué pasó, sin el código ni la ruta del endpoint. */
export function mensajeDeError(err: unknown, respaldo: string): string {
  if (err instanceof ApiError) return err.detalle || `${respaldo} (error ${err.status})`;
  if (err instanceof Error && err.message) return err.message;
  return respaldo;
}

async function handle<T>(res: Response, path: string): Promise<T> {
  if (!res.ok) {
    let detalle = "";
    try {
      const body = await res.json();
      detalle = body?.detail ?? "";
    } catch {
      // respuesta sin JSON, se ignora
    }
    throw new ApiError(res.status, path, detalle);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    cache: "no-store",
    credentials: "include",
    headers: await cookieHeader(),
  });
  return handle<T>(res, path);
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(await cookieHeader()) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  return handle<T>(res, path);
}

// Para multipart/form-data (ej. carga de Excel) — sin Content-Type manual,
// el navegador/runtime le agrega el boundary correcto solo.
export async function apiPostForm<T>(path: string, formData: FormData): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    credentials: "include",
    headers: await cookieHeader(),
    body: formData,
    cache: "no-store",
  });
  return handle<T>(res, path);
}

export async function apiDelete<T = void>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: "DELETE",
    credentials: "include",
    headers: await cookieHeader(),
    cache: "no-store",
  });
  return handle<T>(res, path);
}

export async function apiPut<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(await cookieHeader()) },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  return handle<T>(res, path);
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(await cookieHeader()) },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  return handle<T>(res, path);
}
