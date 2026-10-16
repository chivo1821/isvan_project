"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LinkIcon, UnlinkIcon } from "lucide-react";
import { toast } from "sonner";
import { apiPost, mensajeDeError } from "@/lib/api-client";
import type { CuentaPortalAdmin, Empresa } from "@/lib/cobranzas";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/** Asociar la cuenta a un cliente (empresa + código del sistema de ventas).
 * Arranca con lo que el cliente declaró al registrarse. */
export function VincularDialog({ cuenta }: { cuenta: CuentaPortalAdmin }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [empresa, setEmpresa] = useState<Empresa>(cuenta.empresaDeclarada ?? "TRALOG");
  const [codigo, setCodigo] = useState(cuenta.codigoDeclarado ?? "");
  const [guardando, setGuardando] = useState(false);

  async function vincular() {
    setGuardando(true);
    try {
      await apiPost(`/cobranzas/cuentas/${cuenta.id}/vincular`, { empresa, codigoCliente: codigo.trim() });
      toast.success("Cuenta vinculada", {
        description: cuenta.estado === "POR_VALIDAR" ? "Quedó activa y se le avisó por correo." : undefined,
      });
      setAbierto(false);
      router.refresh();
    } catch (err) {
      toast.error("No se pudo vincular", { description: mensajeDeError(err, "Revisa el código") });
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Dialog open={abierto} onOpenChange={setAbierto}>
      <DialogTrigger asChild>
        <Button size="sm">
          <LinkIcon aria-hidden />
          {cuenta.clientes.length ? "Vincular otro cliente" : "Validar y vincular"}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Vincular la cuenta de {cuenta.nombre}</DialogTitle>
          <DialogDescription>
            RIF declarado: {cuenta.rif}. Asegúrate de que la cuenta es de ese cliente: con esto verá su deuda y podrá
            reportar pagos a su nombre.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor={`vin-emp-${cuenta.id}`}>Empresa</Label>
            <Select value={empresa} onValueChange={(v) => setEmpresa(v as Empresa)}>
              <SelectTrigger id={`vin-emp-${cuenta.id}`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ISVAN">ISVAN</SelectItem>
                <SelectItem value="TRALOG">TRALOG</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`vin-cod-${cuenta.id}`}>Código de cliente</Label>
            <Input id={`vin-cod-${cuenta.id}`} value={codigo} onChange={(e) => setCodigo(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={guardando}>
              Cancelar
            </Button>
          </DialogClose>
          <Button onClick={vincular} disabled={guardando || !codigo.trim()}>
            {guardando ? "Vinculando..." : "Vincular"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DesvincularButton({ cuentaId, empresa, codigoCliente, nombre }: { cuentaId: string; empresa: Empresa; codigoCliente: string; nombre: string }) {
  const router = useRouter();
  async function desvincular() {
    try {
      await apiPost(`/cobranzas/cuentas/${cuentaId}/desvincular`, { empresa, codigoCliente });
      toast.success("Cliente desvinculado");
      router.refresh();
    } catch (err) {
      toast.error("No se pudo desvincular", { description: mensajeDeError(err, "Intenta de nuevo") });
    }
  }
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={`Desvincular ${nombre}`}>
          <UnlinkIcon aria-hidden />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Desvincular {nombre}?</AlertDialogTitle>
          <AlertDialogDescription>
            La cuenta dejará de ver la deuda de este cliente. Si no le queda ninguno, vuelve a quedar en validación.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={desvincular}>Desvincular</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function SuspenderButton({ cuenta }: { cuenta: CuentaPortalAdmin }) {
  const router = useRouter();
  const suspendida = cuenta.estado === "SUSPENDIDA";
  async function cambiar() {
    try {
      await apiPost(`/cobranzas/cuentas/${cuenta.id}/${suspendida ? "reactivar" : "suspender"}`);
      toast.success(suspendida ? "Cuenta reactivada" : "Cuenta suspendida");
      router.refresh();
    } catch (err) {
      toast.error("No se pudo cambiar la cuenta", { description: mensajeDeError(err, "Intenta de nuevo") });
    }
  }
  if (suspendida) {
    return (
      <Button size="sm" variant="outline" onClick={cambiar}>
        Reactivar
      </Button>
    );
  }
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button size="sm" variant="outline">
          Suspender
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Suspender la cuenta de {cuenta.nombre}?</AlertDialogTitle>
          <AlertDialogDescription>Se cierra su sesión y no podrá entrar al portal hasta que la reactives.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={cambiar}>Suspender</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
