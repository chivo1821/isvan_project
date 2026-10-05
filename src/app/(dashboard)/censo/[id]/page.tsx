import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { DetalleDeCenso } from "@/components/modules/censo/detalle-censo";
import { Button } from "@/components/ui/button";
import { apiGet } from "@/lib/api-client";
import type { DetalleCenso } from "@/lib/censo";
import { formatDateTime } from "@/lib/constants";
import type { DefinicionFormulario } from "@/lib/formulario/motor";

export default async function CensoDetallePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [censo, definicion] = await Promise.all([
    apiGet<DetalleCenso>(`/censo/${encodeURIComponent(id)}`),
    apiGet<DefinicionFormulario>("/censo/formulario"),
  ]);
  return (
    <div className="space-y-6">
      <PageHeader
        title={censo.nombreComercio ?? "Censo sin nombre"}
        subtitle={`Enviado por ${censo.usuario} el ${formatDateTime(censo.recibidoEn)}`}
        actions={
          <Button variant="outline" asChild>
            <Link href="/censo">
              <ArrowLeftIcon /> Censos
            </Link>
          </Button>
        }
      />
      <DetalleDeCenso censo={censo} definicion={definicion} />
    </div>
  );
}
