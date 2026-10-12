import Link from "next/link";
import { AlertTriangleIcon, CheckCircle2Icon, ClockIcon, DownloadIcon, PlusIcon, WalletIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DocumentosTabla } from "@/components/modules/portal/documentos-tabla";
import { API_URL, apiGet } from "@/lib/api-client";
import type { Documento, ResumenCliente } from "@/lib/cobranzas";
import { formatDate, formatUsd } from "@/lib/constants";
import { getCuentaActiva } from "@/lib/portal";
import { cn } from "@/lib/utils";

type Resumen = {
  clientes: ResumenCliente[];
  saldoUsd: number;
  vencidoUsd: number;
  pagosEnRevision: number;
  pagosEnRevisionUsd: number;
  diasTolerancia: number;
  bloqueoActivo: boolean;
};

function Cifra({ titulo, valor, detalle, tono }: { titulo: string; valor: string; detalle?: string; tono?: "destructive" | "warning" }) {
  return (
    <Card>
      <CardContent className="space-y-1">
        <p className="text-sm text-muted-foreground">{titulo}</p>
        <p
          className={cn(
            "text-2xl font-bold tabular-nums",
            tono === "destructive" && "text-destructive",
            tono === "warning" && "text-warning"
          )}
        >
          {valor}
        </p>
        {detalle && <p className="text-xs text-muted-foreground">{detalle}</p>}
      </CardContent>
    </Card>
  );
}

export default async function PortalResumenPage() {
  const cuenta = await getCuentaActiva();
  if (!cuenta) return null;
  const [resumen, pendientes] = await Promise.all([
    apiGet<Resumen>("/portal/resumen"),
    apiGet<Documento[]>("/portal/documentos?estado=pendientes"),
  ]);
  const nombres = new Map(cuenta.clientes.map((c) => [`${c.empresa}:${c.codigoCliente}`, c.nombre]));
  const varios = cuenta.clientes.length > 1;

  return (
    <>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Hola, {cuenta.nombre}</h1>
          <p className="text-sm text-muted-foreground">Montos en dólares (USD). Los pagos en bolívares se convierten con la última tasa BCV publicada.</p>
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          <Button variant="outline" asChild>
            <a href={`${API_URL}/portal/estado-cuenta.xlsx`}>
              <DownloadIcon aria-hidden />
              Estado de cuenta
            </a>
          </Button>
          <Button asChild>
            <Link href="/portal/pagos/nuevo">
              <PlusIcon aria-hidden />
              Reportar un pago
            </Link>
          </Button>
        </div>
      </div>

      {/* Estado de cada cliente: lo primero que quiere saber quien entra. */}
      <section aria-label="Estado para despacho" className="space-y-2">
        {resumen.clientes.map((c) => (
          <div
            key={`${c.empresa}:${c.codigoCliente}`}
            className={cn(
              "flex items-start gap-3 rounded-lg border p-4",
              c.bloqueado ? "border-destructive/40 bg-destructive/5" : "border-success/40 bg-success/5"
            )}
          >
            {c.bloqueado ? (
              <AlertTriangleIcon className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden />
            ) : (
              <CheckCircle2Icon className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
            )}
            <div className="min-w-0 text-sm">
              <p className="font-semibold">
                {c.bloqueado ? "Con deuda vencida" : "Disponible para despacho"}
                {varios && <span className="font-normal text-muted-foreground"> · {c.nombre} ({c.empresa})</span>}
              </p>
              <p className="text-muted-foreground">
                {c.bloqueado
                  ? `Tienes ${c.documentosVencidos} documento(s) vencido(s) por ${formatUsd(c.vencidoUsd, 2)}. Para recibir nuevos despachos, ponte al día o comunícate con cobranzas.`
                  : c.proximoVencimiento
                    ? `Tu próximo vencimiento es el ${formatDate(c.proximoVencimiento)}.`
                    : "No tienes documentos pendientes."}
              </p>
            </div>
          </div>
        ))}
      </section>

      <section aria-label="Totales" className="grid gap-3 sm:grid-cols-3">
        <Cifra titulo="Saldo pendiente" valor={formatUsd(resumen.saldoUsd, 2)} detalle={`${pendientes.length} documento(s) por pagar`} />
        <Cifra
          titulo="Vencido"
          valor={formatUsd(resumen.vencidoUsd, 2)}
          detalle={`Vencen a los ${resumen.diasTolerancia} días de su fecha`}
          tono={resumen.vencidoUsd > 0 ? "destructive" : undefined}
        />
        <Cifra
          titulo="Pagos en revisión"
          valor={formatUsd(resumen.pagosEnRevisionUsd, 2)}
          detalle={
            resumen.pagosEnRevision > 0
              ? `${resumen.pagosEnRevision} pago(s): se descuentan al verificarse`
              : "No tienes pagos esperando verificación"
          }
          tono={resumen.pagosEnRevision > 0 ? "warning" : undefined}
        />
      </section>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div>
            <CardTitle>
              <h2>Por pagar</h2>
            </CardTitle>
            <CardDescription>Los que vencen primero arriba.</CardDescription>
          </div>
          <Button variant="link" asChild className="h-auto p-0">
            <Link href="/portal/documentos">Ver todos</Link>
          </Button>
        </CardHeader>
        <CardContent>
          <DocumentosTabla
            documentos={pendientes.slice(0, 8).map((d) => ({ ...d, nombreCliente: nombres.get(`${d.empresa}:${d.codigoCliente}`) }))}
            mostrarCliente={varios}
            vacio="No tienes documentos pendientes. ¡Estás al día!"
          />
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 print:hidden">
        <Link href="/portal/pagos" className="flex items-center gap-3 rounded-lg border border-border bg-card p-4 transition-colors hover:bg-muted">
          <WalletIcon className="size-5 text-primary" aria-hidden />
          <span className="text-sm">
            <span className="block font-medium">Mis pagos</span>
            <span className="text-muted-foreground">Lo que reportaste y su estado</span>
          </span>
        </Link>
        <Link href="/portal/estado-de-cuenta" className="flex items-center gap-3 rounded-lg border border-border bg-card p-4 transition-colors hover:bg-muted">
          <ClockIcon className="size-5 text-primary" aria-hidden />
          <span className="text-sm">
            <span className="block font-medium">Estado de cuenta</span>
            <span className="text-muted-foreground">Todos tus movimientos por período</span>
          </span>
        </Link>
      </div>
    </>
  );
}
