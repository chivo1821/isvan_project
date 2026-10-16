import { redirect } from "next/navigation";

// Sin listado propio: los documentos se ven desde la ficha de cada cliente.
// Existe para que la miga "Documentos" del detalle no lleve a un 404.
export default function DocumentosPage() {
  redirect("/cobranzas/clientes");
}
