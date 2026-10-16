import { PageHeader } from "@/components/layout/page-header";
import { DescargarReporteButton } from "@/components/shared/descargar-reporte-button";
import { ClientesVistas } from "@/components/modules/clientes/clientes-vistas";
import { apiGet } from "@/lib/api-client";
import type { ConteoCorreccion } from "@/lib/censo";
import { getClientesRaw } from "@/lib/mock-data";
import { getUsuarioActual } from "@/lib/session";

export default async function ClientesPage() {
  const [clientes, usuarioActual] = await Promise.all([getClientesRaw(), getUsuarioActual()]);
  const puedeCrear = usuarioActual?.rol === "ADMIN" || usuarioActual?.rol === "DESPACHOS";
  // Quien crea clientes corrige tambien los censos que no pudieron crear el
  // suyo. Si la consulta falla, la pagina sigue sin esa pestaña.
  const conteoCensos = puedeCrear
    ? await apiGet<{ conteo: ConteoCorreccion }>("/clientes/censo-pendientes?solo_conteo=true")
        .then((r) => r.conteo)
        .catch(() => null)
    : null;
  // Los reportes son información de gestión: el repartidor no los descarga
  // (la API también se lo niega, ver backend/app/api/reportes.py).
  const puedeDescargar = usuarioActual != null && usuarioActual.rol !== "REPARTIDOR";
  return (
    <div className="space-y-6">
      <PageHeader
        title="Clientes"
        subtitle="Cartera de clientes de ISVAN y TRALOG"
        helpText="El mismo código puede pertenecer a un cliente distinto según la empresa — por eso cada cliente muestra su empresa junto al código. Se necesitan coordenadas para poder incluir a un cliente en una ruta."
        actions={puedeDescargar ? <DescargarReporteButton reporte="clientes" /> : undefined}
      />
      <ClientesVistas
        clientes={clientes}
        puedeCrear={puedeCrear}
        conteoCensos={conteoCensos}
        esAdmin={usuarioActual?.rol === "ADMIN"}
      />
    </div>
  );
}
