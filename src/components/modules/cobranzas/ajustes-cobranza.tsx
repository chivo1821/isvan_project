"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PlusIcon, RefreshCwIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { apiDelete, apiPost, apiPut, mensajeDeError } from "@/lib/api-client";
import { BANCOS, formatCuenta } from "@/lib/bancos";
import { hoyCaracas, type AjustesCobranza, type CuentaEmpresa, type Empresa, type TasaBcv } from "@/lib/cobranzas";
import { formatDate, formatDateTime, formatNumero, formatTelefono } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CedulaRif, CuentaBancaria, TelefonoVe, filtrarMonto } from "@/components/shared/campos-venezuela";

/** Tolerancia e inicio de la cartera. Solo el ADMIN los cambia (la API lo
 * exige); cobranzas los ve. */
export function AjustesCartera({ ajustes, editable }: { ajustes: AjustesCobranza; editable: boolean }) {
  const router = useRouter();
  const [dias, setDias] = useState(String(ajustes.diasTolerancia));
  const [inicio, setInicio] = useState(ajustes.inicioCartera ?? "");
  const [guardando, setGuardando] = useState(false);
  const diasNum = Number(dias);
  const diasValido = Number.isInteger(diasNum) && diasNum >= 0 && diasNum <= 180;
  const cambio = dias !== String(ajustes.diasTolerancia) || inicio !== (ajustes.inicioCartera ?? "");

  async function guardar() {
    setGuardando(true);
    try {
      await apiPut("/cobranzas/ajustes", { diasTolerancia: diasNum, inicioCartera: inicio || null });
      toast.success("Ajustes guardados");
      router.refresh();
    } catch (err) {
      toast.error("No se pudieron guardar", { description: mensajeDeError(err, "Revisa los valores") });
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cartera y bloqueo</CardTitle>
        <CardDescription>
          Un cliente queda bloqueado para despacho si tiene una factura o nota de entrega con saldo pasados los días de
          tolerancia. Lo anterior al inicio de la cartera se da por saldado.
          {!editable && " Solo un administrador puede cambiarlos."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="dias">Días de tolerancia</Label>
            <Input id="dias" type="number" min={0} max={180} value={dias} onChange={(e) => setDias(e.target.value)} disabled={!editable} className="w-32" aria-invalid={!diasValido || undefined} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="inicio">Inicio de la cartera</Label>
            <Input id="inicio" type="date" max={hoyCaracas()} value={inicio} onChange={(e) => setInicio(e.target.value)} disabled={!editable} className="w-44" />
          </div>
          {editable && (
            <Button onClick={guardar} disabled={guardando || !cambio || !diasValido}>
              {guardando ? "Guardando..." : "Guardar"}
            </Button>
          )}
        </div>
        {!diasValido && <p className="text-xs text-destructive">Entre 0 y 180 días.</p>}
        <p className="text-sm text-muted-foreground">
          {ajustes.bloqueoActivo
            ? `Bloqueo activo: cuentan los documentos desde el ${formatDate(ajustes.inicioCartera!)}.`
            : "Bloqueo apagado: falta el inicio de la cartera. Mientras tanto ningún despacho se bloquea por deuda."}
        </p>
      </CardContent>
    </Card>
  );
}

/** Tasa BCV: la trae DolarApi una vez al día; si falla o no coincide con el
 * BCV, se carga a mano (una manual no la pisa la automática). */
export function TasasBcv({ tasas }: { tasas: TasaBcv[] }) {
  const router = useRouter();
  const [fecha, setFecha] = useState(hoyCaracas());
  const [tasa, setTasa] = useState("");
  const [guardando, setGuardando] = useState(false);
  const valor = Number(tasa.replace(/\./g, "").replace(",", "."));

  async function guardar() {
    setGuardando(true);
    try {
      await apiPut("/cobranzas/tasas", { fecha, tasa: valor });
      toast.success("Tasa guardada");
      setTasa("");
      router.refresh();
    } catch (err) {
      toast.error("No se pudo guardar la tasa", { description: mensajeDeError(err, "Revisa el valor") });
    } finally {
      setGuardando(false);
    }
  }

  async function actualizar() {
    setGuardando(true);
    try {
      const r = await apiPost<{ actualizadas: number }>("/cobranzas/tasas/actualizar");
      toast.success("Tasas actualizadas desde DolarApi", { description: `${r.actualizadas} fecha(s) nuevas o corregidas.` });
      router.refresh();
    } catch (err) {
      toast.error("DolarApi no respondió", { description: mensajeDeError(err, "Carga la tasa a mano") });
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tasa BCV</CardTitle>
        <CardDescription>
          Bs por USD. Se toma de DolarApi automáticamente. Cada pago se convierte con la última tasa publicada,
          aunque su fecha valor sea del día hábil siguiente, y la tasa usada queda guardada en el pago.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="tasa-fecha">Fecha</Label>
            <Input id="tasa-fecha" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className="w-44" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tasa-valor">Tasa (Bs/USD)</Label>
            <Input id="tasa-valor" inputMode="decimal" placeholder="0,0000" value={tasa} onChange={(e) => setTasa(filtrarMonto(e.target.value))} className="w-40" />
          </div>
          <Button onClick={guardar} disabled={guardando || !(valor > 0) || !fecha}>
            Guardar a mano
          </Button>
          <Button variant="outline" onClick={actualizar} disabled={guardando}>
            <RefreshCwIcon aria-hidden />
            Traer de DolarApi
          </Button>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fecha</TableHead>
              <TableHead className="text-right">Tasa</TableHead>
              <TableHead>Origen</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tasas.slice(0, 10).map((t) => (
              <TableRow key={t.fecha}>
                <TableCell className="tabular-nums">{formatDate(t.fecha)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatNumero(t.tasa, 4)}</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {t.fuente === "MANUAL" ? `A mano${t.registradoPor ? ` (${t.registradoPor}, ${formatDateTime(t.registradoEn)})` : ""}` : "DolarApi"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

/** Las cuentas donde pagan los clientes (las ven en el portal al reportar). */
export function CuentasEmpresa({ cuentas, editable }: { cuentas: CuentaEmpresa[]; editable: boolean }) {
  const router = useRouter();
  const [empresa, setEmpresa] = useState<Empresa>("TRALOG");
  const [tipo, setTipo] = useState<"PAGO_MOVIL" | "TRANSFERENCIA">("PAGO_MOVIL");
  const [banco, setBanco] = useState("");
  const [numero, setNumero] = useState("");
  const [rif, setRif] = useState("");
  const [titular, setTitular] = useState("");
  const [guardando, setGuardando] = useState(false);

  async function agregar() {
    setGuardando(true);
    try {
      await apiPost("/cobranzas/cuentas-empresa", { empresa, tipo, bancoCodigo: banco, numero, rif, titular });
      toast.success("Cuenta agregada");
      setNumero("");
      router.refresh();
    } catch (err) {
      toast.error("No se pudo agregar", { description: mensajeDeError(err, "Revisa los datos") });
    } finally {
      setGuardando(false);
    }
  }

  async function borrar(id: string) {
    try {
      await apiDelete(`/cobranzas/cuentas-empresa/${id}`);
      toast.success("Cuenta eliminada");
      router.refresh();
    } catch (err) {
      toast.error("No se pudo eliminar", { description: mensajeDeError(err, "Intenta de nuevo") });
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Dónde pagan los clientes</CardTitle>
        <CardDescription>
          Las cuentas de ISVAN y TRALOG que ve el cliente en el portal al reportar un pago.
          {!editable && " Solo un administrador puede cambiarlas."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {cuentas.length === 0 ? (
          <p className="text-sm text-muted-foreground">Todavía no hay cuentas cargadas.</p>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {cuentas.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                <span>
                  <span className="font-medium">
                    {c.empresa} · {c.tipo === "PAGO_MOVIL" ? "Pago móvil" : "Transferencia"}
                  </span>{" "}
                  · {c.banco} · {c.tipo === "PAGO_MOVIL" ? formatTelefono(c.numero) : formatCuenta(c.numero)} · {c.rif} · {c.titular}
                </span>
                {editable && (
                  <Button variant="ghost" size="sm" onClick={() => borrar(c.id)} aria-label={`Eliminar la cuenta ${c.banco} de ${c.empresa}`}>
                    <Trash2Icon aria-hidden />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {editable && (
          <div className="grid gap-3 rounded-md border border-dashed border-border p-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="ce-empresa">Empresa</Label>
              <Select value={empresa} onValueChange={(v) => setEmpresa(v as Empresa)}>
                <SelectTrigger id="ce-empresa" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ISVAN">ISVAN</SelectItem>
                  <SelectItem value="TRALOG">TRALOG</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ce-tipo">Tipo</Label>
              <Select
                value={tipo}
                onValueChange={(v) => {
                  setTipo(v as "PAGO_MOVIL" | "TRANSFERENCIA");
                  setNumero("");
                }}
              >
                <SelectTrigger id="ce-tipo" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PAGO_MOVIL">Pago móvil</SelectItem>
                  <SelectItem value="TRANSFERENCIA">Transferencia</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ce-banco">Banco</Label>
              <Select value={banco} onValueChange={setBanco}>
                <SelectTrigger id="ce-banco" className="w-full">
                  <SelectValue placeholder="Elige el banco" />
                </SelectTrigger>
                <SelectContent>
                  {BANCOS.map((b) => (
                    <SelectItem key={b.codigo} value={b.codigo}>
                      {b.codigo} · {b.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ce-numero">{tipo === "PAGO_MOVIL" ? "Celular" : "Cuenta (20 dígitos)"}</Label>
              {tipo === "PAGO_MOVIL" ? (
                <TelefonoVe key="tel" id="ce-numero" value={numero} onChange={setNumero} />
              ) : (
                <CuentaBancaria key="cta" id="ce-numero" value={numero} onChange={setNumero} />
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ce-rif">RIF</Label>
              <CedulaRif id="ce-rif" value={rif} onChange={setRif} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ce-titular">Titular</Label>
              <Input id="ce-titular" maxLength={120} value={titular} onChange={(e) => setTitular(e.target.value)} />
            </div>
            <div className="sm:col-span-3">
              <Button onClick={agregar} disabled={guardando || !banco || !numero.trim() || !rif.trim() || titular.trim().length < 2}>
                <PlusIcon aria-hidden />
                Agregar cuenta
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
