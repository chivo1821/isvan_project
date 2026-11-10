"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EMPRESAS_GASTOS, VISTAS, enlaceGastos, type FiltrosGastos } from "@/lib/gastos";

export function FiltrosGastosBarra({ filtros }: { filtros: FiltrosGastos }) {
  const router = useRouter();
  const [desde, setDesde] = useState(filtros.desde);
  const [hasta, setHasta] = useState(filtros.hasta);
  const cambio = desde !== filtros.desde || hasta !== filtros.hasta;

  return (
    <div className="space-y-3">
      <nav aria-label="Vistas" className="flex flex-wrap gap-1.5 border-b border-border pb-3">
        {VISTAS.map((v) => (
          <Button key={v.valor} size="sm" variant={filtros.vista === v.valor ? "secondary" : "ghost"} asChild>
            <Link
              href={enlaceGastos(filtros, { vista: v.valor, categoria: undefined })}
              aria-current={filtros.vista === v.valor ? "page" : undefined}
            >
              {v.label}
            </Link>
          </Button>
        ))}
      </nav>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (desde && hasta) router.push(enlaceGastos(filtros, { desde, hasta: hasta < desde ? desde : hasta }));
        }}
      >
        <div className="flex gap-1.5" role="group" aria-label="Empresa">
          {EMPRESAS_GASTOS.map((e) => (
            <Button key={e.valor} type="button" size="sm" variant={filtros.empresa === e.valor ? "default" : "outline"} asChild>
              <Link href={enlaceGastos(filtros, { empresa: e.valor, categoria: undefined })}>{e.label}</Link>
            </Button>
          ))}
        </div>
        {filtros.vista !== "cargas" && (
          <>
            <div className="space-y-1">
              <Label htmlFor="gastos-desde" className="text-xs text-muted-foreground">
                Desde
              </Label>
              <Input
                id="gastos-desde"
                type="month"
                value={desde}
                onChange={(e) => setDesde(e.target.value)}
                className="h-8 w-40"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="gastos-hasta" className="text-xs text-muted-foreground">
                Hasta
              </Label>
              <Input
                id="gastos-hasta"
                type="month"
                value={hasta}
                onChange={(e) => setHasta(e.target.value)}
                className="h-8 w-40"
              />
            </div>
            <Button type="submit" size="sm" variant="outline" disabled={!cambio}>
              Ver período
            </Button>
          </>
        )}
      </form>
    </div>
  );
}
