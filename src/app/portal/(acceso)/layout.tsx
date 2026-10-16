import type { Metadata } from "next";
import { IceCreamConeIcon } from "lucide-react";

export const metadata: Metadata = {
  title: "Portal de clientes — ISVAN / TRALOG",
  description: "Consulta tu estado de cuenta y reporta tus pagos.",
};

/** Ingreso, registro, confirmación del correo y recuperación de la clave del
 * portal de clientes: una tarjeta centrada, como el login interno. */
export default function AccesoPortalLayout({ children }: LayoutProps<"/portal">) {
  return (
    <main className="flex min-h-screen w-full items-center justify-center bg-muted/40 px-4 py-10">
      <div className="w-full max-w-md space-y-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <span className="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <IceCreamConeIcon className="size-5" aria-hidden />
          </span>
          <div>
            <p className="text-lg font-semibold text-foreground">Portal de clientes</p>
            <p className="text-sm text-muted-foreground">ISVAN / TRALOG — estado de cuenta y pagos</p>
          </div>
        </div>
        {children}
      </div>
    </main>
  );
}
