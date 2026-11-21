"use client";

import Link from "@/components/shared/enlace";
import { MessageSquareWarningIcon } from "lucide-react";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatDateTime, formatHora } from "@/lib/constants";
import type { NoEntregado } from "@/lib/mock-data";
import { ETIQUETA_NO_ENTREGADO } from "@/lib/no-entregados";
import { cn } from "@/lib/utils";

/** El documento como lo conoce la oficina: «NE 2789», o el número a secas. */
function documento(n: NoEntregado) {
  return n.tipoDocumento ? `${n.tipoDocumento} ${n.numeroDocumento}` : `Doc. ${n.numeroDocumento}`;
}

/** Botón «Motivo»: abre el porqué, quién lo marcó y cuándo. */
export function MotivoNoEntregado({ parada, className }: { parada: NoEntregado; className?: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn("border-destructive/40 text-destructive hover:bg-destructive/5 hover:text-destructive", className)}
        >
          <MessageSquareWarningIcon />
          Motivo
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 space-y-2 text-sm">
        <p className="font-medium text-destructive">{ETIQUETA_NO_ENTREGADO[parada.alcance]}</p>
        <p className="text-foreground">«{parada.motivo}»</p>
        <p className="text-xs text-muted-foreground">
          {parada.usuario} · {formatDateTime(parada.fecha)}
          {parada.llegadaEn && ` · había llegado a las ${formatHora(parada.llegadaEn)}`}
        </p>
        <p className="text-xs text-muted-foreground">
          El despacho volvió a «Aprobado» para salir en otro viaje.
        </p>
      </PopoverContent>
    </Popover>
  );
}

/** La parada en rojo, en su lugar de la lista, con su botón de motivo. */
export function TarjetaNoEntregada({ parada, numero }: { parada: NoEntregado; numero?: number }) {
  return (
    <div className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-foreground">
            {numero != null && `${numero}. `}
            {parada.cliente.nombre}
          </p>
          <p className="text-muted-foreground">
            <span className="font-medium text-foreground">{documento(parada)}</span> · cód. {parada.cliente.codigo}
            {parada.cliente.ciudad && ` · ${parada.cliente.ciudad}`}
          </p>
          <Link href={`/despachos/${parada.despachoId}`} className="text-xs text-primary hover:underline">
            Despacho {parada.numero}
          </Link>
        </div>
        <StatusBadge tone="destructive" label={ETIQUETA_NO_ENTREGADO[parada.alcance]} />
      </div>
      <MotivoNoEntregado parada={parada} />
    </div>
  );
}
