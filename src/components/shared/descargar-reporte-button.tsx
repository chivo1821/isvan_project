import { DownloadIcon } from "lucide-react";
import { API_URL } from "@/lib/api-client";
import { Button } from "@/components/ui/button";

/** Descarga un reporte en Excel (ver backend/app/api/reportes.py).
 *
 * Es un enlace normal, no un fetch: la navegación del navegador manda la
 * cookie de sesión sola y deja que el archivo se guarde con el nombre que
 * pone el backend, sin tener que armar un blob a mano. */
export function DescargarReporteButton({
  reporte,
  query,
  children = "Descargar Excel",
}: {
  /** Nombre del archivo en la API, p. ej. "clientes" -> /reportes/clientes.xlsx */
  reporte: "clientes" | "despachos" | "rutas" | "delivery";
  /** Parámetros del reporte, p. ej. el período del pago de delivery. */
  query?: string;
  children?: React.ReactNode;
}) {
  return (
    <Button asChild variant="outline">
      <a href={`${API_URL}/reportes/${reporte}.xlsx${query ? `?${query}` : ""}`}>
        <DownloadIcon />
        {children}
      </a>
    </Button>
  );
}
