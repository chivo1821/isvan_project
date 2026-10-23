import { AlertTriangleIcon, MapPinIcon, StoreIcon, Undo2Icon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { ClientePorCensar, PendientesVendedor } from "@/lib/censo";
import { formatNumero } from "@/lib/constants";

function porRuta(clientes: ClientePorCensar[]) {
  const grupos = new Map<string, ClientePorCensar[]>();
  for (const c of clientes) {
    const clave = `${c.empresa} · Ruta ${c.ruta}`;
    grupos.set(clave, [...(grupos.get(clave) ?? []), c]);
  }
  return [...grupos.entries()];
}

/** Arriba del formulario del censo: los clientes de sus rutas (según la
 * maestra) que faltan por registrar en el sistema, y sus censos con algo
 * pendiente. */
export function PendientesDelVendedor({ datos }: { datos: PendientesVendedor }) {
  const { porRegistrar, pendientesVentas, revisar, sinCodigo, devueltos } = datos;
  if (
    !devueltos.length &&
    !sinCodigo.length &&
    (!datos.rutas.length || (!datos.conMaestra.length && !pendientesVentas.length && !revisar.length))
  )
    return null;

  return (
    <div className="space-y-3">
      {devueltos.length > 0 && (
        <Alert variant="destructive">
          <Undo2Icon />
          <AlertTitle>
            {formatNumero(devueltos.length)} censo{devueltos.length === 1 ? "" : "s"} devuelto
            {devueltos.length === 1 ? "" : "s"}: vuelve a censarlo{devueltos.length === 1 ? "" : "s"}
          </AlertTitle>
          <AlertDescription>
            <ul className="w-full divide-y text-sm">
              {devueltos.map((d) => (
                <li key={d.id} className="py-1.5">
                  <span className="font-medium text-foreground">{d.nombre ?? "Sin nombre"}</span>
                  {d.codigos.length > 0 && (
                    <span className="tabular-nums text-muted-foreground"> ({d.codigos.join(", ")})</span>
                  )}
                  <span className="block">{d.motivo}</span>
                  <span className="block text-xs text-muted-foreground">
                    {[d.ruta, `censado el ${d.fecha}`, `devuelto el ${d.devueltoEl}`].filter(Boolean).join(" · ")}
                  </span>
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
      {porRegistrar.length > 0 ? (
        <Alert>
          <MapPinIcon />
          <AlertTitle>
            Tienes {formatNumero(porRegistrar.length)} cliente{porRegistrar.length === 1 ? "" : "s"} por registrar en
            tus rutas
          </AlertTitle>
          <AlertDescription>
            <div className="w-full space-y-1">
              <p className="text-sm">
                Todavía no están en el sistema. Los marcados “Ya censado” tienen censo, pero falta corregirlo (revisa
                los avisos de abajo).
              </p>
              {porRuta(porRegistrar).map(([ruta, clientes]) => (
                <details key={ruta} className="group rounded-md border border-border px-3 py-2">
                  <summary className="cursor-pointer text-sm font-medium text-foreground">
                    {ruta}: {formatNumero(clientes.length)}
                  </summary>
                  <ul className="mt-2 divide-y text-sm">
                    {clientes.map((c) => (
                      <li key={`${c.empresa}-${c.codigo}`} className="py-1.5">
                        <span className="font-medium text-foreground">{c.razonSocial}</span>{" "}
                        <span className="tabular-nums text-muted-foreground">({c.codigo})</span>
                        {c.censado && (
                          <span className="ml-1.5 rounded-full bg-info/15 px-1.5 text-xs text-foreground">Ya censado</span>
                        )}
                        <span className="block text-xs text-muted-foreground">
                          {[c.diaVisita && `Día de visita ${c.diaVisita}`, c.zona, c.direccion]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              ))}
            </div>
          </AlertDescription>
        </Alert>
      ) : (
        datos.conMaestra.length > 0 && (
          <Alert>
            <MapPinIcon />
            <AlertTitle>Todos los clientes de tus rutas ya están registrados</AlertTitle>
          </Alert>
        )
      )}

      {revisar.length > 0 && (
        <Alert variant="destructive">
          <AlertTriangleIcon />
          <AlertTitle>
            {formatNumero(revisar.length)} censo{revisar.length === 1 ? "" : "s"} con un código para revisar
          </AlertTitle>
          <AlertDescription>
            <ul className="space-y-1 text-sm">
              {revisar.map((r) => (
                <li key={`${r.id}-${r.empresa}`}>{r.motivo}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {sinCodigo.length > 0 && (
        <Alert>
          <AlertTriangleIcon />
          <AlertTitle>
            {formatNumero(sinCodigo.length)} censo{sinCodigo.length === 1 ? "" : "s"} sin código de cliente
          </AlertTitle>
          <AlertDescription>
            <p className="text-sm">
              Sin el código no se pueden registrar. Vuelve a censarlos con su empresa y código.
            </p>
            <details className="w-full rounded-md border border-border px-3 py-2">
              <summary className="cursor-pointer text-sm font-medium text-foreground">Ver la lista</summary>
              <ul className="mt-2 divide-y text-sm">
                {sinCodigo.map((c) => (
                  <li key={c.id} className="py-1.5">
                    <span className="font-medium text-foreground">{c.nombre ?? "Sin nombre"}</span>
                    <span className="block text-xs text-muted-foreground">
                      {[c.tipoCliente, c.rif && `RIF ${c.rif}`, c.ruta, c.fecha].filter(Boolean).join(" · ")}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          </AlertDescription>
        </Alert>
      )}

      {pendientesVentas.length > 0 && (
        <Alert>
          <StoreIcon />
          <AlertTitle>
            {formatNumero(pendientesVentas.length)} cliente{pendientesVentas.length === 1 ? "" : "s"} censado
            {pendientesVentas.length === 1 ? "" : "s"} por crear en ventas
          </AlertTitle>
          <AlertDescription>
            <p className="text-sm">Su código todavía no aparece en el sistema de ventas:</p>
            <ul className="text-sm">
              {pendientesVentas.map((p) => (
                <li key={`${p.id}-${p.empresa}`}>
                  {p.nombre ?? "Sin nombre"}{" "}
                  <span className="tabular-nums text-muted-foreground">
                    ({p.empresa} {p.codigo})
                  </span>
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
