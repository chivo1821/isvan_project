"use client";

import { PrinterIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Imprimir o "Guardar como PDF" desde el diálogo del navegador: la página
 * tiene estilos de impresión (sin menús ni botones). */
export function ImprimirButton() {
  return (
    <Button variant="outline" onClick={() => window.print()}>
      <PrinterIcon aria-hidden />
      Imprimir o guardar PDF
    </Button>
  );
}
