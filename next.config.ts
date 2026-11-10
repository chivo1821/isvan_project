import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Solo para la imagen de contenedor (Dockerfile, NEXT_OUTPUT=standalone):
  // empaqueta el servidor con lo justo. En Vercel no se define y el build
  // queda como siempre.
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  // HSTS: el navegador que ya vio el sitio por HTTPS no vuelve a usar la
  // versión sin cifrar, ni deja que alguien en la red lo baje a HTTP. Solo
  // en producción (Vercel siempre es HTTPS); en local sobra. Un año, sin
  // includeSubDomains: el dominio propio del cliente puede tener otros
  // subdominios que no son nuestros. La API pone el mismo valor
  // (backend/app/main.py).
  async headers() {
    if (process.env.NODE_ENV !== "production") return [];
    return [
      {
        source: "/:path*",
        headers: [{ key: "Strict-Transport-Security", value: "max-age=31536000" }],
      },
    ];
  },
};

export default nextConfig;
