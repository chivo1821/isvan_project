import Link from "next/link";
import { notFound } from "next/navigation";
import { BanknoteIcon, CalendarClockIcon, ExternalLinkIcon, HandCoinsIcon, PackageIcon, TruckIcon } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ApiError, apiGet } from "@/lib/api-client";
import {
  ESTADO_DOCUMENTO_META,
  ESTADO_PAGO_META,
  METODO_PAGO_LABEL,
  nombreDocumento,
  type DetalleDocumento,
} from "@/lib/cobranzas";
import {
  ESTADO_DESPACHO_META,
  ESTADO_RUTA_META,
  formatBs,
  formatDate,
  formatDateTime,
  formatNumero,
  formatUsd,
} from "@/lib/constants";
import { getUsuarioActual } from "@/lib/session";

type EstadoDespacho = keyof typeof ESTADO_DESPACHO_META;
type EstadoRuta = keyof typeof ESTADO_RUTA_META;

function Dato({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{titulo}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}

/** Una factura o nota de entrega en detalle, para revisar un cobro: qué
 * productos lleva, cómo se despachó y quién la abonó. */
export default async function DocumentoCobroPage({ params }: PageProps<"/cobranzas/documentos/[id]">) {
  const { id } = await params;
  let doc: DetalleDocumento;
  let usuario;
  try {
    [doc, usuario] = await Promise.all([apiGet<DetalleDocumento>(`/cobranzas/documentos/${encodeURIComponent(id)}`), getUsuarioActual()]);
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 422)) notFound();
    throw err;
  }
  const esAdmin = usuario?.rol === "ADMIN";
  const fichaCliente = `/cobranzas/clientes/${doc.empresa}/${encodeURIComponent(doc.codigoCliente)}`;
  const totalUsd = doc.productos.reduce((s, p) => s + p.montoUsd, 0);
  const totalBs = doc.productos.reduce((s, p) => s + p.montoBs, 0);
  const d = doc.despacho;

  return (
    <div className="space-y-6">
      <PageHeader
        title={nombreDocumento(doc)}
        subtitle={`${doc.cliente} · ${doc.empresa} ${doc.codigoCliente} · del ${formatDate(doc.fecha)}`}
        actions={
          <>
            {doc.estado && <StatusBadge {...ESTADO_DOCUMENTO_META[doc.estado]} />}
            <Button variant="outline" asChild>
              <Link href={fichaCliente}>
                <ExternalLinkIcon aria-hidden />
                Ficha del cliente
              </Link>
            </Button>
          </>
        }
      />

      {!doc.enCartera && (
        <p role="status" className="rounded-lg border border-border bg-muted/50 p-3 text-sm text-muted-foreground">
          {doc.vigente
            ? "Este documento es anterior al inicio de la cartera: se da por saldado y no cuenta para la deuda."
            : "La carga de ventas de este documento se revirtió: ya no cuenta para la deuda."}
        </p>
      )}

      <section aria-label="Montos" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={BanknoteIcon} label="Monto" value={formatUsd(doc.montoUsd, 2)} trend={formatBs(doc.montoBs)} />
        <StatCard icon={HandCoinsIcon} label="Abonado" value={doc.abonadoUsd != null ? formatUsd(doc.abonadoUsd, 2) : "—"} tone="success" />
        <StatCard
          icon={BanknoteIcon}
          label="Saldo"
          value={doc.saldoUsd != null ? formatUsd(doc.saldoUsd, 2) : "—"}
          tone={doc.estado === "VENCIDO" ? "destructive" : "warning"}
        />
        <StatCard
          icon={CalendarClockIcon}
          label="Vence"
          value={doc.vence ? formatDate(doc.vence) : "—"}
          trend={doc.diasAtraso > 0 ? `${doc.diasAtraso} días de atraso` : undefined}
          tone={doc.diasAtraso > 0 ? "destructive" : "info"}
        />
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PackageIcon className="size-4 text-muted-foreground" aria-hidden />
            Productos
          </CardTitle>
          <CardDescription>
            Las líneas del documento según el extracto de ventas. Ruta comercial del cliente: {doc.rutaComercial ?? "—"}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {doc.productos.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No hay líneas de venta para este documento (no viene del extracto o su carga se revirtió).
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Producto</TableHead>
                  <TableHead className="hidden text-right md:table-cell">Cajas</TableHead>
                  <TableHead className="text-right">Unidades</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Precio unit.</TableHead>
                  <TableHead className="text-right">Total USD</TableHead>
                  <TableHead className="hidden text-right lg:table-cell">Total Bs</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {doc.productos.map((p, i) => (
                  <TableRow key={`${p.codigo}-${i}`}>
                    <TableCell>
                      <span className="font-medium">{p.producto}</span>
                      <span className="block text-xs text-muted-foreground">
                        {p.codigo}
                        {p.grupo && ` · ${p.grupo}`}
                      </span>
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums md:table-cell">{formatNumero(p.cajas, 2)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumero(p.unidades)}</TableCell>
                    <TableCell className="hidden text-right tabular-nums sm:table-cell">
                      {p.precioUnitarioUsd != null ? formatUsd(p.precioUnitarioUsd, 2) : "—"}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{formatUsd(p.montoUsd, 2)}</TableCell>
                    <TableCell className="hidden text-right tabular-nums lg:table-cell">{formatBs(p.montoBs)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell className="font-semibold">Total del documento</TableCell>
                  <TableCell className="hidden md:table-cell" />
                  <TableCell className="text-right tabular-nums">{formatNumero(doc.productos.reduce((s, p) => s + p.unidades, 0))}</TableCell>
                  <TableCell className="hidden sm:table-cell" />
                  <TableCell className="text-right font-semibold tabular-nums">{formatUsd(totalUsd, 2)}</TableCell>
                  <TableCell className="hidden text-right font-semibold tabular-nums lg:table-cell">{formatBs(totalBs)}</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TruckIcon className="size-4 text-muted-foreground" aria-hidden />
            Despacho y ruta
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!d ? (
            <p className="text-sm text-muted-foreground">Este documento no tiene un despacho registrado en el sistema.</p>
          ) : (
            <>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg bg-muted/50 p-3 text-sm sm:grid-cols-4">
                <Dato titulo="Despacho">
                  {esAdmin ? (
                    <Link href={`/despachos/${d.id}`} className="text-primary underline-offset-4 hover:underline">
                      {d.numero}
                    </Link>
                  ) : (
                    d.numero
                  )}
                </Dato>
                <Dato titulo="Estado">
                  {d.estado in ESTADO_DESPACHO_META ? <StatusBadge {...ESTADO_DESPACHO_META[d.estado as EstadoDespacho]} /> : d.estado}
                </Dato>
                <Dato titulo="Ruta de entrega">
                  {d.ruta ?? "Sin ruta todavía"}
                  {d.estadoRuta && d.estadoRuta in ESTADO_RUTA_META && (
                    <span className="ml-1.5 text-xs text-muted-foreground">({ESTADO_RUTA_META[d.estadoRuta as EstadoRuta].label})</span>
                  )}
                </Dato>
                <Dato titulo="Vehículo y chofer">{d.placa ? `${d.placa}${d.conductor ? ` · ${d.conductor}` : ""}` : "—"}</Dato>
                <Dato titulo="Salida programada">{d.salidaProgramada ? formatDateTime(d.salidaProgramada) : "—"}</Dato>
                <Dato titulo="Llegada al cliente">{d.llegadaEn ? formatDateTime(d.llegadaEn) : "—"}</Dato>
                <Dato titulo="Entregado">{d.entregadoEn ? formatDateTime(d.entregadoEn) : "—"}</Dato>
                <Dato titulo="Creado">{formatDateTime(d.fechaCreacion)}</Dato>
              </dl>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Despachado</TableHead>
                    <TableHead className="text-right">Pedido</TableHead>
                    <TableHead className="text-right">Despachado</TableHead>
                    <TableHead className="hidden text-right sm:table-cell">Peso</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {d.items.map((it, i) => (
                    <TableRow key={`${it.descripcion}-${i}`}>
                      <TableCell>{it.descripcion}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatNumero(it.cantidadSolicitada)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatNumero(it.cantidad)}
                        {it.cantidad !== it.cantidadSolicitada && <span className="block text-xs text-warning">ajustado</span>}
                      </TableCell>
                      <TableCell className="hidden text-right tabular-nums sm:table-cell">
                        {formatNumero(it.cantidad * it.pesoUnitarioKg, 1)} kg
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HandCoinsIcon className="size-4 text-muted-foreground" aria-hidden />
            Abonos
          </CardTitle>
          <CardDescription>Pagos aplicados a este documento. Las devoluciones se descuentan aparte, a lo que vence primero.</CardDescription>
        </CardHeader>
        <CardContent>
          {doc.abonos.length === 0 ? (
            <p className="text-sm text-muted-foreground">Ningún pago se aplicó directamente a este documento.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pago</TableHead>
                  <TableHead>Fecha</TableHead>
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
                        {METODO_PAGO_LABEL[a.metodo]}
                        {a.automatica && " · reparto automático"}
                      </span>
                    </TableCell>
                    <TableCell className="tabular-nums">{formatDate(a.fechaPago)}</TableCell>
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
  );
}
