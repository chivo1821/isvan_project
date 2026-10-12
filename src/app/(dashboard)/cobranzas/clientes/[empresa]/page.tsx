import { redirect } from "next/navigation";

// La miga de la empresa en la ficha de un cliente: el listado filtrado.
export default async function ClientesEmpresaPage({ params }: PageProps<"/cobranzas/clientes/[empresa]">) {
  const { empresa } = await params;
  redirect(["ISVAN", "TRALOG"].includes(empresa) ? `/cobranzas/clientes?empresa=${empresa}` : "/cobranzas/clientes");
}
