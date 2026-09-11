"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { LogInIcon } from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { apiPost } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { INICIO_POR_ROL } from "@/lib/constants";
import type { RolUsuario, Usuario } from "@/lib/mock-data";

const loginSchema = z.object({
  email: z.email("Ingresa un email válido"),
  password: z.string().min(1, "Ingresa tu contraseña"),
});

type LoginValues = z.infer<typeof loginSchema>;

/** A dónde entra cada quien al iniciar sesión: directo a su módulo. Antes
 * todos pasaban por "/" (el dashboard, solo ADMIN) y el layout los
 * redirigía; pero Next renderiza la página junto con el layout, así que un
 * VENDEDOR disparaba las consultas del dashboard, que la API le rechaza, y la
 * pantalla se colgaba. "?from=" se respeta solo si ese rol puede estar ahí. */
function destinoTrasLogin(rol: RolUsuario, from: string | null) {
  const inicio = INICIO_POR_ROL[rol];
  if (!from || from === "/" || !from.startsWith("/")) return inicio;
  const moduloUnico = rol === "REPARTIDOR" || rol === "VENDEDOR";
  return !moduloUnico || from.startsWith(inicio) ? from : inicio;
}

export function LoginForm() {
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  async function onSubmit(values: LoginValues) {
    setError(null);
    let usuario: Usuario;
    try {
      usuario = await apiPost<Usuario>("/auth/login", values);
    } catch {
      setError("Correo o contraseña incorrectos.");
      return;
    }
    // Carga completa, no router.push: la sesión recién creada tiene que
    // llegar al layout del dashboard desde la primera request. Con push +
    // refresh la navegación podía quedarse a medias hasta recargar con F5.
    window.location.assign(destinoTrasLogin(usuario.rol, searchParams.get("from")));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Iniciar sesión</CardTitle>
        <CardDescription>Ingresa con tu correo y contraseña.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="email">Correo</Label>
            <Input id="email" type="email" placeholder="persona@empresa.com" autoComplete="username" {...register("email")} />
            {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Contraseña</Label>
            <Input id="password" type="password" autoComplete="current-password" {...register("password")} />
            {errors.password && <p className="text-xs text-destructive">{errors.password.message}</p>}
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={isSubmitting}>
            <LogInIcon />
            {isSubmitting ? "Ingresando..." : "Ingresar"}
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            ¿Olvidaste tu contraseña? Pídele a un administrador que te la restablezca desde Usuarios.
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
