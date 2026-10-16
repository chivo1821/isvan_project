import { AlertTriangleIcon, MapPinIcon, StoreIcon } from "lucide-react";
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

/** Arriba del formulario del censo: lo que le falta al vendedor en sus
 * rutas (según la maestra) y sus censos con algo pendiente. */
export function PendientesDelVendedor({ datos }: { datos: PendientesVendedor }) {
  const { porCensar, pendientesVentas, revisar } = datos;
  if (!datos.rutas.length || (!datos.conMaestra.length && !pendientesVentas.length && !revisar.length)) return null;

  return (
    <div className="space-y-3">
      {porCensar.length > 0 ? (
        <Alert>
          <MapPinIcon />
          <AlertTitle>
            Tienes {formatNumero(porCensar.length)} cliente{porCensar.length === 1 ? "" : "s"} por censar en tus rutas
          </AlertTitle>
          <AlertDescription>
            <div className="w-full space-y-1">
              {porRuta(porCensar).map(([ruta, clientes]) => (
                <details key={ruta} className="group rounded-md border border-border px-3 py-2">
                  <summary className="cursor-pointer text-sm font-medium text-foreground">
                    {ruta}: {formatNumero(clientes.length)}
                  </summary>
                  <ul className="mt-2 divide-y text-sm">
                    {clientes.map((c) => (
                      <li key={`${c.empresa}-${c.codigo}`} className="py-1.5">
                        <span className="font-medium text-foreground">{c.razonSocial}</span>{" "}
                        <span className="tabular-nums text-muted-foreground">({c.codigo})</span>
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
            <AlertTitle>Ya censaste a todos los clientes de tus rutas</AlertTitle>
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
