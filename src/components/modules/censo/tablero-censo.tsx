"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangleIcon,
  ClipboardCheckIcon,
  CopyXIcon,
  DownloadIcon,
  MapPinnedIcon,
  RefrigeratorIcon,
  SearchIcon,
  StoreIcon,
  UserPlusIcon,
  UsersIcon,
} from "lucide-react";
import { toast } from "sonner";
import { StatCard } from "@/components/shared/stat-card";
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { API_URL, apiPost, mensajeDeError } from "@/lib/api-client";
import {
  queryCenso,
  type CensoBreve,
  type Conteo,
  type FiltrosCenso,
  type ListaCensos,
  type PuntoTablero,
  type TableroCenso,
  type VistaCenso,
} from "@/lib/censo";
import { formatNumero, formatPct } from "@/lib/constants";
import type { DefinicionFormulario } from "@/lib/formulario/motor";
import { BarrasConteo, BarrasPorDia } from "./graficos-censo";
import { ListaDeCensos } from "./lista-censos";

const LeafletMap = dynamic(() => import("@/components/map/leaflet-map").then((m) => m.LeafletMap), {
  ssr: false,
  loading: () => <div className="h-[32rem] w-full animate-pulse rounded-lg bg-muted" />,
});
const PuntoTableroCenso = dynamic(() => import("@/components/map/punto-tablero").then((m) => m.PuntoTableroCenso), {
  ssr: false,
});

// Los mismos de punto-tablero.tsx (no se importan de ahí: ese archivo carga
// Leaflet, que solo existe en el navegador).
const LEYENDA_COMPETENCIA = [
  { color: "#E8492C", texto: "Vende competencia" },
  { color: "#2563EB", texto: "No vende" },
  { color: "#9CA3AF", texto: "Sin dato" },
];

const n = (conteo: Conteo[], clave: string) => conteo.find((c) => c.clave === clave)?.n ?? 0;

function Grafico({ titulo, descripcion, children }: { titulo: string; descripcion?: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{titulo}</CardTitle>
        {descripcion && <CardDescription>{descripcion}</CardDescription>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function EnlaceCenso({ censo }: { censo: Partial<CensoBreve> & { id: string } }) {
  return (
    <Link href={`/censo/${censo.id}`} className="font-medium underline-offset-4 hover:underline">
      {censo.nombre ?? "Sin nombre"}
    </Link>
  );
}

function Detalle({ censo }: { censo: CensoBreve }) {
  return (
    <span className="block text-xs text-muted-foreground">
      {[censo.encuestador, censo.ruta, censo.fecha, censo.origen === "SURVEY123" ? "Survey123" : null]
        .filter(Boolean)
        .join(" · ")}
    </span>
  );
}

function Mapa({ puntos, definicion }: { puntos: PuntoTablero[]; definicion: DefinicionFormulario }) {
  const centro: [number, number] = puntos.length ? [puntos[0].lat, puntos[0].lng] : [10.49, -66.88];
  const limites = puntos.length > 1 ? puntos.map((p) => [p.lat, p.lng] as [number, number]) : undefined;
  if (!puntos.length) return <p className="py-10 text-center text-sm text-muted-foreground">Ningún censo con ubicación.</p>;
  return (
    <LeafletMap center={centro} zoom={12} bounds={limites} className="h-[32rem]">
      {puntos.map((p) => (
        <PuntoTableroCenso key={p.id} punto={p} definicion={definicion} />
      ))}
    </LeafletMap>
  );
}

// ---------- Principal ----------

/** Barra de dos tramos: registrados (verde) y por registrar (ámbar). */
function BarraRegistro({ registrados, total, etiqueta }: { registrados: number; total: number; etiqueta: string }) {
  const pct = total ? (registrados / total) * 100 : 0;
  return (
    <div
      role="meter"
      aria-label={etiqueta}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={registrados}
      className="flex h-3 w-full overflow-hidden rounded-full bg-warning/35"
    >
      <div className="h-full bg-success transition-all" style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Clientes de la maestra que ya existen en el sistema (Clientes: se pueden
 * despachar) contra los que faltan, vengan o no del censo. Respeta los
 * filtros de empresa y ruta, como la pestaña Avance. */
function RegistroDeClientes({ t }: { t: TableroCenso }) {
  const a = t.avance;
  const total = a.porEmpresa.reduce((s, e) => s + e.maestra, 0);
  const registrados = a.porEmpresa.reduce((s, e) => s + e.registrados, 0);
  const sinUbicacion = registrados - a.porEmpresa.reduce((s, e) => s + e.registradosConUbicacion, 0);
  const faltan = total - registrados;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Clientes registrados contra los que faltan por registrar</CardTitle>
        <CardDescription>
          {a.conMaestra.length
            ? `Clientes de la maestra vigente de ${a.conMaestra.join(" y ")} (sin la ruta 77) que ya existen en el sistema y se pueden despachar.`
            : "Todavía no hay maestra cargada."}
        </CardDescription>
      </CardHeader>
      {total > 0 && (
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-1">
              <p className="text-3xl font-semibold tabular-nums">{formatPct(registrados / total)}</p>
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground tabular-nums">{formatNumero(registrados)}</span> registrados ·{" "}
                <span className="font-medium text-foreground tabular-nums">{formatNumero(faltan)}</span> por registrar · de{" "}
                <span className="tabular-nums">{formatNumero(total)}</span> clientes
                {sinUbicacion > 0 && <> · {formatNumero(sinUbicacion)} registrados sin ubicación</>}
              </p>
            </div>
            <BarraRegistro registrados={registrados} total={total} etiqueta="Clientes registrados de la maestra" />
            <div className="flex gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-full bg-success" aria-hidden /> Registrados
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-full bg-warning/60" aria-hidden /> Por registrar
              </span>
            </div>
          </div>
          {a.porEmpresa.length > 1 && (
            <div className="grid gap-4 sm:grid-cols-2">
              {a.porEmpresa.map((e) => (
                <div key={e.empresa} className="space-y-1.5">
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="font-medium">{e.empresa}</span>
                    <span className="text-muted-foreground tabular-nums">
                      {formatNumero(e.registrados)} de {formatNumero(e.maestra)} ·{" "}
                      {formatPct(e.maestra ? e.registrados / e.maestra : 0)}
                    </span>
                  </div>
                  <BarraRegistro registrados={e.registrados} total={e.maestra} etiqueta={`Clientes registrados de ${e.empresa}`} />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

function Principal({ t }: { t: TableroCenso }) {
  const p = t.principal;
  const conActivo = n(p.poseeActivos, "Si");
  return (
    <div className="space-y-4">
      <RegistroDeClientes t={t} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={ClipboardCheckIcon}
          label="Total de visitas"
          value={formatNumero(p.visitas)}
          trend={p.duplicados ? `${formatNumero(p.duplicados)} duplicados aparte: no cuentan` : "Sin duplicados"}
        />
        <StatCard icon={StoreIcon} label="Clientes existentes" value={formatNumero(n(p.porTipoCliente, "Ya existente"))} tone="info" />
        <StatCard icon={UserPlusIcon} label="Clientes nuevos" value={formatNumero(n(p.porTipoCliente, "Nuevo"))} tone="success" />
        <StatCard
          icon={RefrigeratorIcon}
          label="Con activos"
          value={formatNumero(conActivo)}
          trend={p.visitas ? `${formatPct(conActivo / p.visitas)} de las visitas` : undefined}
          tone="warning"
        />
      </div>
      <Grafico titulo="Visitas por día">
        <BarrasPorDia datos={p.porDia} />
      </Grafico>
      <div className="grid gap-4 lg:grid-cols-2">
        <Grafico titulo="Visitas por vendedor">
          <BarrasConteo datos={p.porVendedor} anchoEtiqueta={140} />
        </Grafico>
        <Grafico titulo="Visitas por ruta">
          <BarrasConteo datos={p.porRuta} color="var(--chart-2)" anchoEtiqueta={72} />
        </Grafico>
        <Grafico titulo="Tipo de cliente">
          <BarrasConteo datos={p.porTipoCliente} color="var(--chart-3)" anchoEtiqueta={100} />
        </Grafico>
        <Grafico
          titulo="¿Posee activos asignados?"
          descripcion={
            p.propiedadActivo.length
              ? `De los que tienen: ${p.propiedadActivo.map((x) => `${x.clave} ${formatNumero(x.n)}`).join(" · ")}`
              : undefined
          }
        >
          <BarrasConteo datos={p.poseeActivos} color="var(--chart-4)" anchoEtiqueta={72} />
        </Grafico>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Resumen por vendedor</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Vendedor</TableHead>
                <TableHead className="text-right">Visitas</TableHead>
                <TableHead className="text-right">Existentes</TableHead>
                <TableHead className="text-right">Nuevos</TableHead>
                <TableHead className="text-right">Con activo</TableHead>
                <TableHead className="text-right">Venden competencia</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {p.tablaVendedores.map((v) => (
                <TableRow key={v.vendedor}>
                  <TableCell className="font-medium">{v.vendedor}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumero(v.visitas)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumero(v.existentes)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumero(v.nuevos)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumero(v.conActivo)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumero(v.conCompetencia)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------- Mapa (competencia y fotos) ----------

function MapaCompetencia({ t, definicion }: { t: TableroCenso; definicion: DefinicionFormulario }) {
  const m = t.mapa;
  const conFotos = t.puntos.filter((p) => p.fotos.length).length;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Grafico titulo="¿Vende helados de la competencia?">
          <BarrasConteo datos={m.vendeCompetencia} color="var(--chart-1)" anchoEtiqueta={72} />
        </Grafico>
        <Grafico titulo="¿Posee activos de la competencia?">
          <BarrasConteo datos={m.activosCompetencia} color="var(--chart-4)" anchoEtiqueta={72} />
        </Grafico>
        <Grafico titulo="Marcas de la competencia" descripcion="Un comercio puede vender varias.">
          <BarrasConteo datos={m.marcas} color="var(--chart-2)" anchoEtiqueta={100} />
        </Grafico>
        <Grafico titulo="Otras marcas" descripcion="Lo que escribieron en “¿Cuál otra marca vende?”.">
          {m.otrasMarcas.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Sin datos</p>
          ) : (
            <ul className="max-h-72 divide-y overflow-y-auto pr-1 text-sm [scrollbar-width:thin]">
              {m.otrasMarcas.map((o) => (
                <li key={o.clave} className="flex justify-between gap-3 py-1.5">
                  <span>{o.clave}</span>
                  <span className="tabular-nums text-muted-foreground">{formatNumero(o.n)}</span>
                </li>
              ))}
            </ul>
          )}
        </Grafico>
      </div>
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 space-y-0">
          <div>
            <CardTitle className="text-base">Mapa del censo</CardTitle>
            <CardDescription>
              {formatNumero(conFotos)} de {formatNumero(t.puntos.length)} censos con fotos. Toca un punto para ver la
              encuesta completa con sus fotos; las importadas se abren desde el servidor de Survey123.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
            {LEYENDA_COMPETENCIA.map((l) => (
              <span key={l.texto} className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-full" style={{ backgroundColor: l.color }} aria-hidden />
                {l.texto}
              </span>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          <Mapa puntos={t.puntos} definicion={definicion} />
        </CardContent>
      </Card>
    </div>
  );
}

// ---------- Avance y alertas ----------

function DescartarDuplicados({ total }: { total: number }) {
  const router = useRouter();
  const [enviando, setEnviando] = useState(false);
  async function descartar() {
    setEnviando(true);
    try {
      const r = await apiPost<{ descartados: number }>("/censo/duplicados/descartar", {});
      toast.success(`${formatNumero(r.descartados)} duplicados descartados`);
      router.refresh();
    } catch (e) {
      toast.error(mensajeDeError(e, "No se pudieron descartar"));
    } finally {
      setEnviando(false);
    }
  }
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={enviando}>
          <CopyXIcon /> Descartar {formatNumero(total)}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Descartar los duplicados?</AlertDialogTitle>
          <AlertDialogDescription>
            Los {formatNumero(total)} censos que repiten a otro (mismo código y empresa, o mismo RIF, a 50 m o menos)
            salen de la lista, del mapa y de los indicadores. Se queda el primero de cada uno. Los indicadores no
            cambian: los duplicados ya no contaban.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={descartar}>Descartar</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function Alerta({
  titulo,
  total,
  explicacion,
  accion,
  children,
}: {
  titulo: string;
  total: number;
  explicacion: string;
  accion?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="flex items-center gap-1.5 font-medium">
            {total > 0 && <AlertTriangleIcon className="size-4 text-warning" />}
            {titulo}: <span className="tabular-nums">{formatNumero(total)}</span>
          </p>
          <p className="text-xs text-muted-foreground">{explicacion}</p>
        </div>
        {total > 0 && accion}
      </div>
      {total > 0 && children && (
        <div className="max-h-56 overflow-y-auto text-sm [scrollbar-width:thin]">{children}</div>
      )}
    </div>
  );
}

function ListaPorRegistrar({ t }: { t: TableroCenso }) {
  const [busqueda, setBusqueda] = useState("");
  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    const lista = t.avance.porRegistrar;
    if (!q) return lista;
    return lista.filter((c) =>
      [c.codigo, c.razonSocial, c.ruta, c.zona, c.direccion, ...c.vendedores].some((v) => v?.toLowerCase().includes(q))
    );
  }, [busqueda, t.avance.porRegistrar]);
  const mostrados = filtrados.slice(0, 200);
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-end justify-between gap-2 space-y-0">
        <div>
          <CardTitle className="text-base">Clientes por registrar</CardTitle>
          <CardDescription>
            {formatNumero(t.avance.porRegistrarTotal)} de la maestra (sin la ruta 77) que todavía no existen en el
            sistema. “Censado” marca los que ya tienen censo pero no se pudieron registrar.
            {t.avance.porRegistrarTotal > t.avance.porRegistrar.length ? " La lista completa está en el Excel." : ""}
          </CardDescription>
        </div>
        <span className="relative">
          <SearchIcon className="absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
          <Input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Código, nombre, zona o vendedor"
            className="w-64 pl-8"
            aria-label="Buscar en clientes por registrar"
          />
        </span>
      </CardHeader>
      <CardContent className="max-h-[28rem] overflow-auto [scrollbar-width:thin]">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cliente</TableHead>
              <TableHead>Ruta</TableHead>
              <TableHead>Día</TableHead>
              <TableHead>Zona</TableHead>
              <TableHead>Vendedor</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {mostrados.map((c) => (
              <TableRow key={`${c.empresa}-${c.codigo}`}>
                <TableCell>
                  <span className="font-medium">{c.razonSocial}</span>
                  {c.censado && (
                    <span className="ml-1.5 rounded-full bg-info/15 px-1.5 text-xs text-foreground">Censado</span>
                  )}
                  <span className="block text-xs text-muted-foreground">
                    {c.empresa} {c.codigo}
                    {c.direccion ? ` · ${c.direccion}` : ""}
                  </span>
                </TableCell>
                <TableCell className="tabular-nums">{c.ruta}</TableCell>
                <TableCell className="tabular-nums">{c.diaVisita ?? "—"}</TableCell>
                <TableCell>{c.zona ?? "—"}</TableCell>
                <TableCell className="text-muted-foreground">{c.vendedores.join(", ") || "Sin asignar"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {filtrados.length > mostrados.length && (
          <p className="pt-2 text-xs text-muted-foreground">
            Mostrando {formatNumero(mostrados.length)} de {formatNumero(filtrados.length)}: busca para acotar.
          </p>
        )}
        {filtrados.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">Nadie por registrar.</p>}
      </CardContent>
    </Card>
  );
}

function Avance({ t, filtros }: { t: TableroCenso; filtros: FiltrosCenso }) {
  const a = t.avance;
  const al = t.alertas;
  const maestra = a.porEmpresa.reduce((s, e) => s + e.maestra, 0);
  const registrados = a.porEmpresa.reduce((s, e) => s + e.registrados, 0);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {a.conMaestra.length
            ? `Contra la maestra vigente de ${a.conMaestra.join(" y ")}: registrado es un cliente que ya existe en el sistema.`
            : "Todavía no hay maestra cargada: cárgala con el botón “Maestra de clientes” para ver quién falta por censar."}
        </p>
        <Button variant="outline" asChild>
          <a href={`${API_URL}/censo/tablero.xlsx?${queryCenso(filtros, false)}`}>
            <DownloadIcon /> Descargar listas (Excel)
          </a>
        </Button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={MapPinnedIcon}
          label="Registrados de la maestra"
          value={maestra ? formatPct(registrados / maestra) : "—"}
          trend={`${formatNumero(registrados)} de ${formatNumero(maestra)} clientes (sin la ruta 77)`}
          tone="success"
        />
        <StatCard icon={UsersIcon} label="Por registrar" value={formatNumero(a.porRegistrarTotal)} tone="warning" />
        <StatCard
          icon={UserPlusIcon}
          label="Creados en el sistema"
          value={formatNumero(a.creados)}
          trend={`${formatNumero(a.completados)} completados (ubicación, ruta…)`}
          tone="info"
        />
        <StatCard
          icon={StoreIcon}
          label="Por crear en ventas"
          value={formatNumero(a.pendientesVentasTotal)}
          trend={`${formatNumero(a.posiblesClientesTotal)} posibles clientes aparte`}
        />
      </div>

      {a.porRuta.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Avance por ruta</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ruta</TableHead>
                  <TableHead>Vendedor</TableHead>
                  <TableHead className="text-right">Maestra</TableHead>
                  <TableHead className="text-right">Registrados</TableHead>
                  <TableHead className="text-right">Por registrar</TableHead>
                  <TableHead className="w-40">Avance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {a.porRuta.map((r) => (
                  <TableRow key={`${r.empresa}-${r.ruta}`}>
                    <TableCell className="font-medium">
                      {r.empresa} · Ruta {r.ruta}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{r.vendedores.join(", ") || "Sin asignar"}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumero(r.maestra)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumero(r.registrados)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumero(r.porRegistrar)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Progress value={(r.avance ?? 0) * 100} className="h-2" aria-label={`Avance de la ruta ${r.ruta}`} />
                        <span className="w-12 text-right text-xs tabular-nums">{formatPct(r.avance ?? 0, 0)}</span>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Alertas</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 lg:grid-cols-2">
          <Alerta
            titulo="Duplicados"
            total={al.duplicadosTotal}
            explicacion="Mismo código y empresa (o mismo RIF si es posible cliente) a 50 m o menos de un censo anterior. No cuentan."
            accion={<DescartarDuplicados total={al.duplicadosTotal} />}
          >
            <ul className="divide-y">
              {al.duplicados.map((d) => (
                <li key={d.id} className="py-1.5">
                  <EnlaceCenso censo={d} /> <span className="text-xs text-muted-foreground">({d.claves.join(", ")})</span>
                  <span className="block text-xs text-muted-foreground">
                    {[d.encuestador, d.fecha].filter(Boolean).join(" · ")} · repite a{" "}
                    <Link href={`/censo/${d.duplicadoDe.id}`} className="underline-offset-4 hover:underline">
                      {d.duplicadoDe.nombre ?? "otro censo"}
                    </Link>
                    {d.duplicadoDe.fecha ? ` del ${d.duplicadoDe.fecha}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </Alerta>
          <Alerta
            titulo="Mismo código en lugares distintos"
            total={al.mismoCodigoLejosTotal}
            explicacion="El mismo código censado a más de 50 m: sucursales o un código equivocado."
          >
            <ul className="divide-y">
              {al.mismoCodigoLejos.map((x) => (
                <li key={`${x.empresa}-${x.codigo}`} className="py-1.5">
                  <span className="font-medium">
                    {x.empresa} {x.codigo}
                  </span>
                  {x.metros != null && <span className="text-xs text-muted-foreground"> · {formatNumero(x.metros)} m</span>}
                  <span className="block text-xs text-muted-foreground">
                    {x.censos.map((c, i) => (
                      <span key={c.id}>
                        {i > 0 && " | "}
                        <Link href={`/censo/${c.id}`} className="underline-offset-4 hover:underline">
                          {c.nombre ?? "Sin nombre"}
                        </Link>{" "}
                        ({c.encuestador}, {c.fecha})
                      </span>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </Alerta>
          <Alerta
            titulo="Códigos para revisar"
            total={al.revisarTotal}
            explicacion="El código existe con otro nombre (o es AMBAS con un solo código): no se tocó el cliente."
          >
            <ul className="divide-y">
              {al.revisar.map((r) => (
                <li key={`${r.id}-${r.empresa}`} className="py-1.5">
                  <EnlaceCenso censo={r} />
                  <span className="block text-xs text-muted-foreground">{r.motivo}</span>
                </li>
              ))}
            </ul>
          </Alerta>
          <Alerta
            titulo="Sin código de cliente"
            total={al.sinCodigoTotal}
            explicacion="Clientes existentes (o nuevos que compran) censados sin código, casi todos del formulario anterior de Survey123: no se pueden cruzar con la maestra."
          />
        </CardContent>
      </Card>

      <ListaPorRegistrar t={t} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Por crear en ventas</CardTitle>
            <CardDescription>Censados con un código que no está en la maestra ni en las ventas cargadas.</CardDescription>
          </CardHeader>
          <CardContent className="max-h-80 overflow-y-auto [scrollbar-width:thin]">
            {a.pendientesVentas.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Ninguno.</p>
            ) : (
              <ul className="divide-y text-sm">
                {a.pendientesVentas.map((p) => (
                  <li key={`${p.id}-${p.empresa}`} className="py-1.5">
                    <EnlaceCenso censo={p} />{" "}
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {p.empresa} {p.codigo}
                    </span>
                    <Detalle censo={p} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Posibles clientes</CardTitle>
            <CardDescription>Comercios nuevos que no desean comprar por ahora (sin código).</CardDescription>
          </CardHeader>
          <CardContent className="max-h-80 overflow-y-auto [scrollbar-width:thin]">
            {a.posiblesClientes.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Ninguno.</p>
            ) : (
              <ul className="divide-y text-sm">
                {a.posiblesClientes.map((p) => (
                  <li key={p.id} className="py-1.5">
                    <EnlaceCenso censo={p} />{" "}
                    <span className="text-xs text-muted-foreground">
                      {[p.rif && `RIF ${p.rif}`, p.telefono].filter(Boolean).join(" · ")}
                    </span>
                    <Detalle censo={p} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ---------- Contenedor ----------

/** El tablero del censo, con las pestañas que el cliente tenía en Survey123
 * (Principal y Mapa, que une el mapa y el de imágenes) más Avance y Registros. La pestaña
 * va en la URL sin volver a pedir la página: todos los datos ya llegaron. */
export function TableroDelCenso({
  tablero,
  lista,
  filtros,
  definicion,
}: {
  definicion: DefinicionFormulario;
  tablero: TableroCenso;
  lista: ListaCensos;
  filtros: FiltrosCenso;
}) {
  const [vista, setVista] = useState<VistaCenso>(filtros.vista);
  const alertas = tablero.alertas.duplicadosTotal + tablero.alertas.revisarTotal + tablero.alertas.mismoCodigoLejosTotal;

  function cambiar(valor: string) {
    const nueva = valor as VistaCenso;
    setVista(nueva);
    window.history.replaceState(null, "", `/censo?${queryCenso({ ...filtros, vista: nueva })}`);
  }

  return (
    <Tabs value={vista} onValueChange={cambiar}>
      <TabsList className="flex-wrap">
        <TabsTrigger value="principal">Principal</TabsTrigger>
        <TabsTrigger value="mapa">Mapa</TabsTrigger>
        <TabsTrigger value="avance">
          Avance
          {alertas > 0 && (
            <span className="ml-1 rounded-full bg-warning/25 px-1.5 text-xs tabular-nums text-foreground">{formatNumero(alertas)}</span>
          )}
        </TabsTrigger>
        <TabsTrigger value="registros">Registros</TabsTrigger>
      </TabsList>
      <TabsContent value="principal" className="mt-4">
        <Principal t={tablero} />
      </TabsContent>
      <TabsContent value="mapa" className="mt-4">
        {vista === "mapa" && <MapaCompetencia t={tablero} definicion={definicion} />}
      </TabsContent>
      <TabsContent value="avance" className="mt-4">
        <Avance t={tablero} filtros={filtros} />
      </TabsContent>
      <TabsContent value="registros" className="mt-4">
        <ListaDeCensos datos={lista} filtros={{ ...filtros, vista: "registros" }} />
      </TabsContent>
    </Tabs>
  );
}
