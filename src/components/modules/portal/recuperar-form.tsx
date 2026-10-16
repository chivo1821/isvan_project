"use client";

import { useState } from "react";
import Link from "next/link";
import { KeyRoundIcon } from "lucide-react";
import { apiPost, mensajeDeError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Campo, ariaCampo } from "@/components/modules/portal/campo";

/** Recuperar la contraseña en dos pasos: pedir el código al correo y luego
 * escribirlo junto con la contraseña nueva. */
export function RecuperarForm() {
  const [paso, setPaso] = useState<"correo" | "clave">("correo");
  const [email, setEmail] = useState("");
  const [codigo, setCodigo] = useState("");
  const [clave, setClave] = useState("");
  const [repetir, setRepetir] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const errorClave =
    clave && (clave.length < 8 || !/\d/.test(clave) || !/\D/.test(clave))
      ? "8 caracteres o más, con letras y números"
      : undefined;
  const errorRepetir = repetir && repetir !== clave ? "Las contraseñas no coinciden" : undefined;

  async function pedirCodigo(e: React.FormEvent) {
    e.preventDefault();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
      setError("Escribe un correo válido.");
      return;
    }
    setError(null);
    setEnviando(true);
    try {
      await apiPost("/portal/auth/recuperar", { email: email.trim().toLowerCase() });
      setPaso("clave");
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo enviar el código"));
    } finally {
      setEnviando(false);
    }
  }

  async function cambiar(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\d{6}$/.test(codigo) || !clave || errorClave || errorRepetir || !repetir) {
      setError("Revisa el código y la contraseña nueva.");
      return;
    }
    setError(null);
    setEnviando(true);
    try {
      await apiPost("/portal/auth/recuperar/confirmar", { email: email.trim().toLowerCase(), codigo, password: clave });
    } catch (err) {
      setError(mensajeDeError(err, "No se pudo cambiar la contraseña"));
      setEnviando(false);
      return;
    }
    window.location.assign("/portal/ingresar?clave=nueva");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1>Recuperar contraseña</h1>
        </CardTitle>
        <CardDescription>
          {paso === "correo"
            ? "Te enviaremos un código a tu correo para elegir una contraseña nueva."
            : `Si ${email.trim()} tiene una cuenta, le enviamos un código. Escríbelo junto con tu contraseña nueva.`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {paso === "correo" ? (
          <form onSubmit={pedirCodigo} className="space-y-4" noValidate>
            <Campo id="email" label="Correo">
              <Input type="email" autoComplete="email" value={email} onChange={(ev) => setEmail(ev.target.value)} {...ariaCampo("email")} />
            </Campo>
            {error && (
              <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={enviando}>
              {enviando ? "Enviando..." : "Enviarme un código"}
            </Button>
          </form>
        ) : (
          <form onSubmit={cambiar} className="space-y-4" noValidate>
            <Campo id="codigo" label="Código">
              <Input
                inputMode="numeric"
                autoComplete="one-time-code"
                className="text-center text-lg tracking-[0.5em] tabular-nums"
                value={codigo}
                onChange={(ev) => setCodigo(ev.target.value.replace(/\D/g, "").slice(0, 6))}
                {...ariaCampo("codigo")}
              />
            </Campo>
            <Campo id="clave" label="Contraseña nueva" error={errorClave}>
              <Input type="password" autoComplete="new-password" value={clave} onChange={(ev) => setClave(ev.target.value)} {...ariaCampo("clave", errorClave)} />
            </Campo>
            <Campo id="repetir" label="Repite la contraseña" error={errorRepetir}>
              <Input type="password" autoComplete="new-password" value={repetir} onChange={(ev) => setRepetir(ev.target.value)} {...ariaCampo("repetir", errorRepetir)} />
            </Campo>
            {error && (
              <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={enviando}>
              <KeyRoundIcon aria-hidden />
              {enviando ? "Guardando..." : "Cambiar contraseña"}
            </Button>
            <Button type="button" variant="link" className="w-full" onClick={() => setPaso("correo")}>
              Usar otro correo o pedir otro código
            </Button>
          </form>
        )}
      </CardContent>
      <CardFooter className="text-sm">
        <Link href="/portal/ingresar" className="text-muted-foreground underline-offset-4 hover:underline">
          Volver a ingresar
        </Link>
      </CardFooter>
    </Card>
  );
}
