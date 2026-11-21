"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { apiGet } from "@/lib/api-client";

/** GET /rutas/seguimiento/repartidores: quién está con la jornada abierta en
 * la app y dónde lo vio por última vez el GPS. Solo los que la página muestra:
 * los que van en una ruta en tránsito y los que dejaron de enviar. */
export type RepartidorEnVivo = {
  usuarioId: string;
  nombre: string;
  telefono: string | null;
  vehiculoPlaca: string | null;
  jornadaDesde: string;
  lat: number | null;
  lng: number | null;
  bateria: number | null;
  tomadaEn: string | null;
  rutaId: string | null;
  rutaNumero: string | null;
  minutosDesdeUltimo: number | null;
  sinSenal: boolean;
};

export type RepartidoresEnVivo = { repartidores: RepartidorEnVivo[]; minutosSinSenal: number };

/** GET /rutas/seguimiento/sin-senal: solo cuántos (para el menú). */
export type CuantosSinSenal = { sinSenal: number; minutosSinSenal: number };

/** La última señal de la app en una ruta, tal cual llegó. */
export type UltimaSenal = {
  lat: number;
  lng: number;
  tomadaEn: string;
  bateria: number | null;
  precisionM: number | null;
  repartidor: string;
  minutosDesdeUltimo: number;
  sinSenal: boolean;
};

/** GET /rutas/{id}/recorrido: por dónde pasó de verdad el vehículo. */
export type RecorridoReal = {
  puntos: { lat: number; lng: number; tomadaEn: string }[];
  total: number;
  ultima?: UltimaSenal | null;
};

/** Pide `path` cada `intervaloMs` mientras la pestaña está a la vista, sin
 * recargar la página: para lo que cambia seguido y pesa poco (las
 * posiciones). Con la pestaña en segundo plano no pregunta (ver
 * AutoRefresco: lo mismo, para no despertar la base). */
export function useSondeo<T>(
  path: string,
  inicial: T,
  intervaloMs: number,
  activo = true,
  /** Pedir también al montar (cuando no hay datos iniciales del servidor). */
  alMontar = false
): T {
  const [datos, setDatos] = useState<T>(inicial);

  useEffect(() => {
    if (!activo) return;
    let vigente = true;
    async function pedir() {
      if (document.visibilityState !== "visible") return;
      try {
        const nuevos = await apiGet<T>(path);
        if (vigente) setDatos(nuevos);
      } catch {
        // Un fallo de red no borra lo último que se vio.
      }
    }
    if (alMontar) void pedir();
    const id = window.setInterval(pedir, intervaloMs);
    const alVolver = () => document.visibilityState === "visible" && void pedir();
    document.addEventListener("visibilitychange", alVolver);
    return () => {
      vigente = false;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", alVolver);
    };
  }, [path, intervaloMs, activo, alMontar]);

  return datos;
}

// Cada cuánto el menú pregunta si algún repartidor dejó de enviar su
// ubicación (solo con la pestaña a la vista). Pide solo el número: la lista
// completa pesa mucho con muchos repartidores (ver la prueba de estrés en
// backend/app/api/rutas.py, cuantos_sin_senal).
const SONDEO_SIN_SENAL_MS = 60_000;

let sinSenalValor = 0;
let sinSenalIntervalo: number | null = null;
const sinSenalOyentes = new Set<() => void>();

async function pedirSinSenal() {
  if (typeof document === "undefined" || document.visibilityState !== "visible") return;
  try {
    const res = await apiGet<CuantosSinSenal>("/rutas/seguimiento/sin-senal");
    const nuevo = res?.sinSenal ?? 0;
    if (nuevo !== sinSenalValor) {
      sinSenalValor = nuevo;
      for (const fn of sinSenalOyentes) fn();
    }
  } catch {
    // Un fallo de red no borra lo último que se vio.
  }
}

function alVolverSinSenal() {
  if (document.visibilityState === "visible") void pedirSinSenal();
}

function suscribirSinSenal(oyente: () => void): () => void {
  sinSenalOyentes.add(oyente);
  if (sinSenalOyentes.size === 1 && typeof window !== "undefined") {
    void pedirSinSenal();
    sinSenalIntervalo = window.setInterval(pedirSinSenal, SONDEO_SIN_SENAL_MS);
    document.addEventListener("visibilitychange", alVolverSinSenal);
  }
  return () => {
    sinSenalOyentes.delete(oyente);
    if (sinSenalOyentes.size === 0 && sinSenalIntervalo !== null) {
      window.clearInterval(sinSenalIntervalo);
      sinSenalIntervalo = null;
      document.removeEventListener("visibilitychange", alVolverSinSenal);
    }
  };
}

function suscribirInactivo(): () => void {
  return () => {};
}

/** Cuántos repartidores con la jornada abierta dejaron de enviar su
 * ubicación: se ve en el menú desde cualquier pantalla. Un único sondeo
 * compartido aunque lo monten la barra lateral y las pestañas del área. */
export function useSinSenal(activo: boolean): number {
  return useSyncExternalStore(
    activo ? suscribirSinSenal : suscribirInactivo,
    () => (activo ? sinSenalValor : 0),
    () => 0
  );
}

/** "hace 3 min", "hace 1 h 10 min". */
export function haceCuanto(minutos: number | null): string {
  if (minutos == null) return "sin datos";
  if (minutos < 1) return "ahora";
  if (minutos < 60) return `hace ${minutos} min`;
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return m ? `hace ${h} h ${m} min` : `hace ${h} h`;
}
