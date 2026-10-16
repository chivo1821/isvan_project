import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";

/** Props de accesibilidad para el control de un campo: el error y la ayuda
 * quedan asociados al input (aria-describedby), no solo pintados al lado. */
export function ariaCampo(id: string, error?: string, ayuda?: string) {
  // Igual que <Campo>: con error se muestra el error en lugar de la ayuda.
  const describe = error ? `${id}-error` : ayuda ? `${id}-ayuda` : "";
  return { id, "aria-invalid": error ? true : undefined, "aria-describedby": describe || undefined };
}

/** Etiqueta visible + control + ayuda + error junto al campo. */
export function Campo({
  id,
  label,
  error,
  ayuda,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  ayuda?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {ayuda && !error && (
        <p id={`${id}-ayuda`} className="text-xs text-muted-foreground">
          {ayuda}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
