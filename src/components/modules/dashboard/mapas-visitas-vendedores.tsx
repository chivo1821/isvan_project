"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { estiloMarca, MARCA_OTROS, marcaVendedor } from "@/lib/marcas-vendedor";
import type { Empresa } from "@/lib/mock-data";
import type { RendimientoVendedores } from "@/lib/vendedor";

const LeafletMap = dynamic(() => import("@/components/map/leaflet-map").then((m) => m.LeafletMap), {
  ssr: false,
  loading: () => <div className="h-96 w-full animate-pulse rounded-lg bg-muted" />,
});
const PuntoVisitaVendedor = dynamic(
  () => import("@/components/map/punto-visita-vendedor").then((m) => m.PuntoVisitaVendedor),
  { ssr: false }
);

const EMPRESAS: Empresa[] = ["ISVAN", "TRALOG"];

/** Dónde se hicieron las visitas del período, con una marca (color y forma)
 * por vendedor en orden fijo (el de la tabla): la misma en las dos empresas
 * y con cualquier filtro de fechas. Una empresa a la vez (se cambia arriba
 * del mapa) para no saturar la vista. Sale de la ubicación del teléfono al empezar cada visita; las que
 * no tomaron GPS no aparecen. */
export function MapasVisitasVendedores({ rendimiento: r }: { rendimiento: RendimientoVendedores }) {
  const [empresa, setEmpresa] = useState<Empresa>("ISVAN");
  const marcaDe = new Map(r.porVendedor.map((v, i) => [v.vendedorId, marcaVendedor(i)]));
  const nombreDe = new Map(r.porVendedor.map((v) => [v.vendedorId, v.nombre]));

  const visitas = r.visitas.filter((v) => v.empresa === empresa);
  // Leyenda: solo quien tiene puntos en este mapa, en el orden de la tabla.
  const leyenda = r.porVendedor
    .map((v) => ({ ...v, puntos: visitas.filter((x) => x.vendedorId === v.vendedorId).length }))
    .filter((v) => v.puntos > 0);
  const puntos: [number, number][] = visitas.map((v) => [v.lat, v.lng]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-foreground">Mapa de visitas</p>
        <Tabs value={empresa} onValueChange={(v) => setEmpresa(v as Empresa)}>
          <TabsList>
            {EMPRESAS.map((e) => (
              <TabsTrigger key={e} value={e}>
                {e} ({r.visitas.filter((v) => v.empresa === e).length})
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
      {visitas.length === 0 ? (
        <div className="flex h-96 items-center justify-center rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
          Sin visitas de {empresa} con ubicación en este período.
        </div>
      ) : (
        // key: un mapa nuevo al cambiar de empresa. bounds también con un
        // solo punto, para que se vuelva a encuadrar cuando cambia el
        // período. Sin zoom con la rueda: en el resumen, la rueda baja la
        // página (zoom con + y −).
        <LeafletMap
          key={empresa}
          center={puntos[0]}
          zoom={13}
          bounds={puntos}
          scrollWheelZoom={false}
          className="h-96"
        >
          {visitas.map((v, i) => (
            <PuntoVisitaVendedor
              key={`${v.vendedorId}-${v.llegadaEn}-${i}`}
              visita={v}
              vendedor={nombreDe.get(v.vendedorId) ?? "Vendedor"}
              marca={marcaDe.get(v.vendedorId) ?? MARCA_OTROS}
              distanciaMaxM={r.distanciaMaxM}
            />
          ))}
        </LeafletMap>
      )}
      {leyenda.length > 0 && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {leyenda.map((v) => (
            <li key={v.vendedorId} className="flex items-center gap-1.5">
              <span style={estiloMarca(marcaDe.get(v.vendedorId) ?? MARCA_OTROS, 10)} aria-hidden />
              <span className="text-foreground">{v.nombre}</span> ({v.puntos})
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
