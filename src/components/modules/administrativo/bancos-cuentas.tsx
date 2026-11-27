"use client";

import { useState } from "react";
import {
  AlertTriangleIcon,
  Building2Icon,
  CheckIcon,
  CopyIcon,
  CreditCardIcon,
  PencilIcon,
  PlusIcon,
  WalletIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiPost, apiPut, mensajeDeError } from "@/lib/api-client";
import { formatBs, formatDate, formatUsd } from "@/lib/constants";
import { BANCOS, bancoDeCuenta, formatCuenta } from "@/lib/bancos";
import type { CuentaTesoreria, MonedaCuenta, TipoCuentaTesoreria } from "@/lib/administrativo";

export const TIPOS_CUENTA_LABELS: Record<TipoCuentaTesoreria, string> = {
  BANCO_CORRIENTE: "Cuenta corriente",
  BANCO_AHORRO: "Cuenta de ahorro",
  BANCO_CUSTODIA_USD: "Custodia / Divisas",
  CAJA_EFECTIVO: "Caja chica / Efectivo",
  BILLETERA_DIGITAL: "Billetera digital",
};

export function BancosCuentas({
  empresaId,
  cuentas,
  onActualizado,
}: {
  empresaId: string;
  cuentas: CuentaTesoreria[];
  onActualizado: () => void;
}) {
  const [modalAbierto, setModalAbierto] = useState(false);
  const [cuentaEdicion, setCuentaEdicion] = useState<CuentaTesoreria | null>(null);
  const [copiadoId, setCopiadoId] = useState<string | null>(null);

  function abrirNuevo() {
    setCuentaEdicion(null);
    setModalAbierto(true);
  }

  function abrirEdicion(cuenta: CuentaTesoreria) {
    setCuentaEdicion(cuenta);
    setModalAbierto(true);
  }

  async function copiarNumero(id: string, numero: string) {
    try {
      await navigator.clipboard.writeText(numero);
      setCopiadoId(id);
      toast.success("Número de cuenta copiado al portapapeles");
      setTimeout(() => setCopiadoId(null), 2000);
    } catch {
      toast.error("No se pudo copiar el número");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">Cuentas bancarias y cajas</h3>
          <p className="text-xs text-muted-foreground">
            Cuentas operativas en bolívares y dólares, cajas de efectivo y custodias.
          </p>
        </div>
        <Button onClick={abrirNuevo} size="sm" className="gap-1.5">
          <PlusIcon className="size-4" />
          Nueva cuenta o caja
        </Button>
      </div>

      {cuentas.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-10 text-center">
            <Building2Icon className="mb-3 size-10 text-muted-foreground/50" />
            <p className="text-sm font-medium">No hay cuentas bancarias registradas</p>
            <p className="text-xs text-muted-foreground max-w-sm mt-1">
              Agrega tu primera cuenta bancaria o caja chica para comenzar a registrar movimientos y disponible.
            </p>
            <Button onClick={abrirNuevo} variant="outline" size="sm" className="mt-4 gap-1.5">
              <PlusIcon className="size-4" />
              Crear primera cuenta
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {cuentas.map((c) => {
            const esBanco =
              c.tipo === "BANCO_CORRIENTE" ||
              c.tipo === "BANCO_AHORRO" ||
              c.tipo === "BANCO_CUSTODIA_USD";
            const esNegativo = c.enNegativo || c.saldoActual < 0;

            return (
              <Card
                key={c.id}
                className={`relative overflow-hidden transition-shadow hover:shadow-sm ${
                  esNegativo ? "border-destructive/60 bg-destructive/5" : ""
                } ${!c.activa ? "opacity-60" : ""}`}
              >
                <CardHeader className="pb-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <CardTitle className="text-base font-semibold leading-snug">
                          {c.nombre}
                        </CardTitle>
                        <Badge
                          variant={c.moneda === "USD" ? "default" : "secondary"}
                          className="font-mono text-xs px-1.5 py-0"
                        >
                          {c.moneda}
                        </Badge>
                        {!c.activa && (
                          <Badge variant="outline" className="text-xs text-muted-foreground">
                            Inactiva
                          </Badge>
                        )}
                      </div>
                      <CardDescription className="text-xs">
                        {TIPOS_CUENTA_LABELS[c.tipo]}
                        {c.bancoNombre ? ` · ${c.bancoNombre}` : ""}
                      </CardDescription>
                    </div>

                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
                      onClick={() => abrirEdicion(c)}
                      title="Editar cuenta"
                    >
                      <PencilIcon className="size-3.5" />
                      <span className="sr-only">Editar {c.nombre}</span>
                    </Button>
                  </div>
                </CardHeader>

                <CardContent className="space-y-3 pt-0">
                  {esNegativo && (
                    <div className="flex items-center gap-1.5 rounded-md bg-destructive/15 px-2.5 py-1 text-xs font-medium text-destructive">
                      <AlertTriangleIcon className="size-3.5 shrink-0" />
                      <span>Cuenta en negativo / sobregiro</span>
                    </div>
                  )}

                  <div className="rounded-lg bg-muted/40 p-2.5">
                    <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                      Saldo disponible
                    </div>
                    <div
                      className={`text-xl font-bold tabular-nums tracking-tight ${
                        esNegativo ? "text-destructive" : ""
                      }`}
                    >
                      {c.moneda === "USD" ? formatUsd(c.saldoActual, 2) : formatBs(c.saldoActual)}
                    </div>
                    {c.moneda === "VES" && (
                      <div className="text-xs text-muted-foreground tabular-nums">
                        ≈ {formatUsd(c.saldoEquivalenteUsd, 2)} a tasa oficial
                      </div>
                    )}
                  </div>

                  {c.numeroCuenta && (
                    <div className="flex items-center justify-between text-xs text-muted-foreground pt-1">
                      <div className="flex items-center gap-1.5 font-mono">
                        <CreditCardIcon className="size-3.5 shrink-0" />
                        <span>{formatCuenta(c.numeroCuenta)}</span>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-6 text-muted-foreground hover:text-foreground"
                        onClick={() => copiarNumero(c.id, c.numeroCuenta ?? "")}
                        title="Copiar número"
                      >
                        {copiadoId === c.id ? (
                          <CheckIcon className="size-3 text-success" />
                        ) : (
                          <CopyIcon className="size-3" />
                        )}
                      </Button>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center justify-between gap-1 border-t pt-2 text-[11px] text-muted-foreground">
                    <div>
                      {c.titular ? (
                        <span>Titular: {c.titular}</span>
                      ) : (
                        <span>{esBanco ? "Banco registrado" : "Caja interna"}</span>
                      )}
                    </div>
                    {c.ultimoMovimientoEn && (
                      <div>Últ. mov: {formatDate(c.ultimoMovimientoEn)}</div>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <CuentaModal
        key={modalAbierto ? (cuentaEdicion?.id ?? "nueva") : "cerrado"}
        abierto={modalAbierto}
        onOpenChange={setModalAbierto}
        empresaId={empresaId}
        cuenta={cuentaEdicion}
        onGuardado={onActualizado}
      />
    </div>
  );
}

function CuentaModal({
  abierto,
  onOpenChange,
  empresaId,
  cuenta,
  onGuardado,
}: {
  abierto: boolean;
  onOpenChange: (open: boolean) => void;
  empresaId: string;
  cuenta: CuentaTesoreria | null;
  onGuardado: () => void;
}) {
  const esEdicion = cuenta !== null;
  const [guardando, setGuardando] = useState(false);

  const [nombre, setNombre] = useState(cuenta?.nombre ?? "");
  const [tipo, setTipo] = useState<TipoCuentaTesoreria>(cuenta?.tipo ?? "BANCO_CORRIENTE");
  const [moneda, setMoneda] = useState<MonedaCuenta>(cuenta?.moneda ?? "VES");
  const [bancoCodigo, setBancoCodigo] = useState(cuenta?.bancoCodigo ?? "");
  const [numeroCuenta, setNumeroCuenta] = useState(cuenta?.numeroCuenta ?? "");
  const [titular, setTitular] = useState(cuenta?.titular ?? "");
  const [rif, setRif] = useState(cuenta?.rif ?? "");
  const [saldoInicial, setSaldoInicial] = useState(cuenta ? String(cuenta.saldoInicial) : "0");
  const [fechaSaldoInicial, setFechaSaldoInicial] = useState(
    cuenta?.fechaSaldoInicial ?? new Date().toISOString().slice(0, 10)
  );
  const [activa, setActiva] = useState(cuenta ? cuenta.activa : true);

  const esBanco =
    tipo === "BANCO_CORRIENTE" || tipo === "BANCO_AHORRO" || tipo === "BANCO_CUSTODIA_USD";

  function onCambioNumeroCuenta(val: string) {
    const raw = val.replace(/\D/g, "").slice(0, 20);
    setNumeroCuenta(raw);
    if (raw.length >= 4) {
      const codigo = raw.slice(0, 4);
      const match = BANCOS.find((b) => b.codigo === codigo);
      if (match && !bancoCodigo) {
        setBancoCodigo(match.codigo);
      }
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!nombre.trim()) {
      toast.error("El nombre de la cuenta es obligatorio");
      return;
    }

    setGuardando(true);
    try {
      if (esEdicion) {
        await apiPut(`/bancos/cuentas/${cuenta.id}`, {
          nombre: nombre.trim(),
          tipo,
          moneda,
          bancoCodigo: esBanco ? bancoCodigo || null : null,
          numeroCuenta: esBanco ? numeroCuenta.trim() || null : null,
          titular: titular.trim() || null,
          rif: rif.trim() || null,
          activa,
        });
        toast.success("Cuenta actualizada correctamente");
      } else {
        const saldoNum = Number(saldoInicial.replace(/\./g, "").replace(",", ".")) || 0;
        await apiPost("/bancos/cuentas", {
          empresaId,
          nombre: nombre.trim(),
          tipo,
          moneda,
          bancoCodigo: esBanco ? bancoCodigo || null : null,
          numeroCuenta: esBanco ? numeroCuenta.trim() || null : null,
          titular: titular.trim() || null,
          rif: rif.trim() || null,
          saldoInicial: saldoNum,
          fechaSaldoInicial,
          activa,
        });
        toast.success("Cuenta creada correctamente");
      }
      onOpenChange(false);
      onGuardado();
    } catch (err) {
      toast.error(
        esEdicion ? "No se pudo actualizar la cuenta" : "No se pudo crear la cuenta",
        { description: mensajeDeError(err, "Verifica los datos ingresados") }
      );
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Dialog open={abierto} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{esEdicion ? "Editar cuenta / caja" : "Nueva cuenta bancaria o caja"}</DialogTitle>
            <DialogDescription>
              {esEdicion
                ? "Modifica los datos de la cuenta seleccionada."
                : "Registra una cuenta bancaria nacional, custodia en divisas o caja chica de efectivo."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2 space-y-1">
              <Label htmlFor="cta-nombre">Nombre de la cuenta o caja *</Label>
              <Input
                id="cta-nombre"
                placeholder="Ej. Banesco Operativa Bs, Caja Efectivo Ventas"
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                required
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="cta-tipo">Tipo de tesorería</Label>
              <Select
                value={tipo}
                onValueChange={(v) => {
                  const t = v as TipoCuentaTesoreria;
                  setTipo(t);
                  if (t === "BANCO_CUSTODIA_USD") setMoneda("USD");
                  if (t === "CAJA_EFECTIVO" || t === "BILLETERA_DIGITAL") {
                    setBancoCodigo("");
                  }
                }}
              >
                <SelectTrigger id="cta-tipo" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(TIPOS_CUENTA_LABELS).map(([k, label]) => (
                    <SelectItem key={k} value={k}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label htmlFor="cta-moneda">Moneda</Label>
              <Select
                value={moneda}
                onValueChange={(v) => setMoneda(v as MonedaCuenta)}
                disabled={tipo === "BANCO_CUSTODIA_USD"}
              >
                <SelectTrigger id="cta-moneda" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="VES">Bolívares (VES)</SelectItem>
                  <SelectItem value="USD">Dólares (USD)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {esBanco && (
              <>
                <div className="sm:col-span-2 space-y-1">
                  <Label htmlFor="cta-banco">Banco nacional (SUDEBAN)</Label>
                  <Select
                    value={bancoCodigo}
                    onValueChange={(v) => {
                      setBancoCodigo(v);
                      if (numeroCuenta.length >= 4 && v !== numeroCuenta.slice(0, 4)) {
                        setNumeroCuenta(v + numeroCuenta.slice(4));
                      }
                    }}
                  >
                    <SelectTrigger id="cta-banco" className="w-full">
                      <SelectValue placeholder="Selecciona un banco" />
                    </SelectTrigger>
                    <SelectContent className="max-h-56">
                      {BANCOS.map((b) => (
                        <SelectItem key={b.codigo} value={b.codigo}>
                          {b.codigo} - {b.nombre}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="sm:col-span-2 space-y-1">
                  <Label htmlFor="cta-numero">Número de cuenta (20 dígitos)</Label>
                  <Input
                    id="cta-numero"
                    className="font-mono"
                    placeholder="0134 0001 2300 1234 5678"
                    value={numeroCuenta ? formatCuenta(numeroCuenta) : ""}
                    onChange={(e) => onCambioNumeroCuenta(e.target.value)}
                    maxLength={24}
                  />
                  {numeroCuenta.length > 0 && numeroCuenta.length !== 20 && (
                    <p className="text-[11px] text-warning">
                      El número de cuenta bancaria debe tener 20 dígitos ({numeroCuenta.length}/20)
                    </p>
                  )}
                </div>

                <div className="space-y-1">
                  <Label htmlFor="cta-titular">Titular de la cuenta</Label>
                  <Input
                    id="cta-titular"
                    placeholder="Razón social o nombre"
                    value={titular}
                    onChange={(e) => setTitular(e.target.value)}
                  />
                </div>

                <div className="space-y-1">
                  <Label htmlFor="cta-rif">RIF o Cédula</Label>
                  <Input
                    id="cta-rif"
                    placeholder="J-123456789"
                    maxLength={11}
                    value={rif}
                    onChange={(e) => {
                      const raw = e.target.value.toUpperCase().replace(/[^VEJGPC0-9-]/g, "");
                      if (!raw) {
                        setRif("");
                        return;
                      }
                      const prefijo = raw[0];
                      if (/[VEJGPC]/.test(prefijo)) {
                        const digitos = raw.slice(1).replace(/\D/g, "").slice(0, 9);
                        setRif(digitos.length > 0 || raw.includes("-") ? `${prefijo}-${digitos}` : prefijo);
                      } else {
                        const digitos = raw.replace(/\D/g, "").slice(0, 9);
                        setRif(digitos);
                      }
                    }}
                  />
                </div>
              </>
            )}

            {!esEdicion && (
              <>
                <div className="space-y-1">
                  <Label htmlFor="cta-saldo-ini">Saldo inicial</Label>
                  <Input
                    id="cta-saldo-ini"
                    type="text"
                    inputMode="decimal"
                    className="tabular-nums"
                    placeholder="0,00"
                    value={saldoInicial}
                    onChange={(e) => {
                      const raw = e.target.value;
                      const negativo = raw.trimStart().startsWith("-") ? "-" : "";
                      const limpio = raw.replace(/[^0-9,]/g, "");
                      const [enteroRaw = "", ...resto] = limpio.split(",");
                      const enteroSinCeros = enteroRaw.replace(/^0+(?=\d)/, "");
                      const enteroFmt = enteroSinCeros.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
                      const decimales = resto.length > 0 ? `,${resto.join("").slice(0, 2)}` : "";
                      setSaldoInicial(`${negativo}${enteroFmt}${decimales}`);
                    }}
                  />
                </div>

                <div className="space-y-1">
                  <Label htmlFor="cta-fecha-ini">Fecha de saldo inicial</Label>
                  <Input
                    id="cta-fecha-ini"
                    type="date"
                    value={fechaSaldoInicial}
                    onChange={(e) => setFechaSaldoInicial(e.target.value)}
                  />
                </div>
              </>
            )}

            {esEdicion && (
              <div className="sm:col-span-2 flex items-center gap-2 pt-2">
                <input
                  id="cta-activa"
                  type="checkbox"
                  className="size-4 rounded border-border"
                  checked={activa}
                  onChange={(e) => setActiva(e.target.checked)}
                />
                <Label htmlFor="cta-activa" className="text-sm font-normal cursor-pointer">
                  Cuenta activa para operaciones
                </Label>
              </div>
            )}
          </div>

          <DialogFooter className="flex-wrap gap-2 pt-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={guardando}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={guardando}>
              {guardando ? "Guardando..." : esEdicion ? "Guardar cambios" : "Crear cuenta"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
