import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { PagoCard } from "@/components/modules/cobranzas/pago-card";
import { apiGet } from "@/lib/api-client";
import type { Pago } from "@/lib/cobranzas";
import { cn } from "@/lib/utils";

const ESTADOS = [
  { valor: "REPORTADO", label: "Por verificar" },
  { valor: "VERIFICADO", label: "Verificados" },
  { valor: "RECHAZADO", label: "Rechazados" },
  { valor: "TODOS", label: "Todos" },
] as const;

export default async function CobranzasPagosPage({ searchParams }: PageProps<"/cobranzas/pagos">) {
  const params = await searchParams;
  const estado = ESTADOS.find((e) => e.valor === params.estado)?.valor ?? "REPORTADO";
  const pagos = await apiGet<Pago[]>(`/cobranzas/pagos?estado=${estado}`);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pagos de clientes"
        subtitle="Busca cada pago en el banco con su referencia, fecha y monto, y verifícalo o recházalo. Al verificarlo se descuenta del saldo del cliente."
        helpText="El monto en USD lo calcula el sistema con la tasa BCV vigente en la fecha del pago. Los pagos que se registran a mano (efectivo, divisas, retenciones) se cargan desde el detalle de cada cliente."
      />
      <nav aria-label="Estado de los pagos" className="flex flex-wrap gap-2">
        {ESTADOS.map((e) => (
          <Link
            key={e.valor}
            href={`/cobranzas/pagos?estado=${e.valor}`}
            aria-current={estado === e.valor ? "page" : undefined}
            className={cn(
              "inline-flex min-h-9 items-center rounded-full border px-3 text-sm transition-colors",
              estado === e.valor ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:bg-muted"
            )}
          >
            {e.label}
          </Link>
        ))}
      </nav>
      {pagos.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {estado === "REPORTADO" ? "No hay pagos esperando verificación." : "No hay pagos en esta lista."}
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-3">
          {pagos.map((p) => (
            <li key={p.id}>
              <PagoCard pago={p} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
