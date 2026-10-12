"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { MailCheckIcon } from "lucide-react";
import { toast } from "sonner";
import { apiPost, mensajeDeError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Campo, ariaCampo } from "@/components/modules/portal/campo";

/** Segundos que pide la API entre un código y el siguiente. */
const ESPERA_REENVIO = 60;

/** Cuenta regresiva para "Reenviar código": arranca en 60 s porque el
 * código acaba de enviarse al registrarse o al pedirlo. */
function useCuentaRegresiva(inicial: number) {
  const [restante, setRestante] = useState(inicial);
  useEffect(() => {
    if (restante <= 0) return;
    const t = setTimeout(() => setRestante((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [restante]);
  return [restante, () => setRestante(ESPERA_REENVIO)] as const;
}

export function ConfirmarForm() {
  const params = useSearchParams();
  const [email, setEmail] = useState(params.get("email") ?? "");
  const [codigo, setCodigo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [restante, reiniciar] = useCuentaRegresiva(ESPERA_REENVIO);

  const codigoValido = /^\d{6}$/.test(codigo);

  async function confirmar(e: React.FormEvent) {
    e.preventDefault();
    if (!codigoValido || !email) {
      setError("Escribe tu correo y el código de 6 dígitos.");
      return;
    }
    setError(null);
    setEnviando(true);
    try {
      await apiPost("/portal/auth/confirmar", { email: email.trim().toLowerCase(), codigo });
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo confirmar el correo"));
      setEnviando(false);
      return;
    }
    window.location.assign("/portal");
  }

  async function reenviar() {
    if (!email) {
      setError("Escribe tu correo para enviarte otro código.");
      return;
    }
    try {
      await apiPost("/portal/auth/reenviar", { email: email.trim().toLowerCase() });
      toast.success("Si el correo está pendiente de confirmar, te enviamos un código nuevo.");
      reiniciar();
    } catch (err) {
      toast.error("No se pudo reenviar el código", { description: mensajeDeError(err, "Intenta más tarde") });
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1>Confirma tu correo</h1>
        </CardTitle>
        <CardDescription>
          Te enviamos un código de 6 dígitos. Vence en 15 minutos; si no lo ves, revisa la carpeta de spam.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={confirmar} className="space-y-4" noValidate>
          <Campo id="email" label="Correo">
            <Input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(ev) => setEmail(ev.target.value)}
              {...ariaCampo("email")}
            />
          </Campo>
          <Campo id="codigo" label="Código" ayuda="Puedes pegarlo desde el correo">
            <Input
              inputMode="numeric"
              autoComplete="one-time-code"
              className="text-center text-lg tracking-[0.5em] tabular-nums"
              value={codigo}
              onChange={(ev) => setCodigo(ev.target.value.replace(/\D/g, "").slice(0, 6))}
              {...ariaCampo("codigo", undefined, "Puedes pegarlo desde el correo")}
            />
          </Campo>
          {error && (
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={enviando || !codigoValido}>
            <MailCheckIcon aria-hidden />
            {enviando ? "Confirmando..." : "Confirmar"}
          </Button>
        </form>
      </CardContent>
      <CardFooter className="flex flex-col gap-2 text-sm">
        <Button type="button" variant="link" onClick={reenviar} disabled={restante > 0}>
          {restante > 0 ? `Reenviar código en ${restante} s` : "Reenviar código"}
        </Button>
        <Link href="/portal/ingresar" className="text-muted-foreground underline-offset-4 hover:underline">
          Volver a ingresar
        </Link>
      </CardFooter>
    </Card>
  );
}
