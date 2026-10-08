import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { DesvincularButton, SuspenderButton, VincularDialog } from "@/components/modules/cobranzas/cuenta-portal-acciones";
import { apiGet } from "@/lib/api-client";
import { ESTADO_CUENTA_META, type CuentaPortalAdmin } from "@/lib/cobranzas";
import { formatDateTime, formatTelefono } from "@/lib/constants";
import { cn } from "@/lib/utils";

const ESTADOS = [
  { valor: "POR_VALIDAR", label: "Por validar" },
  { valor: "ACTIVA", label: "Activas" },
  { valor: "SUSPENDIDA", label: "Suspendidas" },
  { valor: "PENDIENTE_CORREO", label: "Sin confirmar correo" },
  { valor: "TODAS", label: "Todas" },
] as const;

export default async function CuentasPortalPage({ searchParams }: PageProps<"/cobranzas/cuentas">) {
  const params = await searchParams;
  const estado = ESTADOS.find((e) => e.valor === params.estado)?.valor ?? "POR_VALIDAR";
  const cuentas = await apiGet<CuentaPortalAdmin[]>(`/cobranzas/cuentas?estado=${estado}`);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Cuentas del portal"
        subtitle="Los clientes se registran solos en /portal. Si su correo coincide con el de la maestra de clientes, la cuenta se vincula sola; si no, la validas aquí."
        helpText="Antes de vincular, confirma que el RIF y el nombre corresponden al cliente: la cuenta verá su deuda y podrá reportar pagos a su nombre."
      />
      <nav aria-label="Estado de las cuentas" className="flex flex-wrap gap-2">
        {ESTADOS.map((e) => (
          <Link
            key={e.valor}
            href={`/cobranzas/cuentas?estado=${e.valor}`}
            aria-current={estado === e.valor ? "page" : undefined}
            className={cn(
              "inline-flex min-h-9 items-center rounded-full border px-3 text-sm transition-colors",
              estado === e.valor ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:bg-muted"
            )}
          >
            {e.label}
          </Link>
        ))}
      </nav>

      {cuentas.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">No hay cuentas en esta lista.</CardContent>
        </Card>
      ) : (
        <ul className="space-y-3">
          {cuentas.map((c) => (
            <li key={c.id}>
              <Card>
                <CardContent className="space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold">{c.nombre}</p>
                      <p className="text-sm text-muted-foreground">
                        {c.email} · RIF {c.rif}
                        {c.telefono && ` · ${formatTelefono(c.telefono)}`}
                      </p>
                      <p className="text-xs text-muted-foreground">Registrada el {formatDateTime(c.createdAt)}</p>
                    </div>
                    <StatusBadge {...ESTADO_CUENTA_META[c.estado]} />
                  </div>
                  {c.codigoDeclarado && (
                    <p className="rounded-md bg-muted/60 px-3 py-2 text-sm">
                      Dice ser el cliente <strong>{c.empresaDeclarada ?? "(empresa sin indicar)"} {c.codigoDeclarado}</strong>
                      {c.nombreDeclarado ? ` — en el sistema: ${c.nombreDeclarado}` : " — ese código no aparece en el sistema"}
                    </p>
                  )}
                  {c.clientes.length > 0 && (
                    <ul className="space-y-1 text-sm">
                      {c.clientes.map((v) => (
                        <li key={`${v.empresa}:${v.codigoCliente}`} className="flex items-center gap-2">
                          <Link
                            href={`/cobranzas/clientes/${v.empresa}/${encodeURIComponent(v.codigoCliente)}`}
                            className="text-primary underline-offset-4 hover:underline"
                          >
                            {v.nombre ?? `Cliente ${v.codigoCliente}`} ({v.empresa} {v.codigoCliente})
                          </Link>
                          <span className="text-xs text-muted-foreground">{v.origen === "AUTO_CORREO" ? "por correo" : "por cobranzas"}</span>
                          <DesvincularButton cuentaId={c.id} empresa={v.empresa} codigoCliente={v.codigoCliente} nombre={v.nombre ?? v.codigoCliente} />
                        </li>
                      ))}
                    </ul>
                  )}
                  {c.estado !== "PENDIENTE_CORREO" && (
                    <div className="flex flex-wrap gap-2 border-t border-border pt-3">
                      {c.estado !== "SUSPENDIDA" && <VincularDialog cuenta={c} />}
                      <SuspenderButton cuenta={c} />
                    </div>
                  )}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
