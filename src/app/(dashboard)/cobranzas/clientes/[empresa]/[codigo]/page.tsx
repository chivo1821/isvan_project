import { notFound } from "next/navigation";
import { AlertTriangleIcon, BanknoteIcon, CalendarClockIcon, CheckCircle2Icon, DownloadIcon, WalletIcon } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PagoCard } from "@/components/modules/cobranzas/pago-card";
import { RegistrarPagoDialog } from "@/components/modules/cobranzas/registrar-pago-dialog";
import { DocumentosTabla } from "@/components/modules/portal/documentos-tabla";
import { MovimientosTabla } from "@/components/modules/portal/movimientos-tabla";
import { ApiError, API_URL, apiGet } from "@/lib/api-client";
import { ESTADO_CUENTA_META, type DetalleClienteCartera, type EstadoDeCuenta } from "@/lib/cobranzas";
import { formatDate, formatTelefono, formatUsd } from "@/lib/constants";

export default async function CobranzasClientePage({ params }: PageProps<"/cobranzas/clientes/[empresa]/[codigo]">) {
  const { empresa, codigo } = await params;
  if (empresa !== "ISVAN" && empresa !== "TRALOG") notFound();
  const base = `/cobranzas/clientes/${empresa}/${encodeURIComponent(codigo)}`;
  let cliente: DetalleClienteCartera;
  let estadoCuenta: EstadoDeCuenta;
  try {
    [cliente, estadoCuenta] = await Promise.all([apiGet<DetalleClienteCartera>(base), apiGet<EstadoDeCuenta>(`${base}/estado-cuenta`)]);
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 422)) notFound();
    throw err;
  }
  const pendientes = cliente.documentos.filter((d) => d.saldoUsd > 0);
  const datos = [
    `${empresa} ${codigo}`,
    cliente.datos?.ruta && `ruta ${cliente.datos.ruta}`,
    cliente.datos?.ciudad,
    cliente.datos?.telefono && formatTelefono(cliente.datos.telefono),
    cliente.datos?.email,
  ].filter(Boolean);

  return (
    <div className="space-y-6">
      <PageHeader
        title={cliente.nombre}
        subtitle={datos.join(" · ")}
        actions={
          <>
            <Button variant="outline" asChild>
              <a href={`${API_URL}${base}/estado-cuenta.xlsx`}>
                <DownloadIcon aria-hidden />
                Estado de cuenta
              </a>
            </Button>
            <RegistrarPagoDialog empresa={empresa} codigoCliente={codigo} nombre={cliente.nombre} />
          </>
        }
      />

      <div
        role="status"
        className={
          cliente.bloqueado
            ? "flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm"
            : "flex items-start gap-3 rounded-lg border border-success/40 bg-success/5 p-4 text-sm"
        }
      >
        {cliente.bloqueado ? (
          <AlertTriangleIcon className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden />
        ) : (
          <CheckCircle2Icon className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
        )}
        <p>
          <strong>{cliente.bloqueado ? "Bloqueado para despacho." : "Disponible para despacho."}</strong>{" "}
          {cliente.bloqueado
            ? `${cliente.documentosVencidos} documento(s) vencido(s), el más atrasado por ${cliente.diasAtraso} días. Un despacho suyo solo se aprueba como excepción.`
            : cliente.proximoVencimiento
              ? `Próximo vencimiento: ${formatDate(cliente.proximoVencimiento)}.`
              : "Sin documentos pendientes."}
        </p>
      </div>

      <section aria-label="Saldos" className="grid gap-4 sm:grid-cols-3">
        <StatCard icon={BanknoteIcon} label="Saldo" value={formatUsd(cliente.saldoUsd, 2)} trend={`${cliente.documentosPendientes} documento(s) pendiente(s)`} />
        <StatCard icon={CalendarClockIcon} label="Vencido" value={formatUsd(cliente.vencidoUsd, 2)} tone="destructive" />
        <StatCard icon={WalletIcon} label="A favor" value={formatUsd(cliente.aFavorUsd, 2)} trend="Pagos o devoluciones sin documento que cubrir" tone="success" />
      </section>

      <Tabs defaultValue="pendientes">
        <TabsList>
          <TabsTrigger value="pendientes">Pendientes ({pendientes.length})</TabsTrigger>
          <TabsTrigger value="pagos">Pagos ({cliente.pagos.length})</TabsTrigger>
          <TabsTrigger value="movimientos">Estado de cuenta</TabsTrigger>
          <TabsTrigger value="portal">Portal ({cliente.cuentasPortal.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="pendientes">
          <Card>
            <CardContent>
              <DocumentosTabla
                documentos={pendientes}
                vacio="Sin documentos pendientes."
                enlaceDocumento={(d) => `/cobranzas/documentos/${d.id}`}
              />
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="pagos" className="space-y-3">
          {cliente.pagos.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-sm text-muted-foreground">Sin pagos registrados.</CardContent>
            </Card>
          ) : (
            cliente.pagos.map((p) => <PagoCard key={p.id} pago={p} conCliente={false} />)
          )}
        </TabsContent>
        <TabsContent value="movimientos">
          <Card>
            <CardContent>
              <MovimientosTabla estado={estadoCuenta} conSaldoInicial={false} />
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="portal">
          <Card>
            <CardContent>
              {cliente.cuentasPortal.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  Ninguna cuenta del portal está vinculada a este cliente.
                  {!cliente.datos?.email && " Si cargas su correo en la maestra de clientes, al registrarse se vincula solo."}
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {cliente.cuentasPortal.map((c) => (
                    <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                      <span>
                        <span className="font-medium">{c.nombre}</span> · {c.email}
                        <span className="block text-xs text-muted-foreground">
                          Vinculada {c.origen === "AUTO_CORREO" ? "sola por su correo" : "por cobranzas"} el {formatDate(c.vinculadoEn)}
                        </span>
                      </span>
                      <StatusBadge {...ESTADO_CUENTA_META[c.estado]} />
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
