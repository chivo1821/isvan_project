import { PageHeader } from "@/components/layout/page-header";
import { AvisoTasa, ModuloApagado, SelectorEmpresa } from "@/components/modules/administrativo/comunes";
import { DocumentosTabla } from "@/components/modules/administrativo/documentos";
import { apiGet } from "@/lib/api-client";
import { empresaElegida, type DocumentoResumen, type EmpresaFiscal, type EstadoTasa, type SearchParams } from "@/lib/administrativo";

export default async function DocumentosPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const empresas = await apiGet<EmpresaFiscal[]>("/empresas");
  const empresa = empresaElegida(empresas, await searchParams);
  if (!empresa) return null;
  const encabezado = (
    <PageHeader
      title="Documentos de venta"
      subtitle="Facturas, notas de entrega y notas de crédito y débito. Se emiten con la imprenta digital; emitidas no se editan."
      actions={<SelectorEmpresa empresas={empresas} actual={empresa.id} />}
    />
  );
  if (!empresa.modulos.ventas) {
    return <div className="space-y-6">{encabezado}<ModuloApagado modulo="ventas" empresa={empresa} /></div>;
  }
  const [documentos, tasa] = await Promise.all([
    apiGet<DocumentoResumen[]>(`/ventas/documentos?empresaId=${empresa.id}`),
    apiGet<EstadoTasa>("/tasa/estado"),
  ]);
  return (
    <div className="space-y-6">
      {encabezado}
      <AvisoTasa tasa={tasa} />
      <DocumentosTabla documentos={documentos} />
    </div>
  );
}
