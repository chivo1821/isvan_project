"use client";

import Link from "@/components/shared/enlace";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AlertTriangleIcon, PowerIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDate } from "@/lib/constants";
import type { EmpresaFiscal, EstadoTasa } from "@/lib/administrativo";

/** Cambia la empresa de la pantalla (?empresa=<id>), conservando la ruta. */
export function SelectorEmpresa({ empresas, actual }: { empresas: EmpresaFiscal[]; actual: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  if (empresas.length < 2) return null;
  return (
    <Select
      value={actual}
      onValueChange={(id) => {
        const nuevos = new URLSearchParams(params.toString());
        nuevos.set("empresa", id);
        router.replace(`${pathname}?${nuevos.toString()}`);
      }}
    >
      <SelectTrigger className="w-40" aria-label="Empresa">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {empresas.map((e) => (
          <SelectItem key={e.id} value={e.id}>
            {e.codigo}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Lo que se ve cuando el módulo está apagado para la empresa. */
export function ModuloApagado({ modulo, empresa }: { modulo: "ventas" | "inventario"; empresa: EmpresaFiscal }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
        <PowerIcon className="size-8 text-muted-foreground" aria-hidden />
        <p className="font-medium">El módulo de {modulo} está apagado para {empresa.codigo}</p>
        <p className="max-w-md text-sm text-muted-foreground">
          Se enciende por empresa en Empresas, cuando estén listos sus datos fiscales. Mientras tanto, nada de esto
          afecta la operación de hoy.
        </p>
        <Button variant="outline" asChild>
          <Link href={`/administrativo/empresas?empresa=${empresa.id}`}>Ir a Empresas</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

/** Aviso cuando no hay tasa BCV reciente: los documentos no se emiten sin ella. */
export function AvisoTasa({ tasa }: { tasa: EstadoTasa }) {
  if (tasa.vigente) return null;
  return (
    <p role="status" className="flex items-start gap-2 rounded-lg bg-warning/10 px-3 py-2 text-sm">
      <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
      No hay tasa BCV reciente{tasa.fecha ? ` (la última es del ${formatDate(tasa.fecha)})` : ""}: los documentos no se
      emiten hasta que llegue la del día o se cargue a mano en Cobranzas → Ajustes.
    </p>
  );
}

export const ESTADO_TONO = {
  BORRADOR: "neutral",
  CONFIRMADO: "info",
  FACTURADO: "success",
  ANULADO: "neutral",
  EN_EMISION: "warning",
  EMITIDA: "success",
  RECHAZADA: "destructive",
  PROPUESTO: "warning",
  APROBADO: "success",
  RECHAZADO: "neutral",
} as const;

export const ESTADO_TEXTO: Record<string, string> = {
  BORRADOR: "Borrador",
  CONFIRMADO: "Confirmado",
  FACTURADO: "Facturado",
  ANULADO: "Anulado",
  EN_EMISION: "Emitiendo",
  EMITIDA: "Emitida",
  RECHAZADA: "Rechazada",
  PROPUESTO: "Por aprobar",
  APROBADO: "Aprobado",
  RECHAZADO: "Rechazado",
};

export function useParametrosEmpresa() {
  return useSearchParams().get("empresa");
}
