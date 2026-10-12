import { Suspense } from "react";
import Link from "next/link";
import { IceCreamConeIcon, LogInIcon, UserPlusIcon } from "lucide-react";
import { LoginForm } from "@/components/modules/auth/login-form";
import { LoginMotorizado } from "@/components/modules/auth/login-motorizado";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

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
        {/* Tres puertas: el personal con correo y contraseña, los motorizados
            (alta rotación) con la placa de su moto y un PIN, y los clientes,
            que tienen su propio portal (/portal, otra sesión). */}
        <Tabs defaultValue="personal" className="gap-4">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="personal">Personal</TabsTrigger>
            <TabsTrigger value="motorizado">Soy motorizado</TabsTrigger>
            <TabsTrigger value="cliente">Soy cliente</TabsTrigger>
          </TabsList>
          <TabsContent value="personal">
            <Suspense fallback={<LoginFormSkeleton />}>
              <LoginForm />
            </Suspense>
          </TabsContent>
          <TabsContent value="motorizado">
            <LoginMotorizado />
          </TabsContent>
          <TabsContent value="cliente">
            <Card>
              <CardHeader>
                <CardTitle>Portal de clientes</CardTitle>
                <CardDescription>
                  Consulta tu estado de cuenta y tus facturas pendientes, y reporta tus pagos por pago móvil o
                  transferencia.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <Button asChild className="w-full">
                  <Link href="/portal/ingresar">
                    <LogInIcon aria-hidden />
                    Ingresar al portal
                  </Link>
                </Button>
                <Button asChild variant="outline" className="w-full">
                  <Link href="/portal/registro">
                    <UserPlusIcon aria-hidden />
                    Crear mi cuenta
                  </Link>
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
