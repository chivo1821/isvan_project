"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiPut, mensajeDeError } from "@/lib/api-client";
import { CAMPO_FISCAL, type EmpresaFiscal } from "@/lib/administrativo";

function Campo({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

/** Datos fiscales de una empresa y sus módulos. Sin RIF, razón social y
 * domicilio fiscal no se enciende la facturación. */
export function EmpresaForm({ empresa }: { empresa: EmpresaFiscal }) {
  const router = useRouter();
  const [datos, setDatos] = useState({
    rif: empresa.rif ?? "",
    razonSocial: empresa.razonSocial,
    nombreComercial: empresa.nombreComercial ?? "",
    domicilioFiscal: empresa.domicilioFiscal ?? "",
    telefono: empresa.telefono ?? "",
    correo: empresa.correo ?? "",
    contribuyenteEspecial: empresa.contribuyenteEspecial,
    agenteRetencionIva: empresa.agenteRetencionIva,
    porcentajeRetencionIva: empresa.porcentajeRetencionIva ?? 75,
    agenteRetencionIslr: empresa.agenteRetencionIslr,
  });
  const [guardando, setGuardando] = useState(false);
  const cambiar = (campo: string, valor: unknown) => setDatos((d) => ({ ...d, [campo]: valor }));

  async function guardar() {
    setGuardando(true);
    try {
      await apiPut(`/empresas/${empresa.id}`, {
        ...datos,
        rif: datos.rif || null,
        nombreComercial: datos.nombreComercial || null,
        domicilioFiscal: datos.domicilioFiscal || null,
        telefono: datos.telefono || null,
        correo: datos.correo || null,
        porcentajeRetencionIva: datos.agenteRetencionIva ? Number(datos.porcentajeRetencionIva) : null,
      });
      toast.success(`Datos de ${empresa.codigo} guardados`);
      router.refresh();
    } catch (err) {
      toast.error("No se pudo guardar", { description: mensajeDeError(err, "Revisa los datos") });
    } finally {
      setGuardando(false);
    }
  }

  async function modulo(nombre: "ventas" | "inventario", activo: boolean) {
    try {
      await apiPut(`/empresas/${empresa.id}/modulos/${nombre}`, { activo });
      toast.success(`Módulo de ${nombre} ${activo ? "encendido" : "apagado"} para ${empresa.codigo}`);
      router.refresh();
    } catch (err) {
      toast.error("No se pudo cambiar el módulo", { description: mensajeDeError(err, "Intenta de nuevo") });
    }
  }

  const id = (c: string) => `${empresa.id}-${c}`;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{empresa.codigo}</CardTitle>
        <CardDescription>
          {empresa.faltaParaFacturar.length > 0
            ? `Para facturar falta: ${empresa.faltaParaFacturar.map((c) => CAMPO_FISCAL[c] ?? c).join(", ")}.`
            : "Datos fiscales completos."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo id={id("rif")} label="RIF">
            <Input id={id("rif")} value={datos.rif} placeholder="J-12345678-9" onChange={(e) => cambiar("rif", e.target.value)} />
          </Campo>
          <Campo id={id("razon")} label="Razón social">
            <Input id={id("razon")} value={datos.razonSocial} onChange={(e) => cambiar("razonSocial", e.target.value)} />
          </Campo>
          <Campo id={id("comercial")} label="Nombre comercial">
            <Input id={id("comercial")} value={datos.nombreComercial} onChange={(e) => cambiar("nombreComercial", e.target.value)} />
          </Campo>
          <Campo id={id("telefono")} label="Teléfono">
            <Input id={id("telefono")} value={datos.telefono} onChange={(e) => cambiar("telefono", e.target.value)} />
          </Campo>
          <Campo id={id("correo")} label="Correo (va en la factura)">
            <Input id={id("correo")} type="email" value={datos.correo} onChange={(e) => cambiar("correo", e.target.value)} />
          </Campo>
        </div>
        <Campo id={id("domicilio")} label="Domicilio fiscal">
          <Textarea id={id("domicilio")} rows={2} value={datos.domicilioFiscal} onChange={(e) => cambiar("domicilioFiscal", e.target.value)} />
        </Campo>
        <div className="flex flex-wrap gap-x-6 gap-y-3 text-sm">
          {(
            [
              ["contribuyenteEspecial", "Contribuyente especial"],
              ["agenteRetencionIva", "Agente de retención de IVA"],
              ["agenteRetencionIslr", "Agente de retención de ISLR"],
            ] as const
          ).map(([campo, texto]) => (
            <label key={campo} className="flex items-center gap-2">
              <Checkbox checked={datos[campo]} onCheckedChange={(v) => cambiar(campo, v === true)} />
              {texto}
            </label>
          ))}
          {datos.agenteRetencionIva && (
            <label className="flex items-center gap-2">
              Retiene
              <select
                className="h-8 rounded-md border border-input bg-transparent px-2"
                value={datos.porcentajeRetencionIva}
                onChange={(e) => cambiar("porcentajeRetencionIva", Number(e.target.value))}
              >
                <option value={75}>75 %</option>
                <option value={100}>100 %</option>
              </select>
              del IVA
            </label>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <div className="flex flex-wrap gap-2">
            {(["ventas", "inventario"] as const).map((m) => (
              <Button key={m} variant={empresa.modulos[m] ? "default" : "outline"} size="sm" onClick={() => modulo(m, !empresa.modulos[m])}>
                {empresa.modulos[m] ? `Apagar ${m}` : `Encender ${m}`}
              </Button>
            ))}
          </div>
          <Button onClick={guardar} disabled={guardando}>
            {guardando ? "Guardando..." : "Guardar datos fiscales"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
