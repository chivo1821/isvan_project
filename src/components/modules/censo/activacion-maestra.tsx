"use client";

import { useEffect, useState } from "react";
import { Loader2Icon, SearchIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiGet, mensajeDeError } from "@/lib/api-client";
import type { ActivacionMaestra as Activacion, EmpresaMaestra, ListaActivacionMaestra } from "@/lib/censo";
import { formatDateTime, formatNumero, formatPct, formatUsd } from "@/lib/constants";
import { hoyCaracas } from "@/lib/delivery";
import { formatFecha, formatMes } from "@/lib/indicadores";

// Las listas pueden tener cientos de clientes: se dibujan de a tramos.
const TRAMO = 100;
const EMPRESAS: EmpresaMaestra[] = ["ISVAN", "TRALOG"];

const EXPLICACION: Record<string, string> = {
  atendidos: "Compraron en el mes. Ordenados por venta neta.",
  menos2: "No compraron en el mes, pero su última compra fue hace menos de 2 semanas.",
  de2a4: "Su última compra fue hace 2 a 4 semanas.",
  de4a8: "Su última compra fue hace 4 a 8 semanas.",
  mas8: "Llevan más de 8 semanas sin comprar.",
  sinCompras:
    "Están en la maestra pero no aparecen en las ventas cargadas: nunca compraron o su código no coincide con el de ventas.",
};

/** Los últimos 12 meses, del actual hacia atrás, como "YYYY-MM". */
function ultimosMeses() {
  const [anio, mes] = hoyCaracas().split("-").map(Number);
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(anio, mes - 1 - i, 1));
    return d.toISOString().slice(0, 7);
  });
}

function paraBuscar(texto: string) {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function TablaLista({ lista, busqueda }: { lista: ListaActivacionMaestra; busqueda: string }) {
  const [visibles, setVisibles] = useState(TRAMO);
  const atendidos = lista.clave === "atendidos";
  const termino = paraBuscar(busqueda.trim());
  const filtrados = termino
    ? lista.clientes.filter((c) =>
        paraBuscar(`${c.nombre} ${c.codigo} ${c.ruta} ${c.vendedores.join(" ")} ${c.visitadoPor ?? ""}`).includes(termino)
      )
    : lista.clientes;

  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">{EXPLICACION[lista.clave]}</p>
      {filtrados.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {lista.total === 0 ? "Ningún cliente en esta lista." : "Ningún cliente coincide con la búsqueda."}
        </p>
      ) : (
        <div className="max-h-[28rem] overflow-auto rounded-lg border border-border">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-card">
              <TableRow>
                <TableHead>Código</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Ruta</TableHead>
                <TableHead>Vendedor</TableHead>
                <TableHead>Visita en el mes</TableHead>
                <TableHead className="text-right">Última compra</TableHead>
                {atendidos ? (
                  <TableHead className="text-right">Venta del mes</TableHead>
                ) : (
                  <TableHead className="text-right">Días sin compra</TableHead>
                )}
                <TableHead className="text-right">Venta mes anterior</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtrados.slice(0, visibles).map((c) => (
                <TableRow key={c.codigo}>
                  <TableCell className="text-muted-foreground tabular-nums">{c.codigo}</TableCell>
                  <TableCell className="font-medium">{c.nombre}</TableCell>
                  <TableCell>{c.ruta}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {c.vendedores.length > 0 ? c.vendedores.join(", ") : "—"}
                  </TableCell>
                  <TableCell>
                    {c.ultimaVisita ? (
                      <>
                        {formatDateTime(c.ultimaVisita)}
                        {c.visitas > 1 && <span className="text-muted-foreground"> ({c.visitas} visitas)</span>}
                        <span className="block text-xs text-muted-foreground">{c.visitadoPor}</span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">Sin visita</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {c.ultimaCompra ? formatFecha(c.ultimaCompra) : "—"}
                  </TableCell>
                  {atendidos ? (
                    <TableCell className="text-right tabular-nums">{formatUsd(c.ventaPeriodo)}</TableCell>
                  ) : (
                    <TableCell className="text-right tabular-nums">
                      {c.diasSinCompra != null ? formatNumero(c.diasSinCompra) : "—"}
                    </TableCell>
                  )}
                  <TableCell className="text-right text-muted-foreground tabular-nums">
                    {c.ventaAnterior ? formatUsd(c.ventaAnterior) : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {filtrados.length > visibles && (
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>
            Se muestran {formatNumero(visibles)} de {formatNumero(filtrados.length)}.
          </span>
          <Button variant="ghost" size="sm" onClick={() => setVisibles((v) => v + TRAMO)}>
            Mostrar {formatNumero(Math.min(TRAMO, filtrados.length - visibles))} más
          </Button>
        </div>
      )}
    </div>
  );
}

/** Activación del mes con la maestra como cartera: quién compró (ventas
 * cargadas) y quién fue visitado por un vendedor. Respeta el filtro de
 * ruta de la página; la empresa y el mes se eligen aquí. */
export function ActivacionMaestra({ empresas, rutas }: { empresas: string[]; rutas: string[] }) {
  const meses = ultimosMeses();
  const [empresa, setEmpresa] = useState<EmpresaMaestra>(empresas.length === 1 ? (empresas[0] as EmpresaMaestra) : "ISVAN");
  const [mes, setMes] = useState(meses[0]);
  // Los últimos datos que llegaron se siguen mostrando (atenuados) mientras
  // carga otra empresa o mes; "respuesta" dice a qué consulta corresponde lo
  // último que respondió la API, así que cargando = todavía no responde la actual.
  const [datos, setDatos] = useState<Activacion | null>(null);
  const [respuesta, setRespuesta] = useState<{ consulta: string; error: string | null } | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const q = new URLSearchParams({ empresa, mes });
  rutas.forEach((r) => q.append("ruta", r));
  const consulta = q.toString();
  const cargando = respuesta?.consulta !== consulta;
  const error = cargando ? null : respuesta.error;

  useEffect(() => {
    let vigente = true;
    apiGet<Activacion>(`/censo/activacion?${consulta}`)
      .then((r) => {
        if (!vigente) return;
        setDatos(r);
        setRespuesta({ consulta, error: null });
      })
      .catch((e) => {
        if (vigente) setRespuesta({ consulta, error: mensajeDeError(e, "No se pudo cargar la activación") });
      });
    return () => {
      vigente = false;
    };
  }, [consulta]);

  // El mes en curso (o uno sin cargar completo) puede no tener todas sus ventas.
  const ventasIncompletas = datos && (!datos.ultimaVentaCargada || datos.ultimaVentaCargada < datos.hasta);

  return (
    <Card>
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Activación del mes</CardTitle>
            <p className="text-sm text-muted-foreground">
              Cartera: la maestra vigente, sin la ruta 77. Activado = compró en el mes según las ventas cargadas; al
              lado, si un vendedor lo visitó.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {cargando && <Loader2Icon className="size-4 animate-spin text-muted-foreground" aria-label="Cargando" />}
            <Tabs value={empresa} onValueChange={(v) => setEmpresa(v as EmpresaMaestra)}>
              <TabsList>
                {EMPRESAS.map((e) => (
                  <TabsTrigger key={e} value={e}>
                    {e}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <Select value={mes} onValueChange={setMes}>
              <SelectTrigger className="w-40" aria-label="Mes">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {meses.map((m) => (
                  <SelectItem key={m} value={m}>
                    {formatMes(`${m}-01`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        {datos && datos.cartera > 0 && (
          <div className={cargando ? "space-y-1.5 opacity-60 transition-opacity" : "space-y-1.5 transition-opacity"}>
            <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
              <span>
                <span className="text-lg font-semibold text-foreground">{formatPct(datos.pctActivacion)}</span>{" "}
                <span className="text-muted-foreground">
                  de activación: {formatNumero(datos.compraron)} de {formatNumero(datos.cartera)} clientes compraron
                </span>
              </span>
              <span className="text-muted-foreground">
                {formatNumero(datos.visitados)} visitados · {formatNumero(datos.visitadosSinCompra)} visitados sin
                compra · {formatNumero(datos.niCompraNiVisita)} sin compra ni visita
              </span>
            </div>
            <Progress value={(datos.pctActivacion ?? 0) * 100} className="h-2" aria-label="Porcentaje de activación" />
            {ventasIncompletas && (
              <p className="text-xs text-muted-foreground">
                {datos.ultimaVentaCargada
                  ? `Ventas de ${datos.empresa} cargadas hasta el ${formatFecha(datos.ultimaVentaCargada)}: las compras posteriores todavía no cuentan.`
                  : `Todavía no hay ventas de ${datos.empresa} cargadas.`}
              </p>
            )}
          </div>
        )}
        <div className="relative w-full sm:w-64">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar cliente, código o vendedor"
            aria-label="Buscar cliente en las listas de activación"
            className="h-8 pl-8"
          />
        </div>
      </CardHeader>
      <CardContent>
        {error ? (
          <p className="py-6 text-center text-sm text-destructive">{error}</p>
        ) : !datos ? (
          <div className="h-40 animate-pulse rounded-lg bg-muted" />
        ) : datos.cartera === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No hay clientes de {datos.empresa} en la maestra con estos filtros.
          </p>
        ) : (
          // key: al cambiar de empresa o de mes, vuelve a la primera lista.
          <Tabs key={`${datos.empresa}-${datos.desde}`} defaultValue="atendidos">
            <div className="overflow-x-auto">
              <TabsList>
                {datos.listas.map((lista) => (
                  <TabsTrigger key={lista.clave} value={lista.clave} disabled={lista.total === 0}>
                    {lista.etiqueta} ({formatNumero(lista.total)})
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>
            {datos.listas.map((lista) => (
              <TabsContent key={lista.clave} value={lista.clave} className="pt-2">
                <TablaLista lista={lista} busqueda={busqueda} />
              </TabsContent>
            ))}
          </Tabs>
        )}
      </CardContent>
    </Card>
  );
}
