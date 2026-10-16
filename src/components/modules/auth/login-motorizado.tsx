"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { BikeIcon, LogInIcon, UserPlusIcon } from "lucide-react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { ApiError, apiPost } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { INICIO_POR_ROL } from "@/lib/constants";

// Los mismos formatos que valida la API (backend/app/services/motorizados.py).
// Prefijos móviles vigentes en Venezuela: Digitel 0412 y 0422, Movistar
// 0414 y 0424, Movilnet 0416 y 0426.
const PREFIJOS = ["0412", "0414", "0416", "0422", "0424", "0426"] as const;

const normalizarPlaca = (placa: string) => placa.replace(/[\s.-]/g, "").toUpperCase();

const placa = z
  .string()
  .transform(normalizarPlaca)
  .pipe(z.string().regex(/^[A-Z0-9]{5,8}$/, "La placa tiene entre 5 y 8 letras o números"));

const pinSeguro = z
  .string()
  .regex(/^\d{6}$/, "El PIN tiene 6 números")
  .refine((pin) => {
    const pasos = new Set([...pin].slice(1).map((c, i) => Number(c) - Number(pin[i])));
    return !(pasos.size === 1 && [0, 1, -1].includes([...pasos][0]));
  }, "Muy fácil de adivinar: no uses números repetidos ni seguidos");

const entrarSchema = z.object({
  placa,
  pin: z.string().regex(/^\d{6}$/, "El PIN tiene 6 números"),
});

const registroSchema = z
  .object({
    codigoRegistro: z.string().trim().min(1, "Pide el código a la empresa"),
    nombre: z.string().trim().min(3, "Escribe tu nombre y apellido"),
    placa,
    prefijo: z.enum(PREFIJOS, "Elige el prefijo"),
    numero: z.string().regex(/^\d{7}$/, "Son 7 números después del prefijo"),
    pin: pinSeguro,
    pinConfirmado: z.string(),
  })
  .refine((v) => v.pin === v.pinConfirmado, { message: "Los PIN no coinciden", path: ["pinConfirmado"] });

type EntrarValues = z.input<typeof entrarSchema>;
type RegistroValues = z.input<typeof registroSchema>;

/** El mensaje de la API para el motorizado: el detalle, o el primer error
 * de validación de un campo (FastAPI los manda como lista). */
function mensajeApi(err: unknown, respaldo: string): string {
  if (err instanceof ApiError) {
    if (err.detalle) return err.detalle;
    if (Array.isArray(err.datos) && err.datos[0]?.msg) return String(err.datos[0].msg).replace(/^Value error, /, "");
  }
  return respaldo;
}

function ErrorCampo({ texto }: { texto?: string }) {
  return texto ? <p className="text-xs text-destructive">{texto}</p> : null;
}

/** Entrada de los motorizados: placa de su moto + PIN de 6 números, o
 * registrarse solos la primera vez (con el código de la empresa). */
export function LoginMotorizado() {
  const [modo, setModo] = useState<"entrar" | "registro">("entrar");
  const [error, setError] = useState<string | null>(null);

  const entrar = useForm<EntrarValues>({ resolver: zodResolver(entrarSchema), defaultValues: { placa: "", pin: "" } });
  const registro = useForm<RegistroValues>({
    resolver: zodResolver(registroSchema),
    defaultValues: { codigoRegistro: "", nombre: "", placa: "", numero: "", pin: "", pinConfirmado: "" },
  });

  function cambiarModo(nuevo: "entrar" | "registro") {
    setError(null);
    setModo(nuevo);
  }

  async function onEntrar(values: EntrarValues) {
    setError(null);
    try {
      await apiPost("/auth/motorizado/login", { placa: normalizarPlaca(values.placa), pin: values.pin });
    } catch (e) {
      setError(mensajeApi(e, "No se pudo entrar. Revisa tu conexión e inténtalo de nuevo."));
      return;
    }
    // Carga completa (como el login normal): la sesión nueva tiene que
    // llegar al layout desde la primera request.
    window.location.assign(INICIO_POR_ROL.REPARTIDOR);
  }

  async function onRegistro(values: RegistroValues) {
    setError(null);
    try {
      await apiPost("/auth/motorizado/registro", {
        codigoRegistro: values.codigoRegistro.trim(),
        nombre: values.nombre.trim(),
        placa: normalizarPlaca(values.placa),
        telefono: `${values.prefijo}${values.numero}`,
        pin: values.pin,
      });
    } catch (e) {
      setError(mensajeApi(e, "No se pudo completar el registro. Inténtalo de nuevo."));
      return;
    }
    window.location.assign(INICIO_POR_ROL.REPARTIDOR);
  }

  if (modo === "entrar") {
    const { register, handleSubmit, formState } = entrar;
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BikeIcon className="size-5" aria-hidden />
            Soy motorizado
          </CardTitle>
          <CardDescription>Entra con la placa de tu moto y tu PIN de 6 números.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onEntrar)} className="space-y-3" noValidate>
            <div className="space-y-1.5">
              <Label htmlFor="moto-placa">Placa de tu moto</Label>
              <Input
                id="moto-placa"
                autoComplete="username"
                autoCapitalize="characters"
                placeholder="AB123CD"
                className="h-11 uppercase"
                {...register("placa")}
              />
              <ErrorCampo texto={formState.errors.placa?.message} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="moto-pin">PIN</Label>
              <Input
                id="moto-pin"
                type="password"
                inputMode="numeric"
                autoComplete="current-password"
                maxLength={6}
                className="h-11 tracking-[0.3em]"
                {...register("pin")}
              />
              <ErrorCampo texto={formState.errors.pin?.message} />
            </div>
            {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
            <Button type="submit" className="h-11 w-full" disabled={formState.isSubmitting}>
              <LogInIcon />
              {formState.isSubmitting ? "Entrando..." : "Entrar"}
            </Button>
            <Button type="button" variant="outline" className="h-11 w-full" onClick={() => cambiarModo("registro")}>
              <UserPlusIcon />
              Es mi primera vez: registrarme
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              ¿Olvidaste tu PIN? Pídele al administrador que te dé uno nuevo.
            </p>
          </form>
        </CardContent>
      </Card>
    );
  }

  const { register, handleSubmit, control, formState } = registro;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserPlusIcon className="size-5" aria-hidden />
          Registro de motorizado
        </CardTitle>
        <CardDescription>
          Solo la primera vez. Necesitas el código de registro que te da la empresa.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onRegistro)} className="space-y-3" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="reg-codigo">Código de registro de la empresa</Label>
            <Input id="reg-codigo" autoComplete="off" autoCapitalize="characters" className="h-11" {...register("codigoRegistro")} />
            <ErrorCampo texto={formState.errors.codigoRegistro?.message} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="reg-nombre">Nombre y apellido</Label>
            <Input id="reg-nombre" autoComplete="name" className="h-11" {...register("nombre")} />
            <ErrorCampo texto={formState.errors.nombre?.message} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="reg-placa">Placa de tu moto</Label>
            <Input
              id="reg-placa"
              autoComplete="off"
              autoCapitalize="characters"
              placeholder="AB123CD"
              className="h-11 uppercase"
              {...register("placa")}
            />
            <ErrorCampo texto={formState.errors.placa?.message} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="reg-numero">Teléfono celular</Label>
            <div className="flex gap-2">
              <Controller
                control={control}
                name="prefijo"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger className="h-11 w-28" aria-label="Prefijo del teléfono">
                      <SelectValue placeholder="0414" />
                    </SelectTrigger>
                    <SelectContent>
                      {PREFIJOS.map((p) => (
                        <SelectItem key={p} value={p}>
                          {p}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              <Input
                id="reg-numero"
                type="tel"
                inputMode="numeric"
                autoComplete="tel-local"
                placeholder="1234567"
                maxLength={7}
                className="h-11 flex-1"
                {...register("numero")}
              />
            </div>
            <ErrorCampo texto={formState.errors.prefijo?.message ?? formState.errors.numero?.message} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="reg-pin">Crea tu PIN</Label>
              <Input
                id="reg-pin"
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                maxLength={6}
                className="h-11 tracking-[0.3em]"
                {...register("pin")}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reg-pin2">Repítelo</Label>
              <Input
                id="reg-pin2"
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                maxLength={6}
                className="h-11 tracking-[0.3em]"
                {...register("pinConfirmado")}
              />
            </div>
          </div>
          <ErrorCampo texto={formState.errors.pin?.message ?? formState.errors.pinConfirmado?.message} />
          <p className="text-xs text-muted-foreground">
            6 números, sin repetidos ni seguidos (no 111111 ni 123456). Guárdalo: con tu placa y este PIN entras cada día.
          </p>
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          <Button type="submit" className="h-11 w-full" disabled={formState.isSubmitting}>
            <UserPlusIcon />
            {formState.isSubmitting ? "Registrando..." : "Registrarme y entrar"}
          </Button>
          <Button type="button" variant="ghost" className="w-full" onClick={() => cambiarModo("entrar")}>
            Ya estoy registrado: entrar
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
