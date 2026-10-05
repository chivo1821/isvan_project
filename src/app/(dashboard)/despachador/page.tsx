import Link from "next/link";
import { ChevronRightIcon, PackageIcon, PackageSearchIcon, WarehouseIcon } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { AvisosRuta } from "@/components/modules/rutas/avisos-ruta";
import { ESTADO_RUTA_META, describirVehiculo, formatHora } from "@/lib/constants";
import { getRutasActivas, type RutaConDetalle } from "@/lib/mock-data";
import { getUsuarioActual } from "@/lib/session";

const ZONA = "America/Caracas";
const diaDe = (iso: string | Date) => new Intl.DateTimeFormat("en-CA", { timeZone: ZONA }).format(new Date(iso));
const DIA_LARGO = new Intl.DateTimeFormat("es-VE", { weekday: "long", day: "numeric", month: "long", timeZone: ZONA });

function etiquetaDia(dia: string, hoy: string, manana: string, ejemplo: string) {
  if (dia === hoy) return "Hoy";
  if (dia === manana) return "Mañana";
  const texto = DIA_LARGO.format(new Date(ejemplo));
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/** Los pedidos que tiene asignados el repartidor, con la fecha y hora en que
 * tiene que recogerlos en el almacén (la salida programada de su ruta). Ahora
 * puede tener varias rutas planificadas: van por día, la próxima primero. */
export default async function DespachadorPage() {
  const [rutas, usuarioActual] = await Promise.all([getRutasActivas(), getUsuarioActual()]);
  // Un repartidor sin vehículo asignado no ve ninguna ruta (la API se las
  // filtra por vehículo). Sin este aviso, la pantalla vacía no explica nada.
  const sinVehiculo = usuarioActual?.rol === "REPARTIDOR" && !usuarioActual.vehiculoAsignadoId;

  // La que está en camino primero; después, por hora de salida.
  const ordenadas = [...rutas].sort(
    (a, b) =>
      Number(b.estado === "EN_TRANSITO") - Number(a.estado === "EN_TRANSITO") ||
      a.salidaProgramada.localeCompare(b.salidaProgramada)
  );
  const ahora = new Date();
  const hoy = diaDe(ahora);
  const manana = diaDe(new Date(ahora.getTime() + 24 * 3600 * 1000));
  const porDia = new Map<string, RutaConDetalle[]>();
  for (const r of ordenadas) {
    const dia = r.estado === "EN_TRANSITO" ? hoy : diaDe(r.salidaProgramada);
    porDia.set(dia, [...(porDia.get(dia) ?? []), r]);
  }
  const pedidos = rutas.reduce((n, r) => n + r.despachos.length, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Mis pedidos"
        subtitle={
          rutas.length
            ? `${pedidos} pedido(s) en ${rutas.length} ruta(s), con la hora de recogida en el almacén`
            : "Tus rutas y la hora en que tienes que recoger cada pedido en el almacén"
        }
      />

      {rutas.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center text-sm text-muted-foreground">
            <PackageSearchIcon className="size-8" />
            {sinVehiculo
              ? "Todavía no tienes un vehículo asignado — pídele a un administrador que te asigne uno para ver tus pedidos."
              : "No tienes pedidos asignados por ahora."}
          </CardContent>
        </Card>
      ) : (
        [...porDia.entries()].map(([dia, delDia]) => (
          <section key={dia} className="space-y-3">
            <h2 className="font-heading text-base font-medium">{etiquetaDia(dia, hoy, manana, delDia[0].salidaProgramada)}</h2>
            {delDia.map((r) => (
              <Card key={r.id}>
                <CardContent className="space-y-3 text-sm">
                  <Link
                    href={`/despachador/${r.id}`}
                    className="-m-2 flex flex-wrap items-center justify-between gap-2 rounded-md p-2 transition-colors hover:bg-muted/60"
                  >
                    <div className="space-y-0.5">
                      <p className="flex items-center gap-1.5 text-base font-semibold">
                        {r.estado === "EN_TRANSITO" ? (
                          <>En camino desde las {formatHora(r.iniciadaEn ?? r.salidaProgramada)}</>
                        ) : (
                          <>
                            <WarehouseIcon className="size-4 text-muted-foreground" aria-hidden />
                            Recoger en el almacén a las {formatHora(r.salidaProgramada)}
                          </>
                        )}
                      </p>
                      <p className="text-muted-foreground">
                        Ruta {r.numero} · {describirVehiculo(r.vehiculo)} · {r.despachos.length} pedido(s)
                      </p>
                    </div>
                    <span className="flex items-center gap-2">
                      <StatusBadge {...ESTADO_RUTA_META[r.estado]} />
                      <ChevronRightIcon className="size-4 text-muted-foreground" aria-hidden />
                    </span>
                  </Link>
                  <AvisosRuta avisos={r.avisos?.filter((a) => a.tipo === "SALIDA_VENCIDA")} />
                  <ol className="divide-y rounded-md border">
                    {r.despachos.map((d, i) => (
                      <li key={d.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-3 py-2">
                        <span>
                          <span className="mr-2 text-xs text-muted-foreground tabular-nums">{i + 1}.</span>
                          <span className="font-medium">{d.destinoCliente.nombre}</span>
                          <span className="block pl-5 text-xs text-muted-foreground">
                            {[d.destinoCliente.direccion, d.destinoCliente.ciudad].filter(Boolean).join(", ")}
                          </span>
                        </span>
                        <span className="flex items-center gap-1.5 pl-5 text-xs text-muted-foreground">
                          <PackageIcon className="size-3.5" aria-hidden />
                          Pedido {d.numero}
                          {d.items?.length ? ` · ${d.items.length} producto(s)` : ""}
                        </span>
                      </li>
                    ))}
                  </ol>
                </CardContent>
              </Card>
            ))}
          </section>
        ))
      )}
    </div>
  );
}
