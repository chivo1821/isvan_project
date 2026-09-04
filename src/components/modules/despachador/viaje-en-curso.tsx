"use client";

import { useState } from "react";
import { SeguimientoDetalleMap } from "@/components/modules/seguimiento/seguimiento-detalle-map";
import { ParadaAcciones, type MarcasParada } from "@/components/modules/despachador/parada-acciones";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Cliente, Despacho, EstadoRuta, RutaPunto } from "@/lib/mock-data";

type Parada = Despacho & { destinoCliente: Cliente };

/** El viaje del repartidor: mapa y lista de paradas compartiendo un mismo
 * estado en memoria.
 *
 * Es lo que hace que al marcar una entrega cambien de inmediato el botón,
 * la hora, el badge y el color del punto en el mapa. Antes todo eso dependía
 * de que Next volviera a renderizar la página, lo que en un viaje de decenas
 * de paradas implica reenviar el trazado completo (miles de vértices) y
 * redibujar el mapa: se veía como si el botón no hiciera nada. */
export function ViajeEnCurso({
  rutaId,
  estadoRuta,
  puntos,
  paradas: paradasDelServidor,
}: {
  rutaId: string;
  estadoRuta: EstadoRuta;
  puntos: RutaPunto[];
  paradas: Parada[];
}) {
  // Las marcas recién puestas se guardan como una capa encima de lo que
  // manda el servidor, en vez de copiar las paradas a estado: así, cuando
  // el router.refresh() trae datos nuevos (por ejemplo al iniciar el viaje,
  // que pasa todas las paradas a EN_TRANSITO), la pantalla los toma. La
  // capa y el servidor terminan diciendo lo mismo.
  const [marcasPropias, setMarcasPropias] = useState<Record<string, MarcasParada>>({});
  const paradas = paradasDelServidor.map((p) => ({ ...p, ...marcasPropias[p.id] }));

  return (
    <>
      {puntos.length > 0 ? (
        <SeguimientoDetalleMap ruta={puntos} paradas={paradas} className="h-[28rem]" />
      ) : (
        <Card>
          <CardContent className="flex h-[28rem] items-center justify-center text-center text-sm text-muted-foreground">
            Esta ruta todavía no tiene un trazado calculado.
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Paradas</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {paradas.map((d, index) => (
            <div
              key={d.id}
              className="flex flex-col items-start justify-between gap-3 rounded-lg border border-border p-3 text-sm sm:flex-row sm:items-center"
            >
              <div>
                <p className="font-medium text-foreground">
                  {index + 1}. {d.destinoCliente.nombre}
                </p>
                <p className="text-muted-foreground">
                  {d.numero} · {d.destinoCliente.direccion}, {d.destinoCliente.ciudad}
                </p>
                <ul className="mt-1 text-xs text-muted-foreground">
                  {d.items.map((item) => (
                    <li key={item.id}>
                      {item.cantidad}× {item.descripcion}
                    </li>
                  ))}
                </ul>
              </div>
              <ParadaAcciones
                rutaId={rutaId}
                despachoId={d.id}
                rutaEnTransito={estadoRuta === "EN_TRANSITO"}
                marcas={{ estado: d.estado, llegadaEn: d.llegadaEn, entregadoEn: d.entregadoEn }}
                onMarcado={(marcas) => setMarcasPropias((previas) => ({ ...previas, [d.id]: marcas }))}
              />
            </div>
          ))}
        </CardContent>
      </Card>
    </>
  );
}
