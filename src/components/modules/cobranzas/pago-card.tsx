import Link from "next/link";
import { PaperclipIcon } from "lucide-react";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { RechazarPagoDialog, VerificarPagoDialog } from "@/components/modules/cobranzas/revisar-pago-dialogs";
import { API_URL } from "@/lib/api-client";
import { formatCuenta } from "@/lib/bancos";
import { ESTADO_PAGO_META, METODO_PAGO_LABEL, nombreDocumento, type Pago } from "@/lib/cobranzas";
import { formatBs, formatDate, formatDateTime, formatTelefono, formatUsd } from "@/lib/constants";

/** Un pago tal como lo revisa cobranzas: quién, cuánto, con qué datos
 * bancarios (para buscarlo en el banco) y a qué documentos abona. */
export function PagoCard({ pago, conCliente = true }: { pago: Pago; conCliente?: boolean }) {
  const meta = ESTADO_PAGO_META[pago.estado];
  const datosBanco = [
    pago.banco && `${pago.bancoCodigo} ${pago.banco}`,
    pago.telefono && `Tel. ${formatTelefono(pago.telefono)}`,
    pago.cuenta && `Cta. ${formatCuenta(pago.cuenta)}`,
    pago.cedulaRif && `C.I./RIF ${pago.cedulaRif}`,
    pago.referencia && `Ref. ${pago.referencia}`,
  ].filter(Boolean);

  return (
    <Card>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-semibold">
              {pago.numero} · {METODO_PAGO_LABEL[pago.metodo]} · {formatDate(pago.fechaPago)}
            </p>
            {conCliente && (
              <Link
                href={`/cobranzas/clientes/${pago.empresa}/${encodeURIComponent(pago.codigoCliente)}`}
                className="text-sm text-primary underline-offset-4 hover:underline"
              >
                {pago.cliente ?? `Cliente ${pago.codigoCliente}`} · {pago.empresa} {pago.codigoCliente}
              </Link>
            )}
            <p className="text-xs text-muted-foreground">
              {pago.reportadoPor
                ? `Reportado por ${pago.reportadoPor} (${pago.reportadoPorEmail}) el ${formatDateTime(pago.reportadoEn)}`
                : `Registrado por ${pago.registradoPor ?? "cobranzas"} el ${formatDateTime(pago.reportadoEn)}`}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xl font-bold tabular-nums">{formatUsd(pago.montoUsd, 2)}</p>
            {pago.montoBs != null && (
              <p className="text-xs text-muted-foreground tabular-nums">
                {formatBs(pago.montoBs)}
                {pago.tasa != null && ` · tasa ${pago.tasa.toLocaleString("es-VE", { maximumFractionDigits: 4 })}`}
              </p>
            )}
          </div>
        </div>

        {datosBanco.length > 0 && <p className="text-sm">{datosBanco.join(" · ")}</p>}
        {pago.nota && <p className="text-sm text-muted-foreground">Nota: {pago.nota}</p>}

        <div className="flex flex-wrap items-center gap-2 text-sm">
          <StatusBadge label={meta.label} tone={meta.tone} />
          {pago.revisadoEn && pago.revisadoPor && (
            <span className="text-xs text-muted-foreground">
              por {pago.revisadoPor} el {formatDateTime(pago.revisadoEn)}
            </span>
          )}
          {pago.tieneComprobante ? (
            <a
              href={`${API_URL}/cobranzas/pagos/${pago.id}/comprobante`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
            >
              <PaperclipIcon className="size-3.5" aria-hidden />
              Ver comprobante
            </a>
          ) : (
            pago.estado === "REPORTADO" && <span className="text-xs text-warning">Sin comprobante</span>
          )}
        </div>

        {pago.estado === "RECHAZADO" && pago.motivoRechazo && (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">Motivo: {pago.motivoRechazo}</p>
        )}
        {pago.aplicaciones.length > 0 && (
          <p className="text-sm text-muted-foreground">
            {pago.estado === "REPORTADO" ? "El cliente lo abona a: " : "Abona a: "}
            {pago.aplicaciones.map((a) => `${nombreDocumento(a)} (${formatUsd(a.montoUsd, 2)})`).join(", ")}
          </p>
        )}

        {pago.estado === "REPORTADO" && (
          <div className="flex flex-wrap gap-2 border-t border-border pt-3">
            <VerificarPagoDialog pago={pago} />
            <RechazarPagoDialog pago={pago} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
