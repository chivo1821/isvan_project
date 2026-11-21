"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { apiGet } from "@/lib/api-client";

// Cada cuanto se pregunta si hubo cambios. Preguntar pesa poco (~100 bytes),
// pero cada pregunta enciende la API en Vercel y gasta CPU del plan: cada
// 5 s, una pestaña abierta todo el dia se comia buena parte de las 4 horas
// del mes (aviso de Vercel, 2026-11-12). Lo caro, recargar los datos de la
// pagina, solo pasa cuando la huella cambia.
const INTERVALO_MS = 30_000;

/**
 * Refresca la pagina sola cuando cambian sus datos, sin recargarla entera.
 *
 * Consulta `versionPath` (un endpoint que devuelve `{ version }`) y, si la
 * version cambio, hace `router.refresh()`: Next vuelve a pedir los datos de
 * los Server Components y actualiza la pantalla conservando el estado del
 * cliente (el zoom del mapa, el scroll).
 *
 * Con la pestaña en segundo plano no pregunta nada: un panel olvidado abierto
 * no mantiene despierta la base (Neon la suspende cuando nadie la usa) ni
 * gasta transferencia. Al volver a la pestaña revisa en el acto.
 */
export function AutoRefresco({ versionPath }: { versionPath: string }) {
  const router = useRouter();
  const version = useRef<string | null>(null);

  useEffect(() => {
    let activo = true;
    let revisando = false;

    async function revisar() {
      if (revisando || document.visibilityState !== "visible") return;
      revisando = true;
      try {
        const { version: nueva } = await apiGet<{ version: string }>(versionPath);
        // La primera respuesta solo fija el punto de partida: la pagina
        // acaba de cargarse con esos mismos datos.
        if (activo && version.current !== null && nueva !== version.current) router.refresh();
        version.current = nueva;
      } catch {
        // Sin red o sesion vencida: se reintenta en la proxima vuelta.
      } finally {
        revisando = false;
      }
    }

    revisar();
    const intervalo = window.setInterval(revisar, INTERVALO_MS);
    document.addEventListener("visibilitychange", revisar);
    return () => {
      activo = false;
      window.clearInterval(intervalo);
      document.removeEventListener("visibilitychange", revisar);
    };
  }, [versionPath, router]);

  return null;
}
