"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BikeIcon, CopyIcon, KeyRoundIcon, LockIcon, RotateCcwIcon, Trash2Icon, UserXIcon } from "lucide-react";
import { toast } from "sonner";
import { apiDelete, apiPost, apiPut, mensajeDeError } from "@/lib/api-client";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatDateTime, formatHora, formatTelefono } from "@/lib/constants";
import type { CodigoRegistro, Motorizado } from "@/lib/motorizados";

/** Una acción que hay que confirmar antes de mandarla. */
type Confirmacion = {
  motorizado: Motorizado;
  accion: "baja" | "reactivar" | "pin" | "eliminar";
};

const TEXTO_ACCION: Record<Confirmacion["accion"], { titulo: string; detalle: string; boton: string }> = {
  baja: {
    titulo: "Dar de baja",
    detalle:
      "Deja de poder entrar y se le cierra la sesión. Su moto sale de la planificación. Sus rutas y pagos se conservan, y se le puede liquidar lo pendiente.",
    boton: "Dar de baja",
  },
  reactivar: {
    titulo: "Reactivar",
    detalle: "Vuelve a entrar con su placa y su PIN de siempre, y su moto vuelve a la planificación.",
    boton: "Reactivar",
  },
  pin: {
    titulo: "Restablecer PIN",
    detalle:
      "Se genera un PIN nuevo de 6 números y se le cierran las sesiones abiertas. El PIN se muestra una sola vez: dáselo al motorizado.",
    boton: "Generar PIN nuevo",
  },
  eliminar: {
    titulo: "Eliminar",
    detalle: "Se borran el motorizado y su moto. Solo es posible porque nunca tuvo rutas (por ejemplo, un registro duplicado o de prueba).",
    boton: "Eliminar",
  },
};

function codigoAleatorio() {
  const letras = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sin 0/O ni 1/I, que se confunden al dictarlo
  const valores = crypto.getRandomValues(new Uint32Array(6));
  return `MOTO-${Array.from(valores, (v) => letras[v % letras.length]).join("")}`;
}

/** El backend solo manda bloqueadoHasta si el bloqueo sigue vigente: no se
 * compara con el reloj aquí (el del servidor y el del navegador no
 * coinciden, y eso rompe la hidratación). */
function bloqueado(m: Motorizado) {
  return m.bloqueadoHasta != null;
}

/** Los motorizados que se registran solos: el código de registro que
 * comparte la empresa y su administración (solo ADMIN). */
export function MotorizadosPanel({
  motorizados,
  codigo,
  capacidadKg,
}: {
  motorizados: Motorizado[];
  codigo: CodigoRegistro;
  capacidadKg: number | null;
}) {
  const router = useRouter();
  const [confirmando, setConfirmando] = useState<Confirmacion | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [pinNuevo, setPinNuevo] = useState<{ nombre: string; pin: string } | null>(null);
  const [editandoCodigo, setEditandoCodigo] = useState(false);
  const [codigoNuevo, setCodigoNuevo] = useState("");

  async function copiar(texto: string, que: string) {
    try {
      await navigator.clipboard.writeText(texto);
      toast.success(`${que} copiado`);
    } catch {
      toast.error("No se pudo copiar; selecciónalo y cópialo a mano");
    }
  }

  async function confirmar() {
    if (!confirmando) return;
    const { motorizado: m, accion } = confirmando;
    setEnviando(true);
    try {
      if (accion === "pin") {
        const { pin } = await apiPost<{ pin: string }>(`/motorizados/${m.id}/restablecer-pin`);
        setPinNuevo({ nombre: m.nombre, pin });
      } else if (accion === "eliminar") {
        await apiDelete(`/motorizados/${m.id}`);
        toast.success(`${m.nombre} eliminado`);
      } else {
        await apiPost(`/motorizados/${m.id}/${accion}`);
        toast.success(accion === "baja" ? `${m.nombre} quedó de baja` : `${m.nombre} reactivado`);
      }
      setConfirmando(null);
      router.refresh();
    } catch (err) {
      toast.error("No se pudo completar la acción", { description: mensajeDeError(err, "Intenta de nuevo") });
    } finally {
      setEnviando(false);
    }
  }

  async function guardarCodigo() {
    setEnviando(true);
    try {
      await apiPut("/motorizados/codigo-registro", { codigo: codigoNuevo.trim() });
      toast.success("Código de registro actualizado", {
        description: "Los motorizados ya registrados no se ven afectados.",
      });
      setEditandoCodigo(false);
      router.refresh();
    } catch (err) {
      toast.error("No se pudo guardar el código", { description: mensajeDeError(err, "Intenta de nuevo") });
    } finally {
      setEnviando(false);
    }
  }

  const activos = motorizados.filter((m) => m.activo).length;
  const textos = confirmando ? TEXTO_ACCION[confirmando.accion] : null;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BikeIcon className="size-5" aria-hidden />
            Motorizados
          </CardTitle>
          <CardDescription>
            Se registran solos desde el login («Soy motorizado») con su nombre, la placa de su moto, su teléfono y
            un PIN. Su moto entra a la flota como MOTO de {capacidadKg ?? 40} kg (el bolso de la empresa; se cambia
            en Rutas › Planificación › Ajustes).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Label>Código de registro</Label>
          {codigo.codigo ? (
            <div className="flex flex-wrap items-center gap-2">
              <code className="rounded-md border bg-muted px-3 py-1.5 font-mono text-base font-semibold tracking-wider">
                {codigo.codigo}
              </code>
              <Button variant="outline" size="sm" onClick={() => copiar(codigo.codigo!, "Código")}>
                <CopyIcon /> Copiar
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setCodigoNuevo(codigo.codigo ?? "");
                  setEditandoCodigo(true);
                }}
              >
                Cambiar
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <StatusBadge tone="warning" label="Registro cerrado" />
              <span className="text-sm text-muted-foreground">Define un código para que los motorizados puedan registrarse.</span>
              <Button
                size="sm"
                onClick={() => {
                  setCodigoNuevo(codigoAleatorio());
                  setEditandoCodigo(true);
                }}
              >
                Definir código
              </Button>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Compártelo por el grupo de motorizados. Solo sirve para crear la cuenta, no para entrar: cambiarlo no afecta
            a nadie ya registrado.
            {codigo.actualizadoEn &&
              ` Cambiado el ${formatDateTime(codigo.actualizadoEn)}${codigo.actualizadoPor ? ` por ${codigo.actualizadoPor}` : ""}.`}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            {activos} activo(s){motorizados.length > activos ? ` · ${motorizados.length - activos} de baja` : ""}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {motorizados.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Todavía no se ha registrado ningún motorizado.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Motorizado</TableHead>
                    <TableHead>Moto</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>Rutas</TableHead>
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {motorizados.map((m) => (
                    <TableRow key={m.id} className={m.activo ? undefined : "opacity-70"}>
                      <TableCell>
                        <p className="font-medium text-foreground">{m.nombre}</p>
                        {m.telefono && (
                          <a href={`tel:${m.telefono}`} className="text-xs text-primary hover:underline">
                            {formatTelefono(m.telefono)}
                          </a>
                        )}
                        <p className="text-xs text-muted-foreground">Registrado el {formatDate(m.registradoEn)}</p>
                      </TableCell>
                      <TableCell>
                        <span className="font-mono text-sm">{m.placa ?? "—"}</span>
                        {m.capacidadKg != null && (
                          <span className="ml-1.5 text-xs text-muted-foreground">{m.capacidadKg} kg</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {!m.activo ? (
                          <StatusBadge tone="neutral" label="De baja" />
                        ) : bloqueado(m) ? (
                          <span className="flex items-center gap-1.5">
                            <StatusBadge tone="warning" label="Bloqueado" />
                            <span className="text-xs text-muted-foreground">
                              <LockIcon className="inline size-3" aria-hidden /> hasta las {formatHora(m.bloqueadoHasta!)}
                            </span>
                          </span>
                        ) : (
                          <StatusBadge tone="success" label="Activo" />
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {m.rutas}
                        {m.ultimaRuta && (
                          <span className="ml-1.5 text-xs text-muted-foreground">última: {formatDate(m.ultimaRuta)}</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap justify-end gap-1.5">
                          {m.activo && (
                            <Button variant="outline" size="sm" onClick={() => setConfirmando({ motorizado: m, accion: "pin" })}>
                              <KeyRoundIcon /> PIN
                            </Button>
                          )}
                          {m.activo ? (
                            <Button variant="outline" size="sm" onClick={() => setConfirmando({ motorizado: m, accion: "baja" })}>
                              <UserXIcon /> Dar de baja
                            </Button>
                          ) : (
                            <Button variant="outline" size="sm" onClick={() => setConfirmando({ motorizado: m, accion: "reactivar" })}>
                              <RotateCcwIcon /> Reactivar
                            </Button>
                          )}
                          {m.rutas === 0 && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:text-destructive"
                              aria-label={`Eliminar a ${m.nombre}`}
                              onClick={() => setConfirmando({ motorizado: m, accion: "eliminar" })}
                            >
                              <Trash2Icon />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={confirmando != null} onOpenChange={(v) => !v && setConfirmando(null)}>
        <DialogContent>
          {confirmando && textos && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {textos.titulo}: {confirmando.motorizado.nombre}
                </DialogTitle>
                <DialogDescription>{textos.detalle}</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="outline" disabled={enviando}>
                    Cancelar
                  </Button>
                </DialogClose>
                <Button
                  variant={confirmando.accion === "eliminar" || confirmando.accion === "baja" ? "destructive" : "default"}
                  onClick={confirmar}
                  disabled={enviando}
                >
                  {enviando ? "Procesando..." : textos.boton}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={pinNuevo != null} onOpenChange={(v) => !v && setPinNuevo(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>PIN nuevo de {pinNuevo?.nombre}</DialogTitle>
            <DialogDescription>
              Dáselo al motorizado: entra con su placa y este PIN. No se volverá a mostrar.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-center gap-3 py-2">
            <code className="rounded-md border bg-muted px-4 py-2 font-mono text-3xl font-semibold tracking-[0.3em]">
              {pinNuevo?.pin}
            </code>
            <Button variant="outline" size="sm" onClick={() => pinNuevo && copiar(pinNuevo.pin, "PIN")}>
              <CopyIcon /> Copiar
            </Button>
          </div>
          <DialogFooter>
            <Button onClick={() => setPinNuevo(null)}>Listo</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editandoCodigo} onOpenChange={setEditandoCodigo}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Código de registro</DialogTitle>
            <DialogDescription>
              Entre 6 y 32 letras, números o guiones. Al cambiarlo, el anterior deja de servir para registrarse; los ya
              registrados siguen entrando igual.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Input
              value={codigoNuevo}
              onChange={(e) => setCodigoNuevo(e.target.value.toUpperCase())}
              className="font-mono"
              aria-label="Código de registro"
            />
            <Button variant="outline" onClick={() => setCodigoNuevo(codigoAleatorio())}>
              Generar
            </Button>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" disabled={enviando}>
                Cancelar
              </Button>
            </DialogClose>
            <Button onClick={guardarCodigo} disabled={enviando || !/^[A-Za-z0-9-]{6,32}$/.test(codigoNuevo.trim())}>
              {enviando ? "Guardando..." : "Guardar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
