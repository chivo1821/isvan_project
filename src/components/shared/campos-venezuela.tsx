"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { bancoDeCuenta } from "@/lib/bancos";
import { cn } from "@/lib/utils";

// Campos con formato venezolano. Cada uno corta lo que no corresponde
// MIENTRAS se escribe (no deja pasar letras ni dígitos de más) y entrega un
// solo texto con el formato que valida la API (backend/app/services/bancos.py
// y motorizados.validar_telefono).

export const PREFIJOS_MOVILES = ["0412", "0414", "0416", "0422", "0424", "0426"] as const;

export const TIPOS_CEDULA_RIF = [
  { valor: "V", label: "V", detalle: "Venezolano" },
  { valor: "E", label: "E", detalle: "Extranjero" },
  { valor: "J", label: "J", detalle: "Jurídico" },
  { valor: "G", label: "G", detalle: "Gobierno" },
  { valor: "P", label: "P", detalle: "Pasaporte" },
  { valor: "C", label: "C", detalle: "Comunal" },
] as const;

export const DIGITOS_CUENTA = 20;
const DIGITOS_TELEFONO = 7;
// Cedula: hasta 8; RIF: 8 + el digito verificador. Ninguno pasa de 9.
const DIGITOS_CEDULA_RIF = 9;
const LARGO_REFERENCIA = 30;
const LARGO_MONTO = 18;

const soloDigitos = (texto: string, maximo: number) => texto.replace(/\D/g, "").slice(0, maximo);

/** Referencia bancaria: letras y números, sin espacios ni guiones, hasta 30. */
export function filtrarReferencia(texto: string): string {
  return texto.replace(/[^A-Za-z0-9]/g, "").slice(0, LARGO_REFERENCIA).toUpperCase();
}

/** Monto: dígitos y separadores ("1.234,56" o "1234.56"), con tope de largo. */
export function filtrarMonto(texto: string): string {
  return texto.replace(/[^\d.,]/g, "").slice(0, LARGO_MONTO);
}

type PropsCampo = {
  id: string;
  value: string;
  onChange: (valor: string) => void;
  invalido?: boolean;
  describedBy?: string;
  className?: string;
  disabled?: boolean;
};

/** Celular venezolano: prefijo (lista) + 7 dígitos. Entrega "04141234567"
 * (o lo que haya escrito hasta ahora; la validación decide si está completo). */
export function TelefonoVe({ id, value, onChange, invalido, describedBy, className, disabled }: PropsCampo) {
  const inicial = PREFIJOS_MOVILES.find((p) => value.startsWith(p)) ?? "";
  const [prefijo, setPrefijo] = useState<string>(inicial);
  const [cuerpo, setCuerpo] = useState(inicial ? soloDigitos(value.slice(4), DIGITOS_TELEFONO) : "");

  return (
    <div className={cn("flex gap-2", className)}>
      <Select
        value={prefijo}
        onValueChange={(p) => {
          setPrefijo(p);
          onChange(p + cuerpo);
        }}
        disabled={disabled}
      >
        <SelectTrigger className="w-28 shrink-0" aria-label="Prefijo del celular" aria-invalid={invalido || undefined}>
          <SelectValue placeholder="0414" />
        </SelectTrigger>
        <SelectContent>
          {PREFIJOS_MOVILES.map((p) => (
            <SelectItem key={p} value={p}>
              {p}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input
        id={id}
        type="tel"
        inputMode="numeric"
        autoComplete="tel-local"
        placeholder="1234567"
        value={cuerpo}
        disabled={disabled}
        aria-invalid={invalido || undefined}
        aria-describedby={describedBy}
        onChange={(e) => {
          const nuevo = soloDigitos(e.target.value, DIGITOS_TELEFONO);
          setCuerpo(nuevo);
          onChange(prefijo + nuevo);
        }}
        className="min-w-0 flex-1 tabular-nums"
      />
    </div>
  );
}

/** Cédula o RIF: tipo (V, E, J, G, P, C) + número. Entrega "V12345678". */
export function CedulaRif({ id, value, onChange, invalido, describedBy, className, disabled }: PropsCampo) {
  const letra = value.charAt(0).toUpperCase();
  const [tipo, setTipo] = useState<string>(TIPOS_CEDULA_RIF.some((t) => t.valor === letra) ? letra : "V");
  const [numero, setNumero] = useState(soloDigitos(value, DIGITOS_CEDULA_RIF));

  return (
    <div className={cn("flex gap-2", className)}>
      <Select
        value={tipo}
        onValueChange={(t) => {
          setTipo(t);
          onChange(numero ? t + numero : "");
        }}
        disabled={disabled}
      >
        <SelectTrigger className="w-20 shrink-0" aria-label="Tipo de cédula o RIF" aria-invalid={invalido || undefined}>
          {/* Cerrada muestra solo la letra; el nombre va en las opciones. */}
          <SelectValue>{tipo}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {TIPOS_CEDULA_RIF.map((t) => (
            <SelectItem key={t.valor} value={t.valor}>
              {t.label} · {t.detalle}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input
        id={id}
        inputMode="numeric"
        placeholder={tipo === "V" || tipo === "E" ? "12345678" : "401234567"}
        value={numero}
        disabled={disabled}
        aria-invalid={invalido || undefined}
        aria-describedby={describedBy}
        onChange={(e) => {
          const nuevo = soloDigitos(e.target.value, DIGITOS_CEDULA_RIF);
          setNumero(nuevo);
          onChange(nuevo ? tipo + nuevo : "");
        }}
        className="min-w-0 flex-1 tabular-nums"
      />
    </div>
  );
}

/** Cuenta bancaria: solo dígitos, como mucho 20. Debajo, cuántos van y el
 * banco que corresponde a los 4 primeros. */
export function CuentaBancaria({ id, value, onChange, invalido, describedBy, className, disabled }: PropsCampo) {
  const banco = bancoDeCuenta(value);
  return (
    <div className={cn("space-y-1", className)}>
      <Input
        id={id}
        inputMode="numeric"
        placeholder="01340000000000000000"
        value={value}
        disabled={disabled}
        aria-invalid={invalido || undefined}
        aria-describedby={[describedBy, `${id}-conteo`].filter(Boolean).join(" ")}
        onChange={(e) => onChange(soloDigitos(e.target.value, DIGITOS_CUENTA))}
        className="tabular-nums tracking-wide"
      />
      <p id={`${id}-conteo`} className="flex justify-between gap-2 text-xs text-muted-foreground">
        <span>{banco ?? (value.length >= 4 ? "Banco no reconocido" : "El banco se reconoce por los 4 primeros dígitos")}</span>
        <span className="tabular-nums">
          {value.length}/{DIGITOS_CUENTA}
        </span>
      </p>
    </div>
  );
}
