"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PlusIcon } from "lucide-react";
import { toast } from "sonner";
import { apiPost, mensajeDeError } from "@/lib/api-client";
import { BANCOS } from "@/lib/bancos";
import { METODO_PAGO_LABEL, hoyCaracas, type Empresa, type MetodoPago } from "@/lib/cobranzas";
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
import { Textarea } from "@/components/ui/textarea";

// Lo que cobranzas registra a mano. Pago móvil y transferencia también, por
// si el cliente pagó y no lo reportó en el portal.
const METODOS: MetodoPago[] = ["EFECTIVO", "DIVISAS", "RETENCION", "AJUSTE", "PAGO_MOVIL", "TRANSFERENCIA"];
const SIN_BANCO = "__sin_banco";

function leerMonto(texto: string): number | null {
  const limpio = texto.trim();
  if (!limpio) return null;
  const valor = Number(limpio.includes(",") ? limpio.replace(/\./g, "").replace(",", ".") : limpio);
  return Number.isFinite(valor) && valor > 0 ? Math.round(valor * 100) / 100 : null;
}

/** Un pago recibido por fuera del portal. Queda verificado de una vez y se
 * aplica a lo que vence primero. */
export function RegistrarPagoDialog({ empresa, codigoCliente, nombre }: { empresa: Empresa; codigoCliente: string; nombre: string }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [metodo, setMetodo] = useState<MetodoPago>("EFECTIVO");
  const [fecha, setFecha] = useState(hoyCaracas());
  const [moneda, setMoneda] = useState<"BS" | "USD">("BS");
  const [monto, setMonto] = useState("");
  const [banco, setBanco] = useState(SIN_BANCO);
  const [telefono, setTelefono] = useState("");
  const [cuenta, setCuenta] = useState("");
  const [cedula, setCedula] = useState("");
  const [referencia, setReferencia] = useState("");
  const [nota, setNota] = useState("");
  const [guardando, setGuardando] = useState(false);

  // Divisas y ajustes van en dólares; pago móvil y transferencia, en bolívares.
  const monedaFija = metodo === "DIVISAS" || metodo === "AJUSTE" ? "USD" : metodo === "PAGO_MOVIL" || metodo === "TRANSFERENCIA" ? "BS" : null;
  const enMoneda = monedaFija ?? moneda;
  const valor = leerMonto(monto);

  function reiniciar() {
    setMetodo("EFECTIVO");
    setFecha(hoyCaracas());
    setMoneda("BS");
    setMonto("");
    setBanco(SIN_BANCO);
    setTelefono("");
    setCuenta("");
    setCedula("");
    setReferencia("");
    setNota("");
  }

  async function guardar() {
    if (valor == null) return;
    setGuardando(true);
    try {
      await apiPost("/cobranzas/pagos", {
        empresa,
        codigoCliente,
        metodo,
        fechaPago: fecha,
        montoBs: enMoneda === "BS" ? valor : null,
        montoUsd: enMoneda === "USD" ? valor : null,
        bancoCodigo: banco === SIN_BANCO ? null : banco,
        telefono: telefono || null,
        cuenta: cuenta || null,
        cedulaRif: cedula || null,
        referencia: referencia || null,
        nota: nota || null,
      });
      toast.success("Pago registrado", { description: "Quedó verificado y se aplicó a lo que vence primero." });
      setAbierto(false);
      router.refresh();
    } catch (err) {
      toast.error("No se pudo registrar el pago", { description: mensajeDeError(err, "Revisa los datos") });
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Dialog
      open={abierto}
      onOpenChange={(v) => {
        setAbierto(v);
        if (v) reiniciar();
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <PlusIcon aria-hidden />
          Registrar pago
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Registrar un pago de {nombre}</DialogTitle>
          <DialogDescription>
            Para pagos recibidos por fuera del portal. Queda verificado y se abona a lo que vence primero.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="rp-metodo">Medio</Label>
            <Select value={metodo} onValueChange={(v) => setMetodo(v as MetodoPago)}>
              <SelectTrigger id="rp-metodo" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {METODOS.map((m) => (
                  <SelectItem key={m} value={m}>
                    {METODO_PAGO_LABEL[m]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rp-fecha">Fecha</Label>
            <Input id="rp-fecha" type="date" max={hoyCaracas()} value={fecha} onChange={(e) => setFecha(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rp-monto">Monto ({enMoneda === "BS" ? "Bs" : "USD"})</Label>
            <Input id="rp-monto" inputMode="decimal" placeholder="0,00" value={monto} onChange={(e) => setMonto(e.target.value)} />
            {enMoneda === "BS" && <p className="text-xs text-muted-foreground">Se convierte con la última tasa BCV publicada.</p>}
          </div>
          {!monedaFija && (
            <div className="space-y-1.5">
              <Label htmlFor="rp-moneda">Moneda</Label>
              <Select value={moneda} onValueChange={(v) => setMoneda(v as "BS" | "USD")}>
                <SelectTrigger id="rp-moneda" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="BS">Bolívares</SelectItem>
                  <SelectItem value="USD">Dólares</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          {metodo === "TRANSFERENCIA" ? (
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="rp-cuenta">Cuenta de origen (20 dígitos)</Label>
              <Input id="rp-cuenta" inputMode="numeric" value={cuenta} onChange={(e) => setCuenta(e.target.value)} />
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="rp-banco">Banco {metodo === "PAGO_MOVIL" ? "" : "(opcional)"}</Label>
              <Select value={banco} onValueChange={setBanco}>
                <SelectTrigger id="rp-banco" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SIN_BANCO}>Sin banco</SelectItem>
                  {BANCOS.map((b) => (
                    <SelectItem key={b.codigo} value={b.codigo}>
                      {b.codigo} · {b.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {metodo === "PAGO_MOVIL" && (
            <div className="space-y-1.5">
              <Label htmlFor="rp-telefono">Celular</Label>
              <Input id="rp-telefono" type="tel" value={telefono} onChange={(e) => setTelefono(e.target.value)} />
            </div>
          )}
          {(metodo === "PAGO_MOVIL" || metodo === "TRANSFERENCIA") && (
            <div className="space-y-1.5">
              <Label htmlFor="rp-cedula">Cédula o RIF</Label>
              <Input id="rp-cedula" value={cedula} onChange={(e) => setCedula(e.target.value)} />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="rp-referencia">Referencia {metodo === "PAGO_MOVIL" || metodo === "TRANSFERENCIA" ? "" : "(opcional)"}</Label>
            <Input id="rp-referencia" value={referencia} onChange={(e) => setReferencia(e.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="rp-nota">Nota {metodo === "AJUSTE" ? "(obligatoria)" : "(opcional)"}</Label>
            <Textarea id="rp-nota" maxLength={500} value={nota} onChange={(e) => setNota(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={guardando}>
              Cancelar
            </Button>
          </DialogClose>
          <Button onClick={guardar} disabled={guardando || valor == null || (metodo === "AJUSTE" && !nota.trim())}>
            {guardando ? "Guardando..." : "Registrar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
