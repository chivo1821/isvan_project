"use client";

import { useEffect } from "react";
import { apiGet } from "@/lib/api-client";

const CADA = 5 * 60_000;
const MINIMO_ENTRE_REVISIONES = 60_000;

/** Revisa que la sesión siga vigente al volver a la pestaña y cada 5
 * minutos. La sesión dura 12 horas: quien deja la pantalla abierta de un día
 * para otro seguía viendo los datos, porque nada volvía a preguntarle a la
 * API. Si ya venció, apiGet manda a iniciar sesión (ver sesionVencida en
 * api-client.ts). Un error de red no hace nada: se revisa la próxima vez. */
export function VigilanteSesion({ ruta }: { ruta: "/auth/me" | "/portal/me" }) {
  useEffect(() => {
    let ultima = Date.now();

    function revisar(forzar = false) {
      if (document.visibilityState !== "visible") return;
      if (!forzar && Date.now() - ultima < MINIMO_ENTRE_REVISIONES) return;
      ultima = Date.now();
      apiGet(ruta).catch(() => {});
    }

    const alVolver = () => revisar();
    const intervalo = window.setInterval(() => revisar(true), CADA);
    document.addEventListener("visibilitychange", alVolver);
    window.addEventListener("focus", alVolver);
    return () => {
      window.clearInterval(intervalo);
      document.removeEventListener("visibilitychange", alVolver);
      window.removeEventListener("focus", alVolver);
    };
  }, [ruta]);

  return null;
}
