import { PageHeader } from "@/components/layout/page-header";
import { EmpresaForm } from "@/components/modules/administrativo/empresa-form";
import { apiGet } from "@/lib/api-client";
import type { EmpresaFiscal } from "@/lib/administrativo";

export default async function EmpresasPage() {
  const empresas = await apiGet<EmpresaFiscal[]>("/empresas");
  return (
    <div className="space-y-6">
      <PageHeader
        title="Empresas"
        subtitle="Datos fiscales de cada empresa y los módulos del sistema administrativo. Los módulos están apagados hasta encenderlos."
      />
      <div className="grid gap-6 xl:grid-cols-2">
        {empresas.map((e) => (
          <EmpresaForm key={e.id} empresa={e} />
        ))}
      </div>
    </div>
  );
}
