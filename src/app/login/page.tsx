import { Suspense } from "react";
import { IceCreamConeIcon } from "lucide-react";
import { LoginForm } from "@/components/modules/auth/login-form";
import { Skeleton } from "@/components/ui/skeleton";

// LoginForm usa useSearchParams() (para volver a "?from=" tras iniciar
// sesion) — en el build de produccion, Next.js exige que cualquier
// componente que lo use este envuelto en Suspense, o falla el prerender
// estatico de la pagina (ver https://nextjs.org/docs/messages/missing-suspense-with-csr-bailout).
function LoginFormSkeleton() {
  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-6">
      <Skeleton className="h-5 w-32" />
      <Skeleton className="h-4 w-48" />
      <Skeleton className="mt-3 h-9 w-full" />
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-9 w-full" />
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <span className="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <IceCreamConeIcon className="size-5" />
          </span>
          <div>
            <h1 className="text-lg font-semibold text-foreground">Gestión Logística</h1>
            <p className="text-sm text-muted-foreground">Helados &amp; Pizzas — ISVAN / TRALOG</p>
          </div>
        </div>
        <Suspense fallback={<LoginFormSkeleton />}>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}
