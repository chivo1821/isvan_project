"use client";

import { useMemo, useState } from "react";
import Link from "@/components/shared/enlace";
import { PlusIcon, SearchIcon, TriangleAlertIcon, XIcon } from "lucide-react";
import { RutaAgendaCard } from "@/components/modules/rutas/ruta-agenda-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  diaCaracas,
  etiquetaDia,
  formatDia,
  type Agenda,
  type RutaAgenda,
  type VehiculoOpcion,
} from "@/lib/planificacion";
import { cn } from "@/lib/utils";

type Vista = "dia" | "semana";

function enlaceDia(fecha: string) {
  return `/rutas/planificacion?vista=dia&fecha=${fecha}`;
}

function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function textoDeRuta(r: RutaAgenda, vehiculosPorId: Map<string, VehiculoOpcion>): string {
  const partes: string[] = [r.numero, r.estado];
  for (const vid of [r.vehiculoId, r.vehiculoApoyoId]) {
    if (!vid) continue;
    const v = vehiculosPorId.get(vid);
    if (v) {
      partes.push(v.placa, v.tipo);
      if (v.conductor) partes.push(v.conductor);
    }
  }
  if (!r.vehiculoId) partes.push("sin vehiculo");
  for (const p of r.pedidos) {
    partes.push(p.numero, p.numeroDocumento, p.codigoCliente, p.cliente);
    if (p.tipoDocumento) partes.push(p.tipoDocumento, `${p.tipoDocumento} ${p.numeroDocumento}`);
    if (p.ciudad) partes.push(p.ciudad);
  }
  return normalizar(partes.join(" "));
}

export function PlanificacionAgenda({
  agenda,
  vista,
  fecha,
  hoy,
  dias,
  puedeProgramar,
}: {
  agenda: Agenda;
  vista: Vista;
  fecha: string;
  hoy: string;
  dias: string[];
  puedeProgramar: boolean;
}) {
  const [busqueda, setBusqueda] = useState("");

  const vehiculosPorId = useMemo(
    () => new Map(agenda.vehiculos.map((v) => [v.id, v])),
    [agenda.vehiculos]
  );

  const terminos = useMemo(
    () => normalizar(busqueda).trim().split(/\s+/).filter(Boolean),
    [busqueda]
  );

  const { rutasFiltradas, atrasadasFiltradas } = useMemo(() => {
    if (terminos.length === 0) {
      return { rutasFiltradas: agenda.rutas, atrasadasFiltradas: agenda.atrasadas };
    }
    const coincide = (r: RutaAgenda) => {
      const pajar = textoDeRuta(r, vehiculosPorId);
      return terminos.every((t) => pajar.includes(t));
    };
    return {
      rutasFiltradas: agenda.rutas.filter(coincide),
      atrasadasFiltradas: agenda.atrasadas.filter(coincide),
    };
  }, [agenda.rutas, agenda.atrasadas, terminos, vehiculosPorId]);

  const porDia = useMemo(() => {
    const mapa = new Map<string, RutaAgenda[]>(dias.map((d) => [d, []]));
    for (const r of rutasFiltradas) {
      mapa.get(diaCaracas(r.salidaProgramada))?.push(r);
    }
    return mapa;
  }, [dias, rutasFiltradas]);

  const todas = [...rutasFiltradas, ...atrasadasFiltradas];
  const activas = todas.filter((r) => r.estado === "PLANIFICADA" || r.estado === "EN_TRANSITO");
  const sinVehiculo = activas.filter((r) => !r.vehiculoId).length;
  const conAvisos = activas.filter((r) => r.avisos.length > 0).length;
  const pedidos = rutasFiltradas.reduce((n, r) => n + r.pedidos.length, 0);

  const totalOriginal = agenda.rutas.length + agenda.atrasadas.length;
  const filtrando = terminos.length > 0;
  const sinResultados = filtrando && todas.length === 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:max-w-md">
          <SearchIcon
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar ruta, placa, conductor, cliente, código o factura…"
            aria-label="Buscar en planificación"
            className="pl-8 pr-8"
          />
          {busqueda && (
            <button
              type="button"
              onClick={() => setBusqueda("")}
              aria-label="Limpiar búsqueda"
              className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
            >
              <XIcon className="size-4" />
            </button>
          )}
        </div>
        {filtrando && (
          <p className="text-xs text-muted-foreground">
            Mostrando <span className="font-medium text-foreground">{todas.length}</span> de {totalOriginal} ruta(s)
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Resumen etiqueta="Rutas" valor={rutasFiltradas.length} />
        <Resumen etiqueta="Pedidos" valor={pedidos} />
        <Resumen etiqueta="Sin vehículo" valor={sinVehiculo} alerta={sinVehiculo > 0} />
        <Resumen etiqueta="Con avisos" valor={conAvisos} alerta={conAvisos > 0} />
      </div>

      {sinResultados ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center text-sm text-muted-foreground">
            Ninguna ruta coincide con «{busqueda.trim()}».
            <Button variant="outline" size="sm" onClick={() => setBusqueda("")}>
              Limpiar búsqueda
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {atrasadasFiltradas.length > 0 && (
            <section className="space-y-3">
              <h2 className="flex items-center gap-1.5 font-heading text-base font-medium">
                <TriangleAlertIcon className="size-4 text-[var(--warning)]" aria-hidden />
                Atrasadas: debían salir antes y siguen planificadas ({atrasadasFiltradas.length})
              </h2>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {atrasadasFiltradas.map((r) => (
                  <RutaAgendaCard
                    key={r.id}
                    ruta={r}
                    vehiculos={agenda.vehiculos}
                    puedeProgramar={puedeProgramar}
                    mostrarFecha
                  />
                ))}
              </div>
            </section>
          )}

          {vista === "dia" ? (
            (porDia.get(fecha) ?? []).length === 0 ? (
              filtrando ? null : <SinRutas puedeProgramar={puedeProgramar} />
            ) : (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {porDia.get(fecha)!.map((r) => (
                  <RutaAgendaCard key={r.id} ruta={r} vehiculos={agenda.vehiculos} puedeProgramar={puedeProgramar} />
                ))}
              </div>
            )
          ) : (
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-7">
              {dias.map((d) => {
                const delDia = porDia.get(d) ?? [];
                return (
                  <section
                    key={d}
                    className={cn(
                      "space-y-2 rounded-lg border p-2",
                      d === hoy ? "border-primary/50 bg-primary/5" : "bg-muted/30"
                    )}
                  >
                    <Link href={enlaceDia(d)} className="block rounded-md px-1 hover:bg-muted">
                      <span className="block text-sm font-medium">{etiquetaDia(d, hoy)}</span>
                      <span className="block text-xs text-muted-foreground">
                        {formatDia(d)} · {delDia.length} ruta(s)
                      </span>
                    </Link>
                    {delDia.length === 0 ? (
                      <p className="px-1 py-3 text-xs text-muted-foreground">Sin salidas</p>
                    ) : (
                      delDia.map((r) => (
                        <RutaAgendaCard
                          key={r.id}
                          ruta={r}
                          vehiculos={agenda.vehiculos}
                          puedeProgramar={puedeProgramar}
                          compacta
                        />
                      ))
                    )}
                  </section>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Resumen({ etiqueta, valor, alerta = false }: { etiqueta: string; valor: number; alerta?: boolean }) {
  return (
    <Card className="py-3">
      <CardContent className="px-4">
        <p className="text-xs text-muted-foreground">{etiqueta}</p>
        <p className={cn("text-2xl font-bold tabular-nums", alerta && "text-warning")}>{valor}</p>
      </CardContent>
    </Card>
  );
}

function SinRutas({ puedeProgramar }: { puedeProgramar: boolean }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-12 text-center text-sm text-muted-foreground">
        No hay rutas que salgan este día.
        {puedeProgramar && (
          <Button asChild variant="outline" size="sm">
            <Link href="/rutas/nueva">
              <PlusIcon />
              Planificar una ruta
            </Link>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
