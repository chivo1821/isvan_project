import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon, PlusIcon } from "lucide-react";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ProductosDocumento } from "@/components/modules/cobranzas/productos-documento";
import { ApiError, apiGet } from "@/lib/api-client";
import {
  ESTADO_DOCUMENTO_META,
  ESTADO_PAGO_META,
  METODO_PAGO_LABEL,
  nombreDocumento,
  type DetalleDocumentoPortal,
} from "@/lib/cobranzas";
import { type Tone, formatBs, formatDate, formatDateTime, formatUsd } from "@/lib/constants";
import { getCuentaActiva } from "@/lib/portal";
import { cn } from "@/lib/utils";

/** Cómo va la entrega, en palabras del cliente (sin estados internos). */
function entregaParaCliente(entrega: DetalleDocumentoPortal["entrega"]): { label: string; tone: Tone; detalle: string } {
  if (!entrega) return { label: "Sin despacho registrado", tone: "neutral", detalle: "Este documento no tiene un despacho en el sistema." };
  if (entrega.estado === "ENTREGADO")
    return {
      label: "Entregado",
      tone: "success",
      detalle: entrega.entregadoEn ? `Se entregó el ${formatDateTime(entrega.entregadoEn)}.` : "Ya se entregó.",
    };
  if (entrega.estado === "EN_TRANSITO") return { label: "En camino", tone: "info", detalle: "El pedido ya salió del almacén." };
  if (entrega.estado === "RECHAZADO" || entrega.estado === "CANCELADO")
    return { label: "No despachado", tone: "neutral", detalle: "Este pedido no se despachó. Si tienes dudas, comunícate con nosotros." };
  return { label: "En preparación", tone: "warning", detalle: "Estamos preparando tu pedido." };
}

function Cifra({ titulo, valor, detalle, tono }: { titulo: string; valor: string; detalle?: string; tono?: "destructive" }) {
  return (
    <Card>
      <CardContent className="space-y-1">
        <p className="text-sm text-muted-foreground">{titulo}</p>
        <p className={cn("text-2xl font-bold tabular-nums", tono === "destructive" && "text-destructive")}>{valor}</p>
        {detalle && <p className="text-xs text-muted-foreground">{detalle}</p>}
      </CardContent>
    </Card>
  );
}

export default async function PortalDocumentoPage({ params }: PageProps<"/portal/documentos/[id]">) {
  const cuenta = await getCuentaActiva();
  if (!cuenta) return null;
  const { id } = await params;
  let doc: DetalleDocumentoPortal;
  try {
    doc = await apiGet<DetalleDocumentoPortal>(`/portal/documentos/${encodeURIComponent(id)}`);
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 422)) notFound();
    throw err;
  }
  const entrega = entregaParaCliente(doc.entrega);
  const varios = cuenta.clientes.length > 1;

  return (
    <>
      <Link href="/portal/documentos" className="inline-flex items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:underline print:hidden">
        <ArrowLeftIcon className="size-4" aria-hidden />
        Volver a documentos
      </Link>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold">
            {nombreDocumento(doc)}
            {doc.estado && <StatusBadge {...ESTADO_DOCUMENTO_META[doc.estado]} />}
          </h1>
          <p className="text-sm text-muted-foreground">
            Del {formatDate(doc.fecha)}
            {varios && ` · ${doc.cliente} (${doc.empresa})`}
          </p>
        </div>
        {doc.saldoUsd != null && doc.saldoUsd > 0 && (
          <Button asChild className="print:hidden">
            <Link href="/portal/pagos/nuevo">
              <PlusIcon aria-hidden />
              Reportar un pago
            </Link>
          </Button>
        )}
      </div>

      <section aria-label="Montos" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Cifra titulo="Monto" valor={formatUsd(doc.montoUsd, 2)} detalle={formatBs(doc.montoBs)} />
        <Cifra titulo="Abonado" valor={doc.abonadoUsd != null ? formatUsd(doc.abonadoUsd, 2) : "—"} />
        <Cifra
          titulo="Saldo"
          valor={doc.saldoUsd != null ? formatUsd(doc.saldoUsd, 2) : "—"}
          tono={doc.estado === "VENCIDO" ? "destructive" : undefined}
        />
        <Cifra
          titulo="Vence"
          valor={doc.vence ? formatDate(doc.vence) : "—"}
          detalle={doc.diasAtraso > 0 ? `${doc.diasAtraso} días de atraso` : undefined}
          tono={doc.diasAtraso > 0 ? "destructive" : undefined}
        />
      </section>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Productos</h2>
          </CardTitle>
          <CardDescription>Lo que incluye este documento y cuánto suma cada producto.</CardDescription>
        </CardHeader>
        <CardContent>
          <ProductosDocumento productos={doc.productos} />
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Entrega</h2>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <StatusBadge label={entrega.label} tone={entrega.tone} />
            <p className="text-muted-foreground">{entrega.detalle}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Abonos</h2>
            </CardTitle>
            <CardDescription>Tus pagos aplicados a este documento.</CardDescription>
          </CardHeader>
          <CardContent>
            {doc.abonos.length === 0 ? (
              <p className="text-sm text-muted-foreground">Todavía no hay pagos aplicados a este documento.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Pago</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead className="text-right">Abono</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {doc.abonos.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell>
                        <span className="font-medium">{a.numero}</span>
                        <span className="block text-xs text-muted-foreground">
                          {METODO_PAGO_LABEL[a.metodo]} · {formatDate(a.fechaPago)}
                          {a.automatica && " · aplicado a lo que vencía primero"}
                        </span>
                      </TableCell>
                      <TableCell>
                        <StatusBadge {...ESTADO_PAGO_META[a.estado]} />
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">{formatUsd(a.montoUsd, 2)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
