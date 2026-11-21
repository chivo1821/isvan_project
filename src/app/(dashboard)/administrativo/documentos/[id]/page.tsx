import Link from "@/components/shared/enlace";
import { ArrowLeftIcon } from "lucide-react";
import { DocumentoVista } from "@/components/modules/administrativo/documentos";
import { Button } from "@/components/ui/button";
import { apiGet } from "@/lib/api-client";
import { TIPO_DOCUMENTO, type DocumentoDetalle } from "@/lib/administrativo";

export default async function DocumentoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const doc = await apiGet<DocumentoDetalle>(`/ventas/documentos/${id}`);
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 print:hidden">
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/administrativo/documentos?empresa=${doc.empresaId}`}><ArrowLeftIcon />Documentos</Link>
        </Button>
        <h1 className="text-xl font-semibold">{TIPO_DOCUMENTO[doc.tipo]} {doc.numero ?? ""}</h1>
      </div>
      <DocumentoVista doc={doc} />
    </div>
  );
}
