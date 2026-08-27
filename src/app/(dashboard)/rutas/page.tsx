import Link from "next/link";
import { PlusIcon } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { RutasTable } from "@/components/modules/rutas/rutas-table";
import { getRutasConDetalle } from "@/lib/mock-data";
import { getUsuarioActual } from "@/lib/session";

export default async function RutasPage() {
  const [rutasSinOrdenar, usuarioActual] = await Promise.all([getRutasConDetalle(), getUsuarioActual()]);
  const rutas = rutasSinOrdenar.sort((a, b) => (a.fechaCreacion < b.fechaCreacion ? 1 : -1));
  const puedeCrear = usuarioActual?.rol === "ADMIN" || usuarioActual?.rol === "DESPACHOS";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Rutas"
        subtitle="Viajes multi-parada, desde Almacén Catia"
        actions={
          puedeCrear ? (
            <Button asChild>
              <Link href="/rutas/nueva">
                <PlusIcon />
                Nueva ruta
              </Link>
            </Button>
          ) : undefined
        }
      />
      <RutasTable rutas={rutas} />
    </div>
  );
}
