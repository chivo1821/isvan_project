import Link from "@/components/shared/enlace";
import { notFound } from "next/navigation";
import { CheckIcon, CircleIcon, FlagIcon, MapPinIcon, TruckIcon, XIcon } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { AutoRefresco } from "@/components/shared/auto-refresco";
import { MotivoNoEntregado } from "@/components/shared/no-entregado";
import { StatusBadge } from "@/components/shared/status-badge";
import { SeguimientoDetalleMap } from "@/components/modules/seguimiento/seguimiento-detalle-map";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ESTADO_RUTA_META, estadoDeParada, formatDateTime, formatHora, textoParadas } from "@/lib/constants";
import { getRutaConDetalle, type NoEntregado } from "@/lib/mock-data";
import { conNoEntregadas, ETIQUETA_NO_ENTREGADO } from "@/lib/no-entregados";
import { apiGet } from "@/lib/api-client";
import type { RecorridoReal } from "@/lib/seguimiento";
import { cn } from "@/lib/utils";

type Hito = {
  clave: string;
  icono: typeof TruckIcon;
  /** Ya pasó (en color) o todavía no (gris). */
  hecho: boolean;
  titulo: string;
  enlace?: { href: string; texto: string };
  estado?: ReturnType<typeof estadoDeParada>;
  detalle?: string;
  /** Salió de la ruta sin entregarse: va en rojo, con su botón de motivo. */
  noEntregado?: NoEntregado;
};

export default async function SeguimientoDetallePage({ params }: PageProps<"/seguimiento/[id]">) {
  const { id } = await params;
  const ruta = await getRutaConDetalle(id);
  if (!ruta) notFound();

  // El recorrido real solo existe si el repartidor usó la app en la ruta.
  const recorrido = ruta.iniciadaEn
    ? await apiGet<RecorridoReal>(`/rutas/${encodeURIComponent(ruta.id)}/recorrido`).catch(() => null)
    : null;

  // La línea de tiempo con lo que de verdad pasó: la salida del almacén y,
  // por cliente, la llegada y la entrega que marcó el repartidor (en la app
  // o en la web). Lo que falta queda en gris, en el orden de la ruta.
  const paradas = [...ruta.despachos].sort((a, b) => (a.ordenEnRuta ?? 0) - (b.ordenEnRuta ?? 0));
  const esMoto = ruta.vehiculo?.tipo === "MOTO";
  const entregados = paradas.filter((d) => d.entregadoEn || d.estado === "ENTREGADO").length;
  const noEntregados = ruta.noEntregados ?? [];
  const hitos: Hito[] = [
    {
      clave: "salida",
      icono: TruckIcon,
      hecho: Boolean(ruta.iniciadaEn),
      titulo: ruta.iniciadaEn ? "Salió del almacén" : "Todavía no sale del almacén",
      detalle: ruta.iniciadaEn ? formatDateTime(ruta.iniciadaEn) : ruta.origen.nombre,
    },
    ...conNoEntregadas(paradas, noEntregados).map(({ tipo, parada }, i): Hito => {
      const numero = `${i + 1}. `;
      if (tipo === "no") {
        return {
          clave: `no-${parada.despachoId}`,
          icono: XIcon,
          hecho: true,
          titulo: `${numero}${parada.cliente.nombre}`,
          enlace: { href: `/despachos/${parada.despachoId}`, texto: parada.numero },
          estado: { tone: "destructive", label: ETIQUETA_NO_ENTREGADO[parada.alcance] },
          detalle: [
            parada.llegadaEn && `Llegó ${formatHora(parada.llegadaEn)}`,
            `Marcado ${formatHora(parada.fecha)}`,
          ]
            .filter(Boolean)
            .join(" · "),
          noEntregado: parada,
        };
      }
      const d = parada;
      const entregado = Boolean(d.entregadoEn) || d.estado === "ENTREGADO";
      const marcas = [
        d.salidaEn && `Salió ${formatHora(d.salidaEn)}`,
        d.llegadaEn && `Llegó ${formatHora(d.llegadaEn)}`,
        d.entregadoEn && `Entregó ${formatHora(d.entregadoEn)}`,
      ].filter(Boolean);
      return {
        clave: d.id,
        icono: entregado ? CheckIcon : d.llegadaEn ? MapPinIcon : d.salidaEn ? TruckIcon : CircleIcon,
        hecho: entregado || Boolean(d.llegadaEn) || Boolean(d.salidaEn),
        titulo: `${numero}${d.destinoCliente.nombre}`,
        enlace: { href: `/despachos/${d.id}`, texto: d.numero },
        estado: estadoDeParada(d, { esMoto }),
        detalle: marcas.length > 0 ? marcas.join(" · ") : undefined,
      };
    }),
  ];
  if (ruta.completadaEn) {
    hitos.push({
      clave: "fin",
      icono: FlagIcon,
      hecho: true,
      titulo: "Ruta terminada",
      detalle: formatDateTime(ruta.completadaEn),
    });
  }

  return (
    <div className="space-y-6">
      <AutoRefresco versionPath={`/rutas/seguimiento/version?ruta=${encodeURIComponent(ruta.id)}`} />
      <PageHeader
        title={`Seguimiento — ${ruta.numero}`}
        subtitle={`${ruta.origen.nombre} · ${ruta.vehiculo?.placa ?? "sin vehículo asignado"} · ${textoParadas(ruta.despachos)}`}
        actions={<StatusBadge {...ESTADO_RUTA_META[ruta.estado]} />}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {ruta.puntos.length > 0 ? (
            <SeguimientoDetalleMap
              ruta={ruta.puntos}
              paradas={ruta.despachos}
              noEntregados={ruta.noEntregados}
              rutaId={ruta.id}
              recorridoInicial={recorrido}
              enTransito={ruta.estado === "EN_TRANSITO"}
              esMoto={esMoto}
            />
          ) : (
            <Card>
              <CardContent className="flex h-[26rem] items-center justify-center text-sm text-muted-foreground">
                Esta ruta todavía no tiene puntos de trazado registrados.
              </CardContent>
            </Card>
          )}
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Línea de tiempo</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-4 text-sm text-muted-foreground">
              Entregados {entregados} de {paradas.length + noEntregados.length}
              {noEntregados.length > 0 && (
                <span className="text-destructive"> · {noEntregados.length} sin entregar</span>
              )}
            </p>
            <ol className="space-y-4">
              {hitos.map((h, index) => {
                const Icono = h.icono;
                const esUltimo = index === hitos.length - 1;
                return (
                  <li key={h.clave} className="relative flex gap-3 pb-1">
                    {!esUltimo && (
                      <span className="absolute top-6 left-[11px] h-full w-px bg-border" aria-hidden="true" />
                    )}
                    <span
                      className={cn(
                        "z-10 flex size-6 shrink-0 items-center justify-center rounded-full",
                        h.noEntregado
                          ? "bg-destructive text-white"
                          : h.hecho
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-muted-foreground"
                      )}
                    >
                      <Icono className="size-3.5" />
                    </span>
                    <div className="min-w-0 space-y-0.5 text-sm">
                      <p className={cn("font-medium", h.hecho ? "text-foreground" : "text-muted-foreground")}>
                        {h.titulo}
                      </p>
                      {(h.enlace || h.estado) && (
                        <p className="flex flex-wrap items-center gap-1.5">
                          {h.enlace && (
                            <Link href={h.enlace.href} className="text-primary hover:underline">
                              {h.enlace.texto}
                            </Link>
                          )}
                          {h.estado && <StatusBadge {...h.estado} />}
                        </p>
                      )}
                      {h.detalle && <p className="text-xs text-muted-foreground">{h.detalle}</p>}
                      {h.noEntregado && <MotivoNoEntregado parada={h.noEntregado} className="mt-1" />}
                    </div>
                  </li>
                );
              })}
            </ol>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
