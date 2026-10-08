"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeftIcon, ArrowRightIcon, CheckCircle2Icon, FileUpIcon, LandmarkIcon, SendIcon, SmartphoneIcon, Wand2Icon, XIcon } from "lucide-react";
import { apiGet, apiPost, mensajeDeError } from "@/lib/api-client";
import { BANCOS, bancoDeCuenta, formatCuenta } from "@/lib/bancos";
import { claveCliente, hoyCaracas, nombreDocumento, type CuentaEmpresa, type Documento, type Empresa, type Pago } from "@/lib/cobranzas";
import { formatBs, formatDate, formatTelefono, formatUsd } from "@/lib/constants";
import { ErrorFoto, FOTO_MAXIMA_BYTES, comprimirFoto } from "@/lib/formulario/comprimir";
import { StepWizard } from "@/components/shared/step-wizard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Campo, ariaCampo } from "@/components/modules/portal/campo";
import { cn } from "@/lib/utils";

type Metodo = "PAGO_MOVIL" | "TRANSFERENCIA";
type ClientePortal = { empresa: Empresa; codigoCliente: string; nombre: string };
type EnlaceSubida = { clave: string; url: string; metodo: string; cabeceras: Record<string, string>; conSesion: boolean };

const PASOS = [
  { id: "metodo", label: "Cómo pagaste" },
  { id: "datos", label: "Datos del pago" },
  { id: "documentos", label: "Qué pagas" },
  { id: "enviar", label: "Comprobante" },
];
const TIPOS_COMPROBANTE = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

/** "1.234,56" o "1234.56" -> 1234.56 (null si no es un monto). */
function leerMonto(texto: string): number | null {
  const limpio = texto.trim().replace(/\s/g, "");
  if (!limpio) return null;
  // Con coma decimal (formato venezolano) los puntos son de miles.
  const normal = limpio.includes(",") ? limpio.replace(/\./g, "").replace(",", ".") : limpio;
  const valor = Number(normal);
  return Number.isFinite(valor) && valor > 0 ? Math.round(valor * 100) / 100 : null;
}

const redondear = (v: number) => Math.round(v * 100) / 100;

async function subirComprobante(archivo: File): Promise<string> {
  const enlace = await apiPost<EnlaceSubida>("/portal/pagos/comprobante/subida", { tipo: archivo.type, bytes: archivo.size });
  const respuesta = await fetch(enlace.url, {
    method: enlace.metodo,
    headers: enlace.cabeceras,
    body: archivo,
    credentials: enlace.conSesion ? "include" : "omit",
  });
  if (!respuesta.ok) throw new Error(`No se pudo subir el comprobante (error ${respuesta.status}). Vuelve a intentar.`);
  return enlace.clave;
}

function OpcionMetodo({
  valor,
  actual,
  onElegir,
  icono: Icono,
  titulo,
  detalle,
}: {
  valor: Metodo;
  actual: Metodo | null;
  onElegir: (m: Metodo) => void;
  icono: typeof SmartphoneIcon;
  titulo: string;
  detalle: string;
}) {
  const elegido = actual === valor;
  return (
    <label
      className={cn(
        "flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
        elegido ? "border-primary bg-primary/5" : "border-border hover:bg-muted"
      )}
    >
      <input type="radio" name="metodo" value={valor} checked={elegido} onChange={() => onElegir(valor)} className="sr-only" />
      <Icono className={cn("mt-0.5 size-5 shrink-0", elegido ? "text-primary" : "text-muted-foreground")} aria-hidden />
      <span>
        <span className="block font-medium">{titulo}</span>
        <span className="block text-sm text-muted-foreground">{detalle}</span>
      </span>
    </label>
  );
}

export function ReportarPagoWizard({
  clientes,
  pendientes,
  cuentasEmpresa,
}: {
  clientes: ClientePortal[];
  pendientes: Documento[];
  cuentasEmpresa: CuentaEmpresa[];
}) {
  const [paso, setPaso] = useState(1);
  const [cliente, setCliente] = useState(claveCliente(clientes[0]));
  const [metodo, setMetodo] = useState<Metodo | null>(null);
  const [fecha, setFecha] = useState(hoyCaracas());
  const [montoBsTexto, setMontoBsTexto] = useState("");
  const [banco, setBanco] = useState("");
  const [telefono, setTelefono] = useState("");
  const [cedula, setCedula] = useState("");
  const [cuenta, setCuenta] = useState("");
  const [referencia, setReferencia] = useState("");
  const [abonos, setAbonos] = useState<Record<string, string>>({});
  const [archivo, setArchivo] = useState<File | null>(null);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState<Pago | null>(null);
  const [tasa, setTasa] = useState<{ fecha: string; tasa: number } | null>(null);
  const [errorTasa, setErrorTasa] = useState<string | null>(null);
  const tituloRef = useRef<HTMLHeadingElement>(null);

  const elegido = clientes.find((c) => claveCliente(c) === cliente) ?? clientes[0];
  const docsCliente = pendientes.filter((d) => claveCliente(d) === cliente);
  const cuentasDestino = cuentasEmpresa.filter((c) => c.empresa === elegido.empresa && (!metodo || c.tipo === metodo));
  const montoBs = leerMonto(montoBsTexto);
  const montoUsd = montoBs != null && tasa ? redondear(montoBs / tasa.tasa) : null;
  const abonado = redondear(
    docsCliente.reduce((suma, d) => suma + (leerMonto(abonos[d.id] ?? "") ?? 0), 0)
  );
  const aFavor = montoUsd != null ? redondear(montoUsd - abonado) : null;

  // La tasa BCV de la fecha del pago, para mostrar el equivalente en USD
  // mientras se escribe (el servidor la vuelve a calcular al guardar).
  useEffect(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || fecha > hoyCaracas()) return;
    let vigente = true;
    apiGet<{ fecha: string; tasa: number }>(`/portal/tasa?fecha=${fecha}`)
      .then((t) => {
        if (vigente) {
          setTasa(t);
          setErrorTasa(null);
        }
      })
      .catch((err) => {
        if (vigente) {
          setTasa(null);
          setErrorTasa(mensajeDeError(err, "No hay tasa BCV para esa fecha"));
        }
      });
    return () => {
      vigente = false;
    };
  }, [fecha]);

  // Al cambiar de paso (no al abrir la página), el foco va al título del
  // paso nuevo, para lectores de pantalla y teclado.
  const pasoAnterior = useRef(paso);
  useEffect(() => {
    if (pasoAnterior.current !== paso) tituloRef.current?.focus();
    pasoAnterior.current = paso;
  }, [paso]);

  function validarPaso(n: number): Record<string, string> {
    const e: Record<string, string> = {};
    if (n === 1 && !metodo) e.metodo = "Elige cómo hiciste el pago";
    if (n === 2) {
      if (!fecha || fecha > hoyCaracas()) e.fecha = "La fecha no puede ser futura";
      if (montoBs == null) e.montoBs = "Escribe el monto pagado en bolívares";
      if (!/^[A-Za-z0-9\s-]{4,30}$/.test(referencia.trim())) e.referencia = "Entre 4 y 30 letras o números";
      if (!/^[VEJGPvejgp]?[\s.-]?\d{6,9}[\s.-]?\d?$/.test(cedula.trim())) e.cedula = "Cédula o RIF de quien pagó (ej. V-12345678)";
      if (metodo === "PAGO_MOVIL") {
        if (!banco) e.banco = "Elige el banco desde el que pagaste";
        if (!/^(\+?58|0)?\s?4(12|14|16|22|24|26)[\s-]?\d{3}[\s-]?\d{4}$/.test(telefono.trim()))
          e.telefono = "Celular desde el que pagaste (ej. 0414-1234567)";
      }
      if (metodo === "TRANSFERENCIA") {
        const digitos = cuenta.replace(/\D/g, "");
        if (digitos.length !== 20) e.cuenta = "La cuenta tiene 20 dígitos";
        else if (!bancoDeCuenta(digitos)) e.cuenta = "Los primeros 4 dígitos no corresponden a ningún banco";
      }
      if (!tasa) e.fecha = errorTasa ?? "Esperando la tasa BCV de esa fecha";
    }
    if (n === 3) {
      for (const d of docsCliente) {
        const texto = abonos[d.id] ?? "";
        if (!texto.trim()) continue;
        const v = leerMonto(texto);
        if (v == null) e[`abono-${d.id}`] = "Monto no válido";
        else if (v > d.saldoUsd + 0.01) e[`abono-${d.id}`] = `Máximo ${formatUsd(d.saldoUsd, 2)}`;
      }
      if (montoUsd != null && abonado > montoUsd + 0.01) e.abonos = `Repartiste ${formatUsd(abonado, 2)} y el pago es de ${formatUsd(montoUsd, 2)}`;
    }
    return e;
  }

  function avanzar() {
    const e = validarPaso(paso);
    setErrores(e);
    if (Object.keys(e).length === 0) setPaso((p) => p + 1);
  }

  /** Reparte el pago entre los documentos que vencen primero. */
  function repartir() {
    if (montoUsd == null) return;
    let resto = montoUsd;
    const nuevo: Record<string, string> = {};
    for (const d of [...docsCliente].sort((a, b) => a.vence.localeCompare(b.vence))) {
      if (resto <= 0) break;
      const parte = redondear(Math.min(resto, d.saldoUsd));
      nuevo[d.id] = parte.toFixed(2);
      resto = redondear(resto - parte);
    }
    setAbonos(nuevo);
    setErrores({});
  }

  async function elegirArchivo(f: File | null) {
    setErrores((e) => ({ ...e, comprobante: "" }));
    if (!f) return setArchivo(null);
    if (!TIPOS_COMPROBANTE.includes(f.type)) {
      setErrores((e) => ({ ...e, comprobante: "Sube una imagen (JPG, PNG, WEBP) o un PDF" }));
      return;
    }
    if (f.type === "application/pdf") {
      if (f.size > FOTO_MAXIMA_BYTES) setErrores((e) => ({ ...e, comprobante: "El PDF pesa más de 10 MB" }));
      else setArchivo(f);
      return;
    }
    try {
      setArchivo(await comprimirFoto(f));
    } catch (err) {
      setErrores((e) => ({ ...e, comprobante: err instanceof ErrorFoto ? err.message : "No se pudo leer la imagen" }));
    }
  }

  async function enviar() {
    setEnviando(true);
    setErrorGeneral(null);
    try {
      const comprobanteClave = archivo ? await subirComprobante(archivo) : null;
      const pago = await apiPost<Pago>("/portal/pagos", {
        empresa: elegido.empresa,
        codigoCliente: elegido.codigoCliente,
        metodo,
        fechaPago: fecha,
        montoBs,
        bancoCodigo: metodo === "PAGO_MOVIL" ? banco : null,
        telefono: metodo === "PAGO_MOVIL" ? telefono : null,
        cedulaRif: cedula,
        cuenta: metodo === "TRANSFERENCIA" ? cuenta : null,
        referencia: referencia.trim(),
        comprobanteClave,
        aplicaciones: docsCliente
          .map((d) => ({ documentoId: d.id, montoUsd: leerMonto(abonos[d.id] ?? "") }))
          .filter((a): a is { documentoId: string; montoUsd: number } => a.montoUsd != null),
      });
      setEnviado(pago);
    } catch (err) {
      setErrorGeneral(mensajeDeError(err, "No se pudo reportar el pago"));
    } finally {
      setEnviando(false);
    }
  }

  if (enviado) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <CheckCircle2Icon className="size-12 text-success" aria-hidden />
          <h2 className="text-xl font-semibold" role="status">
            Pago {enviado.numero} reportado
          </h2>
          <p className="max-w-md text-sm text-muted-foreground">
            Recibimos tu reporte por {formatUsd(enviado.montoUsd, 2)} ({formatBs(enviado.montoBs)}). Queda en revisión
            hasta que cobranzas confirme que llegó; te avisaremos por correo.
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button asChild variant="outline">
              <Link href="/portal/pagos">Ver mis pagos</Link>
            </Button>
            <Button asChild>
              <Link href="/portal">Volver al resumen</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const e = (k: string) => errores[k] || undefined;

  return (
    <div className="space-y-4">
      <StepWizard steps={PASOS} currentStep={paso} />
      <p className="sr-only" aria-live="polite">
        Paso {paso} de {PASOS.length}: {PASOS[paso - 1].label}
      </p>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2 ref={tituloRef} tabIndex={-1} className="outline-none">
              {PASOS[paso - 1].label}
            </h2>
          </CardTitle>
          {paso === 1 && <CardDescription>Elige el cliente y el medio con el que pagaste.</CardDescription>}
          {paso === 2 && <CardDescription>Los datos tal como aparecen en tu comprobante del banco.</CardDescription>}
          {paso === 3 && (
            <CardDescription>
              Indica a qué facturas o notas de entrega abona este pago. Lo que no repartas queda a tu favor y se aplica a
              lo que vence primero.
            </CardDescription>
          )}
          {paso === 4 && <CardDescription>Adjunta el comprobante y revisa antes de enviar.</CardDescription>}
        </CardHeader>
        <CardContent className="space-y-4">
          {paso === 1 && (
            <>
              {clientes.length > 1 && (
                <Campo id="cliente" label="Cliente">
                  <Select
                    value={cliente}
                    onValueChange={(v) => {
                      setCliente(v);
                      setAbonos({});
                    }}
                  >
                    <SelectTrigger id="cliente" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {clientes.map((c) => (
                        <SelectItem key={claveCliente(c)} value={claveCliente(c)}>
                          {c.nombre} ({c.empresa} {c.codigoCliente})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Campo>
              )}
              <fieldset aria-describedby={e("metodo") ? "metodo-error" : undefined}>
                <legend className="mb-2 text-sm font-medium">Medio de pago</legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  <OpcionMetodo
                    valor="PAGO_MOVIL"
                    actual={metodo}
                    onElegir={setMetodo}
                    icono={SmartphoneIcon}
                    titulo="Pago móvil"
                    detalle="Te pediremos el banco, el celular y la cédula"
                  />
                  <OpcionMetodo
                    valor="TRANSFERENCIA"
                    actual={metodo}
                    onElegir={setMetodo}
                    icono={LandmarkIcon}
                    titulo="Transferencia"
                    detalle="Te pediremos la cuenta y la cédula"
                  />
                </div>
                {e("metodo") && (
                  <p id="metodo-error" className="mt-2 text-xs text-destructive">
                    {e("metodo")}
                  </p>
                )}
              </fieldset>
              {metodo && cuentasDestino.length > 0 && (
                <div className="rounded-lg bg-muted/60 p-3 text-sm">
                  <p className="mb-1 font-medium">Dónde pagar ({elegido.empresa})</p>
                  <ul className="space-y-1 text-muted-foreground">
                    {cuentasDestino.map((c) => (
                      <li key={c.id}>
                        {c.banco} · {c.tipo === "PAGO_MOVIL" ? formatTelefono(c.numero) : formatCuenta(c.numero)} · {c.rif} ·{" "}
                        {c.titular}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}

          {paso === 2 && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo id="fecha" label="Fecha del pago" error={e("fecha")}>
                <Input type="date" value={fecha} max={hoyCaracas()} onChange={(ev) => setFecha(ev.target.value)} {...ariaCampo("fecha", e("fecha"))} />
              </Campo>
              <Campo
                id="montoBs"
                label="Monto pagado (Bs)"
                error={e("montoBs")}
                ayuda={montoUsd != null && tasa ? `≈ ${formatUsd(montoUsd, 2)} a ${tasa.tasa.toLocaleString("es-VE")} Bs/USD (BCV)` : undefined}
              >
                <Input
                  inputMode="decimal"
                  placeholder="0,00"
                  value={montoBsTexto}
                  onChange={(ev) => setMontoBsTexto(ev.target.value)}
                  {...ariaCampo("montoBs", e("montoBs"), montoUsd != null ? "equivalente" : undefined)}
                />
              </Campo>
              {metodo === "PAGO_MOVIL" ? (
                <>
                  <Campo id="banco" label="Banco desde el que pagaste" error={e("banco")}>
                    <Select value={banco} onValueChange={setBanco}>
                      <SelectTrigger id="banco" className="w-full" aria-invalid={e("banco") ? true : undefined}>
                        <SelectValue placeholder="Elige el banco" />
                      </SelectTrigger>
                      <SelectContent>
                        {BANCOS.map((b) => (
                          <SelectItem key={b.codigo} value={b.codigo}>
                            {b.codigo} · {b.nombre}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Campo>
                  <Campo id="telefono" label="Celular desde el que pagaste" error={e("telefono")}>
                    <Input type="tel" inputMode="tel" placeholder="0414-1234567" value={telefono} onChange={(ev) => setTelefono(ev.target.value)} {...ariaCampo("telefono", e("telefono"))} />
                  </Campo>
                </>
              ) : (
                <Campo
                  id="cuenta"
                  label="Cuenta desde la que transferiste"
                  error={e("cuenta")}
                  ayuda={bancoDeCuenta(cuenta) ?? "20 dígitos; el banco se reconoce solo"}
                >
                  <Input
                    inputMode="numeric"
                    placeholder="0134 0000 0000 0000 0000"
                    value={cuenta}
                    onChange={(ev) => setCuenta(ev.target.value)}
                    {...ariaCampo("cuenta", e("cuenta"), "banco")}
                  />
                </Campo>
              )}
              <Campo id="cedula" label="Cédula o RIF de quien pagó" error={e("cedula")}>
                <Input placeholder="V-12345678" value={cedula} onChange={(ev) => setCedula(ev.target.value)} {...ariaCampo("cedula", e("cedula"))} />
              </Campo>
              <Campo id="referencia" label="Número de referencia" error={e("referencia")}>
                <Input value={referencia} onChange={(ev) => setReferencia(ev.target.value)} {...ariaCampo("referencia", e("referencia"))} />
              </Campo>
            </div>
          )}

          {paso === 3 && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/60 p-3 text-sm">
                <span>
                  Pago: <strong className="tabular-nums">{formatUsd(montoUsd, 2)}</strong> · Repartido:{" "}
                  <strong className="tabular-nums">{formatUsd(abonado, 2)}</strong> · Queda a favor:{" "}
                  <strong className="tabular-nums">{formatUsd(Math.max(aFavor ?? 0, 0), 2)}</strong>
                </span>
                <Button type="button" variant="outline" size="sm" onClick={repartir} disabled={docsCliente.length === 0}>
                  <Wand2Icon aria-hidden />
                  Repartir a lo más antiguo
                </Button>
              </div>
              {e("abonos") && (
                <p role="alert" className="text-sm text-destructive">
                  {e("abonos")}
                </p>
              )}
              {docsCliente.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  No tienes documentos pendientes: el pago quedará a tu favor.
                </p>
              ) : (
                <ul className="divide-y divide-border rounded-lg border border-border">
                  {docsCliente.map((d) => (
                    <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                      <div className="min-w-0 text-sm">
                        <p className="font-medium">{nombreDocumento(d)}</p>
                        <p className="text-muted-foreground">
                          Vence {formatDate(d.vence)} · saldo {formatUsd(d.saldoUsd, 2)}
                          {d.estado === "VENCIDO" && <span className="text-destructive"> · vencido</span>}
                        </p>
                      </div>
                      <div className="w-36">
                        <label htmlFor={`abono-${d.id}`} className="sr-only">
                          Abono a {nombreDocumento(d)} en USD
                        </label>
                        <Input
                          id={`abono-${d.id}`}
                          inputMode="decimal"
                          placeholder="USD 0,00"
                          value={abonos[d.id] ?? ""}
                          onChange={(ev) => setAbonos((a) => ({ ...a, [d.id]: ev.target.value }))}
                          aria-invalid={e(`abono-${d.id}`) ? true : undefined}
                          aria-describedby={e(`abono-${d.id}`) ? `abono-${d.id}-error` : undefined}
                          className="text-right tabular-nums"
                        />
                        {e(`abono-${d.id}`) && (
                          <p id={`abono-${d.id}-error`} className="mt-1 text-xs text-destructive">
                            {e(`abono-${d.id}`)}
                          </p>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          {paso === 4 && (
            <>
              <Campo id="comprobante" label="Comprobante (recomendado)" error={e("comprobante")} ayuda="Captura o PDF del banco, hasta 10 MB">
                {archivo ? (
                  <div className="flex items-center justify-between gap-2 rounded-md border border-border p-2 text-sm">
                    <span className="truncate">{archivo.name}</span>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setArchivo(null)}>
                      <XIcon aria-hidden />
                      Quitar
                    </Button>
                  </div>
                ) : (
                  <label className="flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground hover:bg-muted has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring">
                    <FileUpIcon className="size-4" aria-hidden />
                    Elegir archivo
                    <input
                      type="file"
                      accept={TIPOS_COMPROBANTE.join(",")}
                      className="sr-only"
                      onChange={(ev) => elegirArchivo(ev.target.files?.[0] ?? null)}
                      {...ariaCampo("comprobante", e("comprobante"), "ayuda")}
                    />
                  </label>
                )}
              </Campo>
              <dl className="grid gap-x-4 gap-y-2 rounded-lg bg-muted/60 p-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground">Cliente</dt>
                  <dd className="font-medium">
                    {elegido.nombre} ({elegido.empresa})
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Medio</dt>
                  <dd className="font-medium">
                    {metodo === "PAGO_MOVIL" ? "Pago móvil" : "Transferencia"} · ref. {referencia.trim()}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Monto</dt>
                  <dd className="font-medium tabular-nums">
                    {formatBs(montoBs)} ≈ {formatUsd(montoUsd, 2)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Fecha</dt>
                  <dd className="font-medium">{formatDate(fecha)}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-muted-foreground">Abona a</dt>
                  <dd className="font-medium">
                    {abonado > 0
                      ? docsCliente
                          .filter((d) => leerMonto(abonos[d.id] ?? ""))
                          .map((d) => `${nombreDocumento(d)} (${formatUsd(leerMonto(abonos[d.id] ?? ""), 2)})`)
                          .join(", ")
                      : "Lo que vence primero"}
                    {aFavor != null && aFavor > 0.009 && abonado > 0 && ` · ${formatUsd(aFavor, 2)} a favor`}
                  </dd>
                </div>
              </dl>
              {errorGeneral && (
                <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {errorGeneral}
                </p>
              )}
            </>
          )}

          <div className="flex flex-wrap justify-between gap-2 border-t border-border pt-4">
            {paso > 1 ? (
              <Button type="button" variant="outline" onClick={() => setPaso((p) => p - 1)} disabled={enviando}>
                <ArrowLeftIcon aria-hidden />
                Atrás
              </Button>
            ) : (
              <Button type="button" variant="ghost" asChild>
                <Link href="/portal/pagos">Cancelar</Link>
              </Button>
            )}
            {paso < PASOS.length ? (
              <Button type="button" onClick={avanzar}>
                Siguiente
                <ArrowRightIcon aria-hidden />
              </Button>
            ) : (
              <Button type="button" onClick={enviar} disabled={enviando}>
                <SendIcon aria-hidden />
                {enviando ? "Enviando..." : "Reportar pago"}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
