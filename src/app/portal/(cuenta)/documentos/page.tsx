import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { DocumentosTabla } from "@/components/modules/portal/documentos-tabla";
import { apiGet } from "@/lib/api-client";
import { claveCliente, type Documento } from "@/lib/cobranzas";
import { getCuentaActiva } from "@/lib/portal";
import { cn } from "@/lib/utils";

function Filtro({ href, activo, children }: { href: string; activo: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={activo ? "page" : undefined}
      className={cn(
        "inline-flex min-h-9 items-center rounded-full border px-3 text-sm transition-colors",
        activo ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:bg-muted"
      )}
    >
      {children}
    </Link>
  );
}

export default async function PortalDocumentosPage({ searchParams }: PageProps<"/portal/documentos">) {
  const cuenta = await getCuentaActiva();
  if (!cuenta) return null;
  const params = await searchParams;
  const estado = params.estado === "todos" ? "todos" : "pendientes";
  const cliente = typeof params.cliente === "string" ? params.cliente : "";
  const query = new URLSearchParams({ estado, ...(cliente ? { cliente } : {}) });
  const documentos = await apiGet<Documento[]>(`/portal/documentos?${query}`);
  const nombres = new Map(cuenta.clientes.map((c) => [claveCliente(c), c.nombre]));
  const enlace = (cambios: Record<string, string>) => {
    const q = new URLSearchParams({ estado, ...(cliente ? { cliente } : {}), ...cambios });
    if (!q.get("cliente")) q.delete("cliente");
    return `/portal/documentos?${q}`;
  };

  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold">Documentos</h1>
        <p className="text-sm text-muted-foreground">
          Tus facturas y notas de entrega. Las devoluciones y tus pagos verificados se abonan a las que vencen primero,
          salvo que al reportar un pago elijas a cuáles.
        </p>
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar documentos">
        <Filtro href={enlace({ estado: "pendientes" })} activo={estado === "pendientes"}>
          Por pagar
        </Filtro>
        <Filtro href={enlace({ estado: "todos" })} activo={estado === "todos"}>
          Todos
        </Filtro>
        {cuenta.clientes.length > 1 && (
          <>
            <span className="mx-1 w-px self-stretch bg-border" aria-hidden />
            <Filtro href={enlace({ cliente: "" })} activo={!cliente}>
              Todos los clientes
            </Filtro>
            {cuenta.clientes.map((c) => (
              <Filtro key={claveCliente(c)} href={enlace({ cliente: claveCliente(c) })} activo={cliente === claveCliente(c)}>
                {c.nombre} ({c.empresa})
              </Filtro>
            ))}
          </>
        )}
      </div>
      <Card>
        <CardContent>
          <DocumentosTabla
            documentos={documentos.map((d) => ({ ...d, nombreCliente: nombres.get(claveCliente(d)) }))}
            mostrarCliente={cuenta.clientes.length > 1 && !cliente}
            vacio={estado === "pendientes" ? "No tienes documentos por pagar." : "No hay documentos en tu cuenta."}
          />
        </CardContent>
      </Card>
    </>
  );
}
