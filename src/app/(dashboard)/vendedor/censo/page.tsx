import { ClipboardListIcon } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { FormularioCenso } from "@/components/modules/censo/formulario-censo";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiGet } from "@/lib/api-client";
import type { MiCenso } from "@/lib/censo";
import { formatDateTime } from "@/lib/constants";
import type { DefinicionFormulario } from "@/lib/formulario/motor";
import { getUsuarioActual } from "@/lib/session";

/** El censo de clientes, como se llenaba en Survey123: la definición sale
 * del XLSForm (backend/app/formularios/censo.json). */
export default async function CensoVendedorPage() {
  const [definicion, mios, usuario] = await Promise.all([
    apiGet<DefinicionFormulario>("/censo/formulario"),
    apiGet<MiCenso[]>("/censo/mios"),
    getUsuarioActual(),
  ]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title={definicion.title}
        subtitle="Registro de clientes nuevos y existentes. Los campos con * son obligatorios."
      />

      <FormularioCenso definicion={definicion} nombreUsuario={usuario?.nombre ?? ""} />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ClipboardListIcon className="size-4" /> Tus últimos censos
          </CardTitle>
        </CardHeader>
        <CardContent>
          {mios.length === 0 ? (
            <p className="text-sm text-muted-foreground">Todavía no has enviado ningún censo.</p>
          ) : (
            <ul className="divide-y text-sm">
              {mios.map((c) => (
                <li key={c.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2">
                  <span className="font-medium">{c.nombreComercio ?? "Sin nombre"}</span>
                  <span className="text-muted-foreground">
                    {[c.tipoCliente, c.empresa, `${c.fotos} foto${c.fotos === 1 ? "" : "s"}`].filter(Boolean).join(" · ")}
                    {" · "}
                    {formatDateTime(c.recibidoEn)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
