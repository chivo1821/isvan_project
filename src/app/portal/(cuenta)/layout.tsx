import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ClockIcon, IceCreamConeIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PortalNav } from "@/components/modules/portal/portal-nav";
import { SalirButton } from "@/components/modules/portal/salir-button";
import { getCuentaPortal } from "@/lib/portal";

export const metadata: Metadata = {
  title: "Portal de clientes — ISVAN / TRALOG",
  description: "Tu estado de cuenta, tus documentos pendientes y el reporte de tus pagos.",
};

/** El portal de un cliente con sesión. La API valida todo de nuevo: esto es
 * solo la puerta de la interfaz (ver backend/app/core/portal_auth.py). */
export default async function CuentaPortalLayout({ children }: LayoutProps<"/portal">) {
  const cuenta = await getCuentaPortal();
  if (!cuenta) redirect("/portal/ingresar");
  const activa = cuenta.estado === "ACTIVA" && cuenta.clientes.length > 0;

  return (
    <div className="min-h-screen w-full bg-background">
      <header className="border-b border-border bg-card print:hidden">
        <div className="mx-auto flex max-w-5xl flex-col gap-3 px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <Link href="/portal" className="flex min-w-0 items-center gap-2">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <IceCreamConeIcon className="size-4" aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-foreground">Portal de clientes</span>
                <span className="block truncate text-xs text-muted-foreground">{cuenta.nombre}</span>
              </span>
            </Link>
            <SalirButton />
          </div>
          {activa && <PortalNav />}
        </div>
      </header>
      <main className="mx-auto max-w-5xl space-y-6 px-4 py-6">
        {activa ? (
          children
        ) : (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
              <span className="flex size-12 items-center justify-center rounded-full bg-warning/10 text-warning">
                <ClockIcon className="size-6" aria-hidden />
              </span>
              <h1 className="text-xl font-semibold">Tu cuenta está en validación</h1>
              <p className="max-w-md text-sm text-muted-foreground">
                Confirmaste tu correo ({cuenta.email}). Nuestro equipo de cobranzas está verificando a qué cliente
                corresponde tu cuenta; te avisaremos por correo cuando esté lista para ver tu estado de cuenta y
                reportar pagos.
              </p>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
