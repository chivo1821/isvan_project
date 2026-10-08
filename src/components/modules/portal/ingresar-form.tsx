"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { LogInIcon } from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { ApiError, apiPost, mensajeDeError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Campo, ariaCampo } from "@/components/modules/portal/campo";

const esquema = z.object({
  email: z.email("Escribe un correo válido"),
  password: z.string().min(1, "Escribe tu contraseña"),
});
type Valores = z.infer<typeof esquema>;

export function IngresarForm() {
  const claveNueva = useSearchParams().get("clave") === "nueva";
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<Valores>({ resolver: zodResolver(esquema), defaultValues: { email: "", password: "" } });

  async function entrar(valores: Valores) {
    setError(null);
    try {
      await apiPost("/portal/auth/login", valores);
    } catch (err) {
      // La clave era correcta pero el correo nunca se confirmó: a confirmarlo.
      if (err instanceof ApiError && err.status === 403 && err.detalle === "CORREO_SIN_CONFIRMAR") {
        window.location.assign(`/portal/confirmar?email=${encodeURIComponent(getValues("email").trim().toLowerCase())}`);
        return;
      }
      setError(mensajeDeError(err, "No se pudo iniciar sesión"));
      return;
    }
    // Carga completa: la cookie nueva tiene que llegar al layout del portal.
    window.location.assign("/portal");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1>Ingresar</h1>
        </CardTitle>
        <CardDescription>Con el correo y la contraseña de tu cuenta del portal.</CardDescription>
      </CardHeader>
      <CardContent>
        {claveNueva && (
          <p role="status" className="mb-4 rounded-md bg-success/10 px-3 py-2 text-sm text-success">
            Contraseña actualizada. Ya puedes ingresar con la nueva.
          </p>
        )}
        <form onSubmit={handleSubmit(entrar)} className="space-y-4" noValidate>
          <Campo id="email" label="Correo" error={errors.email?.message}>
            <Input
              type="email"
              autoComplete="email"
              inputMode="email"
              {...ariaCampo("email", errors.email?.message)}
              {...register("email")}
            />
          </Campo>
          <Campo id="password" label="Contraseña" error={errors.password?.message}>
            <Input type="password" autoComplete="current-password" {...ariaCampo("password", errors.password?.message)} {...register("password")} />
          </Campo>
          {error && (
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={isSubmitting}>
            <LogInIcon aria-hidden />
            {isSubmitting ? "Ingresando..." : "Ingresar"}
          </Button>
        </form>
      </CardContent>
      <CardFooter className="flex flex-col gap-2 text-sm">
        <Link href="/portal/recuperar" className="text-primary underline-offset-4 hover:underline">
          Olvidé mi contraseña
        </Link>
        <p className="text-muted-foreground">
          ¿Primera vez?{" "}
          <Link href="/portal/registro" className="font-medium text-primary underline-offset-4 hover:underline">
            Crea tu cuenta
          </Link>
        </p>
      </CardFooter>
    </Card>
  );
}
