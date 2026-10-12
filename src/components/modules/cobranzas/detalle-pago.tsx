"use client";

import { useState } from "react";
import Link from "next/link";
import { ExternalLinkIcon, FileTextIcon } from "lucide-react";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { API_URL } from "@/lib/api-client";
import { formatCuenta } from "@/lib/bancos";
import {
  ESTADO_DOCUMENTO_META,
  ESTADO_PAGO_META,
  METODO_PAGO_LABEL,
  TIPO_DOCUMENTO_LABEL,
  type Pago,
} from "@/lib/cobranzas";
import { formatBs, formatDate, formatDateTime, formatNumero, formatTelefono, formatUsd } from "@/lib/constants";

function Dato({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{titulo}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}

/** Número y cliente del pago (encabezado de la tarjeta). Cualquiera de los
 * dos abre el desglose: el pago y SOLO los documentos que abona, no toda la
 * deuda del cliente. */
export function PagoEncabezado({ pago, conCliente }: { pago: Pago; conCliente: boolean }) {
  const [abierto, setAbierto] = useState(false);
  const meta = ESTADO_PAGO_META[pago.estado];
  const nombreCliente = pago.cliente ?? `Cliente ${pago.codigoCliente}`;
  const abonado = Math.round(pago.aplicaciones.reduce((s, a) => s + a.montoUsd, 0) * 100) / 100;
  const aFavor = Math.round((pago.montoUsd - abonado) * 100) / 100;
  const esImagen = pago.comprobanteTipo?.startsWith("image/");
  const urlComprobante = `${API_URL}/cobranzas/pagos/${pago.id}/comprobante`;

  return (
    <>
      <p className="font-semibold">
        <button
          type="button"
          onClick={() => setAbierto(true)}
          className="rounded-sm underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          aria-haspopup="dialog"
        >
          {pago.numero}
        </button>{" "}
        · {METODO_PAGO_LABEL[pago.metodo]} · {formatDate(pago.fechaPago)}
      </p>
      {conCliente && (
        <button
          type="button"
          onClick={() => setAbierto(true)}
          className="rounded-sm text-left text-sm text-primary underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          aria-haspopup="dialog"
        >
          {nombreCliente} · {pago.empresa} {pago.codigoCliente}
        </button>
      )}

      <Dialog open={abierto} onOpenChange={setAbierto}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2">
              Pago {pago.numero}
              <StatusBadge label={meta.label} tone={meta.tone} />
            </DialogTitle>
            <DialogDescription>
              {nombreCliente} · {pago.empresa} {pago.codigoCliente}
            </DialogDescription>
          </DialogHeader>

          <section aria-labelledby={`pago-${pago.id}-datos`} className="space-y-2">
            <h3 id={`pago-${pago.id}-datos`} className="text-sm font-semibold">
              El pago
            </h3>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg bg-muted/50 p-3 text-sm sm:grid-cols-3">
              <Dato titulo="Medio">{METODO_PAGO_LABEL[pago.metodo]}</Dato>
              <Dato titulo="Fecha del pago">{formatDate(pago.fechaPago)}</Dato>
              <Dato titulo="Referencia">{pago.referencia ?? "—"}</Dato>
              {pago.banco && <Dato titulo="Banco">{`${pago.bancoCodigo} ${pago.banco}`}</Dato>}
              {pago.telefono && <Dato titulo="Teléfono">{formatTelefono(pago.telefono)}</Dato>}
              {pago.cuenta && <Dato titulo="Cuenta">{formatCuenta(pago.cuenta)}</Dato>}
              {pago.cedulaRif && <Dato titulo="Cédula o RIF">{pago.cedulaRif}</Dato>}
              {pago.montoBs != null && <Dato titulo="Monto en Bs">{formatBs(pago.montoBs)}</Dato>}
              {pago.tasa != null && <Dato titulo="Tasa BCV">{`${formatNumero(pago.tasa, 4)} Bs/USD`}</Dato>}
              <Dato titulo="Monto en USD">
                <span className="text-base">{formatUsd(pago.montoUsd, 2)}</span>
              </Dato>
            </dl>
            <p className="text-xs text-muted-foreground">
              {pago.reportadoPor
                ? `Reportado por ${pago.reportadoPor} (${pago.reportadoPorEmail}) el ${formatDateTime(pago.reportadoEn)}.`
                : `Registrado por ${pago.registradoPor ?? "cobranzas"} el ${formatDateTime(pago.reportadoEn)}.`}
              {pago.revisadoEn && pago.revisadoPor && ` Revisado por ${pago.revisadoPor} el ${formatDateTime(pago.revisadoEn)}.`}
            </p>
            {pago.nota && <p className="text-sm">Nota: {pago.nota}</p>}
            {pago.estado === "RECHAZADO" && pago.motivoRechazo && (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">Motivo del rechazo: {pago.motivoRechazo}</p>
            )}
          </section>

          <section aria-labelledby={`pago-${pago.id}-docs`} className="space-y-2">
            <h3 id={`pago-${pago.id}-docs`} className="text-sm font-semibold">
              Documentos que abona
            </h3>
            {pago.aplicaciones.length === 0 ? (
              <p className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
                {pago.estado === "REPORTADO" ? "El cliente no indicó documentos" : "Sin documentos indicados"}: el pago se
                aplica a lo que vence primero.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Documento</TableHead>
                    <TableHead className="hidden sm:table-cell">Vence</TableHead>
                    <TableHead className="text-right">Monto</TableHead>
                    <TableHead className="text-right">Este pago</TableHead>
                    <TableHead className="text-right">Saldo hoy</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pago.aplicaciones.map((a) => (
                    <TableRow key={a.documentoId}>
                      <TableCell>
                        <span className="font-medium">
                          {TIPO_DOCUMENTO_LABEL[a.tipoDoc] ?? a.tipoDoc} {a.numero}
                        </span>
                        <span className="block text-xs text-muted-foreground">del {formatDate(a.fecha)}</span>
                      </TableCell>
                      <TableCell className="hidden tabular-nums sm:table-cell">{a.vence ? formatDate(a.vence) : "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatUsd(a.montoDocumentoUsd, 2)}</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">{formatUsd(a.montoUsd, 2)}</TableCell>
                      <TableCell className="text-right">
                        {a.saldoUsd != null && a.estadoDocumento ? (
                          <span className="flex flex-col items-end gap-1">
                            <span className="tabular-nums">{formatUsd(a.saldoUsd, 2)}</span>
                            <StatusBadge {...ESTADO_DOCUMENTO_META[a.estadoDocumento]} />
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">Fuera de la cartera</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell colSpan={3} className="font-medium">
                      Abonado a documentos
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">{formatUsd(abonado, 2)}</TableCell>
                    <TableCell />
                  </TableRow>
                  {aFavor > 0.009 && (
                    <TableRow>
                      <TableCell colSpan={3}>Queda a favor (se aplica a lo que vence primero)</TableCell>
                      <TableCell className="text-right tabular-nums">{formatUsd(aFavor, 2)}</TableCell>
                      <TableCell />
                    </TableRow>
                  )}
                </TableFooter>
              </Table>
            )}
            {pago.estado === "REPORTADO" && pago.aplicaciones.length > 0 && (
              <p className="text-xs text-muted-foreground">
                El saldo de hoy todavía no descuenta este pago: se descuenta al verificarlo.
              </p>
            )}
          </section>

          <section aria-labelledby={`pago-${pago.id}-comp`} className="space-y-2">
            <h3 id={`pago-${pago.id}-comp`} className="text-sm font-semibold">
              Comprobante
            </h3>
            {!pago.tieneComprobante ? (
              <p className="text-sm text-muted-foreground">El cliente no adjuntó comprobante.</p>
            ) : esImagen ? (
              <a href={urlComprobante} target="_blank" rel="noopener noreferrer" className="block">
                {/* eslint-disable-next-line @next/next/no-img-element -- lo sirve la API (enlace firmado), no next/image */}
                <img
                  src={urlComprobante}
                  alt={`Comprobante del pago ${pago.numero}`}
                  className="max-h-80 w-auto rounded-md border border-border object-contain"
                />
              </a>
            ) : (
              <Button variant="outline" size="sm" asChild>
                <a href={urlComprobante} target="_blank" rel="noopener noreferrer">
                  <FileTextIcon aria-hidden />
                  Abrir comprobante (PDF)
                </a>
              </Button>
            )}
          </section>

          <DialogFooter>
            <Button variant="outline" asChild>
              <Link href={`/cobranzas/clientes/${pago.empresa}/${encodeURIComponent(pago.codigoCliente)}`}>
                <ExternalLinkIcon aria-hidden />
                Ver ficha del cliente
              </Link>
            </Button>
            <Button onClick={() => setAbierto(false)}>Cerrar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
