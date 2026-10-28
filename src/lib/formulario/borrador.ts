/**
 * Borrador del censo en el teléfono, para no perder un censo a medias.
 *
 * Al tomar una foto, el celular abre la app de cámara y el navegador queda en
 * segundo plano; algunos sistemas (MagicOS de Honor, por ejemplo) cierran la
 * pestaña para ahorrar memoria o batería, y al volver la página se recarga
 * vacía. Con el borrador, el censo se recupera tal como estaba.
 *
 * Va en IndexedDB y no en localStorage porque guarda las fotos (archivos de
 * 1-2,5 MB, ver comprimir.ts). Si el navegador no deja usarlo (modo
 * incógnito, sin espacio), el formulario sigue funcionando sin borrador.
 */

import type { Respuestas } from "./motor";

export type Borrador = {
  /** id y versión del formulario: un borrador de otra versión se descarta. */
  formulario: string;
  guardadoEn: number;
  /** Cuándo se empezó el censo (ISO), para iniciadoEn. */
  inicio: string;
  respuestas: Respuestas;
  fotos: Record<string, File>;
  tocadas: string[];
};

const BASE = "gestion-logistica";
const ALMACEN = "borradores-censo";
/** Un borrador más viejo que esto ya no se recupera. */
export const VIGENCIA_MS = 3 * 24 * 60 * 60 * 1000;

function abrir(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const pedido = indexedDB.open(BASE, 1);
    pedido.onupgradeneeded = () => pedido.result.createObjectStore(ALMACEN);
    pedido.onsuccess = () => resolve(pedido.result);
    pedido.onerror = () => reject(pedido.error);
  });
}

async function operar<T>(modo: IDBTransactionMode, accion: (almacen: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const base = await abrir();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaccion = base.transaction(ALMACEN, modo);
      const pedido = accion(transaccion.objectStore(ALMACEN));
      transaccion.oncomplete = () => resolve(pedido.result);
      transaccion.onerror = () => reject(transaccion.error);
      transaccion.onabort = () => reject(transaccion.error);
    });
  } finally {
    base.close();
  }
}

export async function leerBorrador(clave: string, formulario: string): Promise<Borrador | null> {
  try {
    const borrador = (await operar("readonly", (a) => a.get(clave))) as Borrador | undefined;
    if (!borrador) return null;
    if (borrador.formulario !== formulario || Date.now() - borrador.guardadoEn > VIGENCIA_MS) {
      await borrarBorrador(clave);
      return null;
    }
    return borrador;
  } catch {
    return null;
  }
}

export async function guardarBorrador(clave: string, borrador: Borrador): Promise<void> {
  try {
    await operar("readwrite", (a) => a.put(borrador, clave));
  } catch {
    // Sin borrador: el censo se puede llenar igual.
  }
}

export async function borrarBorrador(clave: string): Promise<void> {
  try {
    await operar("readwrite", (a) => a.delete(clave));
  } catch {
    // Nada que borrar o IndexedDB no disponible.
  }
}
