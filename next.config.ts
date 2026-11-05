import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Solo para la imagen de contenedor (Dockerfile, NEXT_OUTPUT=standalone):
  // empaqueta el servidor con lo justo. En Vercel no se define y el build
  // queda como siempre.
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
};

export default nextConfig;
