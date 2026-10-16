import Link from "next/link";
import { PaperclipIcon, PlusIcon } from "lucide-react";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { API_URL, apiGet } from "@/lib/api-client";
import { formatCuenta } from "@/lib/bancos";
import { ESTADO_PAGO_META, METODO_PAGO_LABEL, nombreDocumento, type Pago } from "@/lib/cobranzas";
import { formatBs, formatDate, formatTelefono, formatUsd } from "@/lib/constants";
import { getCuentaActiva } from "@/lib/portal";

export default async function PortalPagosPage() {
  const cuenta = await getCuentaActiva();
  if (!cuenta) return null;
  const pagos = await apiGet<Pago[]>("/portal/pagos");
  const varios = cuenta.clientes.length > 1;
  const nombres = new Map(cuenta.clientes.map((c) => [`${c.empresa}:${c.codigoCliente}`, c.nombre]));

  return (
    <>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Mis pagos</h1>
          <p className="text-sm text-muted-foreground">
            Un pago reportado queda en revisión hasta que cobranzas confirma que llegó; ahí se descuenta de tu saldo.
          </p>
        </div>
        <Button asChild>
          <Link href="/portal/pagos/nuevo">
            <PlusIcon aria-hidden />
            Reportar un pago
          </Link>
        </Button>
      </div>

      {pagos.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">Todavía no hay pagos en tu cuenta.</CardContent>
        </Card>
      ) : (
        <ul className="space-y-3">
          {pagos.map((p) => {
            const meta = ESTADO_PAGO_META[p.estado];
            return (
              <li key={p.id}>
                <Card>
                  <CardContent className="space-y-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold">
                          {p.numero} · {METODO_PAGO_LABEL[p.metodo]}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {formatDate(p.fechaPago)}
                          {p.banco && ` · ${p.banco}`}
                          {p.referencia && ` · ref. ${p.referencia}`}
                          {varios && ` · ${nombres.get(`${p.empresa}:${p.codigoCliente}`) ?? p.codigoCliente}`}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-bold tabular-nums">{formatUsd(p.montoUsd, 2)}</p>
                        {p.montoBs != null && (
                          <p className="text-xs text-muted-foreground tabular-nums">
                            {formatBs(p.montoBs)}
                            {p.tasa != null && ` a ${p.tasa.toLocaleString("es-VE", { maximumFractionDigits: 4 })} Bs/USD`}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <StatusBadge label={meta.label} tone={meta.tone} />
                      {p.telefono && <span className="text-muted-foreground">Desde {formatTelefono(p.telefono)}</span>}
                      {p.cuenta && <span className="text-muted-foreground">Desde {formatCuenta(p.cuenta)}</span>}
                      {p.tieneComprobante && (
                        <a
                          href={`${API_URL}/portal/pagos/${p.id}/comprobante`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
                        >
                          <PaperclipIcon className="size-3.5" aria-hidden />
                          Ver comprobante
                        </a>
                      )}
                    </div>
                    {p.estado === "RECHAZADO" && p.motivoRechazo && (
                      <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                        No se pudo verificar: {p.motivoRechazo}
                      </p>
                    )}
                    {p.aplicaciones.length > 0 && (
                      <p className="text-sm text-muted-foreground">
                        {p.aplicaciones.every((a) => a.automatica) ? "Se abonó a lo que vencía primero:" : "Abona a:"}{" "}
                        {p.aplicaciones.map((a) => `${nombreDocumento(a)} (${formatUsd(a.montoUsd, 2)})`).join(", ")}
                      </p>
                    )}
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
