"use client";

import { useState, useSyncExternalStore } from "react";
import { ArrowDownIcon, MapIcon, PhoneIcon } from "lucide-react";
import { SeguimientoDetalleMap } from "@/components/modules/seguimiento/seguimiento-detalle-map";
import { ParadaAcciones, type MarcasParada } from "@/components/modules/despachador/parada-acciones";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { documentoDespacho } from "@/lib/constants";
import type { Cliente, Despacho, EstadoRuta, RutaPunto } from "@/lib/mock-data";
import { cn } from "@/lib/utils";

type Parada = Despacho & { destinoCliente: Cliente };

// Desde este ancho la lista y el mapa van lado a lado (el `lg` de Tailwind).
const ESCRITORIO = "(min-width: 1024px)";

/** En el teléfono el mapa se abre a pedido; en la computadora siempre se ve.
 * En el servidor no se sabe el ancho: se arranca como teléfono. */
function useEsEscritorio() {
  return useSyncExternalStore(
    (avisar) => {
      const consulta = window.matchMedia(ESCRITORIO);
      consulta.addEventListener("change", avisar);
      return () => consulta.removeEventListener("change", avisar);
    },
    () => window.matchMedia(ESCRITORIO).matches,
    () => false
  );
}

function irAParada(id: string) {
  document.getElementById(`parada-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
}

/** El viaje del repartidor: lista de paradas y mapa compartiendo un mismo
 * estado en memoria.
 *
 * Es lo que hace que al marcar una entrega cambien de inmediato el botón,
 * la hora, el badge y el color del punto en el mapa. Antes todo eso dependía
 * de que Next volviera a renderizar la página, lo que en un viaje de decenas
 * de paradas implica reenviar el trazado completo (miles de vértices) y
 * redibujar el mapa: se veía como si el botón no hiciera nada.
 *
 * Pensado para el teléfono: la lista va primero (antes el mapa ocupaba toda
 * la pantalla y no se notaba que había que bajar a marcar), la siguiente
 * parada se resalta y el mapa se abre a pedido, y se mueve con dos dedos
 * para que un dedo siga bajando la página. */
export function ViajeEnCurso({
  rutaId,
  estadoRuta,
  enCaminoDesde,
  puntos,
  paradas: paradasDelServidor,
}: {
  rutaId: string;
  estadoRuta: EstadoRuta;
  /** «En camino desde las …», ya formateado: va en el resumen. */
  enCaminoDesde?: string;
  puntos: RutaPunto[];
  paradas: Parada[];
}) {
  // Las marcas recién puestas se guardan como una capa encima de lo que
  // manda el servidor, en vez de copiar las paradas a estado: así, cuando
  // el router.refresh() trae datos nuevos (por ejemplo al iniciar el viaje,
  // que pasa todas las paradas a EN_TRANSITO), la pantalla los toma. La
  // capa y el servidor terminan diciendo lo mismo.
  const [marcasPropias, setMarcasPropias] = useState<Record<string, MarcasParada>>({});
  // Las que marcó «No se pudo entregar»: salen de la lista y del mapa sin
  // esperar a que el servidor deje de mandarlas.
  const [noEntregadas, setNoEntregadas] = useState<string[]>([]);
  const [mapaAbierto, setMapaAbierto] = useState(false);
  const escritorio = useEsEscritorio();
  const paradas = paradasDelServidor
    .filter((p) => !noEntregadas.includes(p.id))
    .map((p) => ({ ...p, ...marcasPropias[p.id] }));

  const enTransito = estadoRuta === "EN_TRANSITO";
  const entregadas = paradas.filter((p) => p.estado === "ENTREGADO").length;
  const siguiente = enTransito ? paradas.find((p) => p.estado === "EN_TRANSITO") : undefined;
  const verMapa = escritorio || mapaAbierto;

  function marcada(parada: Parada, marcas: MarcasParada) {
    setMarcasPropias((previas) => ({ ...previas, [parada.id]: marcas }));
    // Entregada: se baja sola a la que sigue, para no buscarla entre decenas.
    if (marcas.estado === "ENTREGADO") {
      const proxima = paradas.find((p) => p.id !== parada.id && p.estado === "EN_TRANSITO");
      if (proxima) setTimeout(() => irAParada(proxima.id), 300);
    }
  }

  return (
    <div className="space-y-4">
      <Card className="py-3">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 px-4">
          <div className="min-w-0 space-y-0.5">
            {enTransito && enCaminoDesde && <p className="text-xs text-muted-foreground">{enCaminoDesde}</p>}
            <p className="text-base font-semibold">
              {enTransito
                ? `${entregadas} de ${paradas.length} parada(s) entregadas`
                : `${paradas.length} parada(s) en esta ruta`}
            </p>
            {siguiente && (
              <p className="truncate text-sm text-muted-foreground">
                Siguiente: {paradas.indexOf(siguiente) + 1}. {siguiente.destinoCliente.nombre}
              </p>
            )}
            {enTransito && !siguiente && paradas.length > 0 && (
              <p className="text-sm text-muted-foreground">Ya entregaste todas las paradas.</p>
            )}
          </div>
          <div className="flex w-full gap-2 sm:w-auto">
            {siguiente && (
              <Button className="h-11 flex-1 sm:h-8 sm:flex-none" onClick={() => irAParada(siguiente.id)}>
                <ArrowDownIcon />
                Ir a la siguiente
              </Button>
            )}
            {puntos.length > 0 && (
              <Button
                variant="outline"
                className="h-11 flex-1 sm:h-8 sm:flex-none lg:hidden"
                aria-expanded={mapaAbierto}
                onClick={() => setMapaAbierto((v) => !v)}
              >
                <MapIcon />
                {mapaAbierto ? "Ocultar mapa" : "Ver mapa"}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5 lg:items-start">
        {verMapa && (
          <div className="space-y-1.5 lg:sticky lg:top-4 lg:order-2 lg:col-span-2">
            {puntos.length > 0 ? (
              <>
                <SeguimientoDetalleMap
                  ruta={puntos}
                  paradas={paradas}
                  className="h-72 lg:h-[32rem]"
                  arrastreConUnDedo={false}
                />
                <p className="text-xs text-muted-foreground lg:hidden">Para mover el mapa, usa dos dedos.</p>
              </>
            ) : (
              <Card>
                <CardContent className="flex h-48 items-center justify-center text-center text-sm text-muted-foreground lg:h-[32rem]">
                  Esta ruta todavía no tiene un trazado calculado.
                </CardContent>
              </Card>
            )}
          </div>
        )}

        <Card className="lg:order-1 lg:col-span-3">
          <CardHeader>
            <CardTitle>Paradas</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {paradas.map((d, index) => {
              const esSiguiente = d.id === siguiente?.id;
              const entregada = d.estado === "ENTREGADO";
              const { telefono } = d.destinoCliente;
              return (
                <div
                  key={d.id}
                  id={`parada-${d.id}`}
                  className={cn(
                    // En el teléfono: datos, botones de marcar y después lo demás
                    // (cómo llegar, productos), para que «Llegué» quede a la vista.
                    // En pantallas grandes los botones van a la derecha.
                    "grid scroll-mt-24 gap-3 rounded-lg border p-3 text-sm sm:grid-cols-[1fr_auto] sm:items-start",
                    esSiguiente ? "border-primary bg-primary/5 ring-1 ring-primary/30" : "border-border",
                    entregada && "bg-muted/40"
                  )}
                >
                  <div className="min-w-0 space-y-1 sm:col-start-1">
                    <p className="flex flex-wrap items-center gap-2 font-medium text-foreground">
                      <span>
                        {index + 1}. {d.destinoCliente.nombre}
                      </span>
                      {esSiguiente && <StatusBadge tone="primary" label="Siguiente" />}
                    </p>
                    <p className="text-muted-foreground">
                      <span className="font-medium text-foreground">{documentoDespacho(d)}</span> · cód.{" "}
                      {d.destinoCliente.codigo} · {d.destinoCliente.direccion}, {d.destinoCliente.ciudad}
                    </p>
                  </div>
                  <div className="sm:col-start-2 sm:row-span-2 sm:row-start-1">
                    <ParadaAcciones
                      rutaId={rutaId}
                      despachoId={d.id}
                      rutaEnTransito={enTransito}
                      marcas={{ estado: d.estado, llegadaEn: d.llegadaEn, entregadoEn: d.entregadoEn }}
                      onMarcado={(marcas) => marcada(d, marcas)}
                      onNoEntregado={() => setNoEntregadas((previas) => [...previas, d.id])}
                    />
                  </div>
                  {/* Lo entregado se achica: con decenas de paradas, la lista se
                      recorre más rápido. */}
                  {!entregada && (
                    <div className="min-w-0 space-y-2 sm:col-start-1">
                      {/* Sin enlaces a Google Maps ni Waze: el recorrido se sigue
                          en la aplicación (decisión del cliente). */}
                      {telefono && (
                        <div className="flex flex-wrap gap-2">
                          <Button asChild variant="outline" size="sm" className="h-10 sm:h-7">
                            <a href={`tel:${telefono.replace(/[^\d+]/g, "")}`}>
                              <PhoneIcon />
                              Llamar
                            </a>
                          </Button>
                        </div>
                      )}
                      <ul className="text-xs text-muted-foreground">
                        {d.items.map((item) => (
                          <li key={item.id}>
                            {item.cantidad}× {item.descripcion}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
