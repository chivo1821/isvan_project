import NextLink from "next/link";
import type { ComponentProps } from "react";

/**
 * El `Link` de Next sin precarga automática. Úsalo en vez de `next/link`.
 *
 * Por defecto Next precarga cada enlace que aparece en pantalla. Aquí todas
 * las páginas son dinámicas, así que cada precarga enciende una función en
 * Vercel (y esa página llama a la API, que es otra función). Con el menú
 * lateral y las listas de rutas, abrir una pantalla disparaba decenas de
 * precargas que casi nadie usaba: el 83 % de las páginas renderizadas en
 * producción el 2026-11-12, y el aviso de Vercel de que se estaba acabando
 * la CPU del plan gratis.
 *
 * Sin precarga, la página se pide al hacer clic (tarda un poco más en
 * cambiar). Si algún enlace la necesita de verdad, se le pasa `prefetch`.
 */
export default function Link({ prefetch = false, ...props }: ComponentProps<typeof NextLink>) {
  return <NextLink prefetch={prefetch} {...props} />;
}
