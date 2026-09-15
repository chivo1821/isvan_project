"use client";

import { useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatNumero, formatUsd } from "@/lib/constants";
import { finDeMes, formatFecha, formatMes, queryPagina, type CoberturaVentas as Cobertura, type Empresa } from "@/lib/indicadores";
import { cn } from "@/lib/utils";

const DIAS_SEMANA = ["L", "M", "M", "J", "V", "S", "D"];
const DIA_LARGO = new Intl.DateTimeFormat("es-VE", { weekday: "short", day: "2-digit", month: "short", timeZone: "UTC" });

// Las fechas son días sueltos: se opera en UTC para no correrlas de día.
function aFecha(texto: string) {
  return new Date(`${texto}T00:00:00Z`);
}
function aTexto(fecha: Date) {
  return fecha.toISOString().slice(0, 10);
}
function sumarDias(texto: string, dias: number) {
  const d = aFecha(texto);
  d.setUTCDate(d.getUTCDate() + dias);
  return aTexto(d);
}
/** Lunes de la semana ISO. */
function lunesDe(texto: string) {
  const dia = (aFecha(texto).getUTCDay() + 6) % 7;
  return sumarDias(texto, -dia);
}
function semanaIso(texto: string) {
  const d = aFecha(texto);
  d.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7));
  const primerJueves = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((d.getTime() - primerJueves.getTime()) / 86400000 - 3 + ((primerJueves.getUTCDay() + 6) % 7)) / 7);
}

function enlace(empresa: Empresa, desde: string, hasta: string) {
  return `/indicadores?${queryPagina({
    empresa,
    desde,
    hasta,
    rutas: [],
    grupos: [],
    tipos: [],
    clientes: [],
    productos: [],
    tiposDocumento: [],
  })}`;
}

/** Intensidad del día según su venta: cuatro escalones de un solo tono,
 * cortados en los cuartiles de todos los días cargados. */
function escalones(ventas: number[]) {
  const orden = [...ventas].sort((a, b) => a - b);
  const cuantil = (q: number) => orden[Math.min(orden.length - 1, Math.floor(q * orden.length))] ?? 0;
  const cortes = [cuantil(0.25), cuantil(0.5), cuantil(0.75)];
  return (venta: number) => cortes.filter((c) => venta > c).length;
}
const RELLENO = [30, 50, 72, 100];

/** Qué días, semanas y meses tienen ventas cargadas y de qué archivo viene
 * cada día. Cada carga manda solo en los días que trae, así que un día
 * siempre viene de una sola carga. Un clic en un día, una semana o un mes
 * abre los indicadores de ese período. */
export function CoberturaVentas({ cobertura, empresa }: { cobertura: Cobertura; empresa: Empresa }) {
  const [cargaResaltada, setCargaResaltada] = useState<string | null>(null);
  const { dias, cargas } = cobertura;

  if (dias.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Cobertura</CardTitle>
        </CardHeader>
        <CardContent className="py-6 text-center text-sm text-muted-foreground">
          Todavía no hay ventas confirmadas de {empresa}.
        </CardContent>
      </Card>
    );
  }

  const porFecha = new Map(dias.map((d) => [d.fecha, d]));
  const archivoDe = new Map(cargas.map((c) => [c.id, c.archivo]));
  const escalon = escalones(dias.map((d) => d.ventaNeta));
  const primero = dias[0].fecha;
  const ultimo = dias[dias.length - 1].fecha;

  const diasPorCarga = new Map<string, string[]>();
  for (const d of dias) diasPorCarga.set(d.cargaId, [...(diasPorCarga.get(d.cargaId) ?? []), d.fecha]);

  // Todos los meses entre el primero y el último: un mes sin datos también
  // se muestra, para que el hueco se vea.
  const meses: string[] = [];
  for (let mes = `${primero.slice(0, 7)}-01`; mes <= ultimo; mes = sumarDias(finDeMes(mes), 1)) meses.push(mes);

  return (
    <Card>
      <CardHeader className="space-y-2">
        <CardTitle>Cobertura</CardTitle>
        <p className="text-sm text-muted-foreground">
          Del {formatFecha(primero)} al {formatFecha(ultimo)}: {formatNumero(dias.length)} días con ventas en{" "}
          {formatNumero(meses.length)} {meses.length === 1 ? "mes" : "meses"}. Cada carga reemplaza solo los días que trae:
          para agregar meses no hace falta volver a subir los que ya están. Haz clic en un día, una semana o un mes para
          ver sus indicadores.
        </p>
        <div className="flex flex-wrap gap-2">
          {cargas
            .filter((c) => diasPorCarga.has(c.id))
            .map((c) => {
              const suyos = diasPorCarga.get(c.id) ?? [];
              const activa = cargaResaltada === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setCargaResaltada(activa ? null : c.id)}
                  aria-pressed={activa}
                  className={cn(
                    "rounded-md border px-2.5 py-1 text-left text-xs transition-colors hover:bg-muted",
                    activa ? "border-primary bg-primary/5" : "border-border"
                  )}
                >
                  <span className="block max-w-72 truncate font-medium text-foreground">{c.archivo}</span>
                  <span className="text-muted-foreground">
                    {formatNumero(suyos.length)} días vigentes · {formatFecha(suyos[0])} – {formatFecha(suyos[suyos.length - 1])}
                  </span>
                </button>
              );
            })}
        </div>
        {cargaResaltada && (
          <p className="text-xs text-muted-foreground">
            Resaltados los días que vienen de «{archivoDe.get(cargaResaltada)}». Vuelve a hacer clic en la carga para
            quitar el resaltado.
          </p>
        )}
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {meses.map((mes) => {
            const fin = finDeMes(mes);
            const delMes = dias.filter((d) => d.fecha >= mes && d.fecha <= fin);
            const venta = delMes.reduce((total, d) => total + d.ventaNeta, 0);
            // Lunes a sábado sin ventas dentro del rango cargado: los huecos
            // que conviene revisar (el domingo normalmente no se vende).
            const huecos: string[] = [];
            for (let d = mes > primero ? mes : primero; d <= fin && d <= ultimo; d = sumarDias(d, 1)) {
              if (aFecha(d).getUTCDay() !== 0 && !porFecha.has(d)) huecos.push(d);
            }
            const semanas: string[] = [];
            for (let lunes = lunesDe(mes); lunes <= fin; lunes = sumarDias(lunes, 7)) semanas.push(lunes);

            return (
              <div key={mes} className="space-y-2 rounded-lg border border-border p-3">
                <div className="flex items-baseline justify-between gap-2">
                  {delMes.length > 0 ? (
                    <Link
                      href={enlace(empresa, mes, fin)}
                      className="font-medium capitalize text-foreground hover:underline"
                    >
                      {formatMes(mes)}
                    </Link>
                  ) : (
                    <span className="font-medium capitalize text-muted-foreground">{formatMes(mes)}</span>
                  )}
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {delMes.length > 0 ? `${formatNumero(delMes.length)} días · ${formatUsd(venta)}` : "sin datos"}
                  </span>
                </div>
                <table className="w-full table-fixed border-separate border-spacing-0.5 text-center text-[11px]">
                  <thead>
                    <tr className="text-muted-foreground">
                      <th className="w-9 font-normal" title="Semana ISO">
                        Sem.
                      </th>
                      {DIAS_SEMANA.map((d, i) => (
                        <th key={i} className="font-normal">
                          {d}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {semanas.map((lunes) => {
                      const domingo = sumarDias(lunes, 6);
                      const conDatos = Array.from({ length: 7 }, (_, i) => sumarDias(lunes, i)).some((d) => porFecha.has(d));
                      return (
                        <tr key={lunes}>
                          <td className="text-muted-foreground">
                            {conDatos ? (
                              <Link
                                href={enlace(empresa, lunes, domingo)}
                                className="hover:text-foreground hover:underline"
                                title={`Semana del ${formatFecha(lunes)} al ${formatFecha(domingo)}`}
                              >
                                {semanaIso(lunes)}
                              </Link>
                            ) : (
                              semanaIso(lunes)
                            )}
                          </td>
                          {Array.from({ length: 7 }, (_, i) => {
                            const fecha = sumarDias(lunes, i);
                            if (fecha < mes || fecha > fin) return <td key={fecha} />;
                            const dia = porFecha.get(fecha);
                            const numero = Number(fecha.slice(8));
                            if (!dia) {
                              const esHueco = huecos.includes(fecha);
                              return (
                                <td key={fecha}>
                                  <span
                                    className={cn(
                                      "flex h-7 items-center justify-center rounded-sm text-muted-foreground",
                                      esHueco ? "border border-dashed border-warning/60" : "opacity-50"
                                    )}
                                    title={`${DIA_LARGO.format(aFecha(fecha))}: sin ventas cargadas`}
                                  >
                                    {numero}
                                  </span>
                                </td>
                              );
                            }
                            const nivel = escalon(dia.ventaNeta);
                            const atenuado = cargaResaltada !== null && dia.cargaId !== cargaResaltada;
                            return (
                              <td key={fecha}>
                                <Link
                                  href={enlace(empresa, fecha, fecha)}
                                  className={cn(
                                    "flex h-7 items-center justify-center rounded-sm font-medium tabular-nums transition-opacity hover:ring-2 hover:ring-ring",
                                    nivel >= 2 ? "text-primary-foreground" : "text-foreground",
                                    atenuado && "opacity-25"
                                  )}
                                  style={{
                                    background: `color-mix(in oklab, var(--primary) ${RELLENO[nivel]}%, transparent)`,
                                  }}
                                  title={[
                                    DIA_LARGO.format(aFecha(fecha)),
                                    `${formatUsd(dia.ventaNeta)} · ${formatNumero(dia.documentos)} documentos · ${formatNumero(dia.filas)} filas`,
                                    `Carga: ${archivoDe.get(dia.cargaId) ?? "—"}`,
                                  ].join("\n")}
                                >
                                  {numero}
                                </Link>
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {huecos.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Sin ventas de lunes a sábado: {huecos.map((d) => Number(d.slice(8))).join(", ")}
                  </p>
                )}
              </div>
            );
          })}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            Venta del día:
            {RELLENO.map((r) => (
              <span
                key={r}
                className="inline-block size-3 rounded-[3px]"
                style={{ background: `color-mix(in oklab, var(--primary) ${r}%, transparent)` }}
              />
            ))}
            de menos a más
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block size-3 rounded-[3px] border border-dashed border-warning/60" />
            lunes a sábado sin ventas
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
