// Cliente HTTP hacia la API FastAPI real (ver backend/app/main.py). Se usa
// desde Server Components (fetch server->server) y desde Client Components
// (fetch del navegador, por eso FastAPI tiene CORS habilitado para
// localhost:3000). "cache: no-store" porque es una demo — siempre datos
// frescos, sin preocuparse por invalidacion de cache.

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

async function handle<T>(res: Response, path: string): Promise<T> {
  if (!res.ok) {
    let detalle = "";
    try {
      const body = await res.json();
      detalle = body?.detail ?? "";
    } catch {
      // respuesta sin JSON, se ignora
    }
    throw new Error(`${res.status} en ${path}${detalle ? `: ${detalle}` : ""}`);
  }
  return res.json();
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { cache: "no-store" });
  return handle<T>(res, path);
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  return handle<T>(res, path);
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  return handle<T>(res, path);
}
