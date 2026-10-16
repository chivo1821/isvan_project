"use client";

import { useState } from "react";
import Link from "next/link";
import { zodResolver } from "@hookform/resolvers/zod";
import { UserPlusIcon } from "lucide-react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { apiPost, mensajeDeError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Campo, ariaCampo } from "@/components/modules/portal/campo";
import { CedulaRif, TelefonoVe } from "@/components/shared/campos-venezuela";

const NO_SE = "__no_se";

// Las mismas reglas que la API (backend/app/schemas.py, RegistroPortalRequest):
// aquí solo para avisar antes de enviar.
const esquema = z
  .object({
    nombre: z.string().trim().min(2, "Escribe tu nombre o el de tu negocio").max(120),
    rif: z.string().regex(/^[VEJGPC]\d{6,9}$/, "Elige el tipo y escribe el número de tu cédula o RIF"),
    telefono: z.string().regex(/^04(12|14|16|22|24|26)\d{7}$/, "Elige el prefijo y escribe los 7 números"),
    email: z.email("Escribe un correo válido"),
    password: z
      .string()
      .min(8, "Al menos 8 caracteres")
      .refine((v) => /\d/.test(v) && /\D/.test(v), "Combina letras y números"),
    confirmar: z.string(),
    empresa: z.string(),
    codigoCliente: z.string().trim().max(20).regex(/^[A-Za-z0-9-]*$/, "Solo letras, números o guiones"),
  })
  .refine((v) => v.password === v.confirmar, { path: ["confirmar"], message: "Las contraseñas no coinciden" });
type Valores = z.infer<typeof esquema>;

export function RegistroForm() {
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Valores>({
    resolver: zodResolver(esquema),
    defaultValues: { nombre: "", rif: "", telefono: "", email: "", password: "", confirmar: "", empresa: NO_SE, codigoCliente: "" },
  });

  async function registrar(valores: Valores) {
    setError(null);
    const email = valores.email.trim().toLowerCase();
    const { empresa, codigoCliente } = valores;
    try {
      await apiPost("/portal/auth/registro", {
        nombre: valores.nombre,
        rif: valores.rif,
        telefono: valores.telefono,
        password: valores.password,
        email,
        empresa: empresa === NO_SE ? null : empresa,
        codigoCliente: codigoCliente || null,
      });
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo crear la cuenta"));
      return;
    }
    window.location.assign(`/portal/confirmar?email=${encodeURIComponent(email)}`);
  }

  const e = (campo: keyof Valores) => errors[campo]?.message;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1>Crear cuenta</h1>
        </CardTitle>
        <CardDescription>
          Te enviaremos un código a tu correo para confirmarlo. Si tu correo ya está registrado con nosotros, la cuenta
          queda lista al confirmar; si no, la valida nuestro equipo de cobranzas.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(registrar)} className="space-y-4" noValidate>
          <Campo id="nombre" label="Nombre o razón social" error={e("nombre")}>
            <Input autoComplete="organization" maxLength={120} {...ariaCampo("nombre", e("nombre"))} {...register("nombre")} />
          </Campo>
          <Campo id="rif" label="Cédula o RIF" error={e("rif")}>
            <Controller
              control={control}
              name="rif"
              render={({ field }) => (
                <CedulaRif id="rif" value={field.value} onChange={field.onChange} invalido={Boolean(e("rif"))} describedBy={e("rif") ? "rif-error" : undefined} />
              )}
            />
          </Campo>
          <Campo id="telefono" label="Celular" error={e("telefono")}>
            <Controller
              control={control}
              name="telefono"
              render={({ field }) => (
                <TelefonoVe
                  id="telefono"
                  value={field.value}
                  onChange={field.onChange}
                  invalido={Boolean(e("telefono"))}
                  describedBy={e("telefono") ? "telefono-error" : undefined}
                />
              )}
            />
          </Campo>
          <Campo id="email" label="Correo" error={e("email")}>
            <Input type="email" inputMode="email" autoComplete="email" maxLength={200} {...ariaCampo("email", e("email"))} {...register("email")} />
          </Campo>
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo id="password" label="Contraseña" error={e("password")} ayuda="8 caracteres o más, con letras y números">
              <Input
                type="password"
                autoComplete="new-password"
                {...ariaCampo("password", e("password"), "8 caracteres o más, con letras y números")}
                {...register("password")}
              />
            </Campo>
            <Campo id="confirmar" label="Repite la contraseña" error={e("confirmar")}>
              <Input type="password" autoComplete="new-password" {...ariaCampo("confirmar", e("confirmar"))} {...register("confirmar")} />
            </Campo>
          </div>

          <fieldset className="space-y-3 rounded-lg border border-border p-3">
            <legend className="px-1 text-sm font-medium">Tus datos de cliente (opcional)</legend>
            <p className="text-xs text-muted-foreground">
              Si los conoces, nos ayudan a validar tu cuenta más rápido. Aparecen en tus facturas.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo id="empresa" label="Empresa">
                <Controller
                  control={control}
                  name="empresa"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id="empresa" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NO_SE}>No lo sé</SelectItem>
                        <SelectItem value="ISVAN">ISVAN</SelectItem>
                        <SelectItem value="TRALOG">TRALOG</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
              </Campo>
              <Campo id="codigoCliente" label="Código de cliente" error={e("codigoCliente")}>
                <Input inputMode="numeric" maxLength={20} {...ariaCampo("codigoCliente", e("codigoCliente"))} {...register("codigoCliente")} />
              </Campo>
            </div>
          </fieldset>

          {error && (
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={isSubmitting}>
            <UserPlusIcon aria-hidden />
            {isSubmitting ? "Creando cuenta..." : "Crear cuenta"}
          </Button>
        </form>
      </CardContent>
      <CardFooter className="text-sm text-muted-foreground">
        ¿Ya tienes cuenta?{" "}
        <Link href="/portal/ingresar" className="ml-1 font-medium text-primary underline-offset-4 hover:underline">
          Ingresa
        </Link>
      </CardFooter>
    </Card>
  );
}
