"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  Loader2Icon,
  SaveIcon,
  SearchIcon,
  SparklesIcon,
  Undo2Icon,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, apiGet, apiPatch, apiPost, mensajeDeError } from "@/lib/api-client";
import {
  CATEGORIAS_CORRECCION,
  type CategoriaCorreccion,
  type CensoPorCorregir,
  type CensosPorCorregir,
  type ConteoCorreccion,
  type ResultadoCorreccion,
  type ResultadoDevolucion,
  type SugerenciaMaestra,
} from "@/lib/censo";
import { formatNumero } from "@/lib/constants";
import { cn } from "@/lib/utils";

const CATEGORIA: Record<CategoriaCorreccion, { titulo: string; ayuda: string }> = {
  revisar: {
    titulo: "Código con otro nombre",
    ayuda:
      "El código existe en la maestra o en ventas, pero es de otro comercio: puede estar mal escrito. Corrígelo, o confirma que es el correcto.",
  },
  ambas: {
    titulo: "AMBAS con un solo código",
    ayuda: "Censados para las dos empresas con un solo código: escribe el de ISVAN y el de TRALOG.",
  },
  sin_codigo: {
    titulo: "Sin código",
    ayuda:
      "Clientes existentes (o nuevos que compran) censados sin empresa ni código, casi todos del formulario anterior de Survey123.",
  },
  no_encontrado: {
    titulo: "No está en ventas",
    ayuda:
      "El código no aparece en la maestra ni en las ventas cargadas. Si está mal escrito, corrígelo; si es correcto, se resuelve solo cuando el cliente aparezca en ventas.",
  },
};

const EMPRESAS = ["ISVAN", "TRALOG", "AMBAS"] as const;

/** Solo lo que acepta un código de ventas: letras, números y guiones, hasta
 * 20 (sin maxLength: cortaría lo que se pega antes de filtrarlo). */
const filtrarCodigo = (v: string) => v.replace(/[^A-Za-z0-9-]/g, "").slice(0, 20);

function CampoCodigo({
  etiqueta,
  valor,
  onCambio,
  error,
}: {
  etiqueta: string;
  valor: string;
  onCambio: (v: string) => void;
  error?: string;
}) {
  return (
    <label className="flex flex-col gap-0.5 text-xs text-muted-foreground">
      {etiqueta}
      <Input
        value={valor}
        onChange={(e) => onCambio(filtrarCodigo(e.target.value))}
        inputMode="text"
        aria-invalid={!!error}
        className="h-8 w-28 tabular-nums"
      />
      {error && <span className="text-destructive">{error}</span>}
    </label>
  );
}

const MOTIVO_MINIMO = 5;

/** Pide el motivo (obligatorio: lo ve el vendedor) y devuelve los censos.
 * Solo ADMIN. El botón que lo abre se pasa como datos (texto y estilo). */
function DevolverDialog({
  titulo,
  descripcion,
  boton,
  onDevolver,
}: {
  titulo: string;
  descripcion: string;
  boton: { texto: string; variante: "outline" | "ghost" };
  onDevolver: (motivo: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const valido = motivo.trim().length >= MOTIVO_MINIMO;

  async function devolver() {
    setEnviando(true);
    try {
      await onDevolver(motivo.trim());
      setOpen(false);
      setMotivo("");
    } catch (e) {
      toast.error(mensajeDeError(e, "No se pudo devolver"));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant={boton.variante}>
          <Undo2Icon /> {boton.texto}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
          <DialogDescription>{descripcion}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="motivo-devolucion">Motivo (lo verá el vendedor)</Label>
          <Textarea
            id="motivo-devolucion"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value.slice(0, 300))}
            placeholder="Ej.: el código no corresponde al comercio; vuelve a censarlo con el código correcto"
            rows={3}
          />
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={enviando}>
              Cancelar
            </Button>
          </DialogClose>
          <Button onClick={devolver} disabled={!valido || enviando}>
            {enviando ? <Loader2Icon className="animate-spin" /> : <Undo2Icon />} Devolver
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FilaCenso({
  censo,
  esAdmin,
  onCorregido,
  onDevolver,
}: {
  censo: CensoPorCorregir;
  esAdmin: boolean;
  onCorregido: (r: ResultadoCorreccion) => void;
  onDevolver: (motivo: string) => Promise<void>;
}) {
  const inicial = (censo.empresa ?? "").toUpperCase();
  const [empresa, setEmpresa] = useState<string>(EMPRESAS.includes(inicial as never) ? inicial : "");
  const [codigo, setCodigo] = useState(censo.codigoCliente ?? "");
  const [codigoIsvan, setCodigoIsvan] = useState(censo.codigoIsvan ?? (censo.categoria === "ambas" ? censo.codigoCliente ?? "" : ""));
  const [codigoTralog, setCodigoTralog] = useState(censo.codigoTralog ?? "");
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [guardando, setGuardando] = useState(false);

  function usar(s: SugerenciaMaestra) {
    if (empresa === "AMBAS") {
      if (s.empresa === "ISVAN") setCodigoIsvan(s.codigo);
      else setCodigoTralog(s.codigo);
    } else {
      setEmpresa(s.empresa);
      setCodigo(s.codigo);
    }
    setErrores({});
  }

  async function guardar(confiarEnCodigo = false) {
    setGuardando(true);
    setErrores({});
    try {
      const r = await apiPatch<ResultadoCorreccion>(`/clientes/censo-pendientes/${encodeURIComponent(censo.id)}`, {
        empresa,
        codigo: empresa === "AMBAS" ? null : codigo,
        codigoIsvan: empresa === "AMBAS" ? codigoIsvan : null,
        codigoTralog: empresa === "AMBAS" ? codigoTralog : null,
        confiarEnCodigo,
      });
      onCorregido(r);
    } catch (e) {
      const detalle = e instanceof ApiError ? (e.datos as { errores?: Record<string, string> } | undefined) : undefined;
      if (detalle?.errores) setErrores(detalle.errores);
      toast.error(mensajeDeError(e, "No se pudo corregir el censo"));
    } finally {
      setGuardando(false);
    }
  }

  const listo = empresa === "AMBAS" ? !!codigoIsvan && !!codigoTralog : !!empresa && !!codigo;
  const motivo = censo.claves.find((k) => k.motivo)?.motivo;
  const sinCambios =
    empresa === inicial &&
    (empresa === "AMBAS"
      ? codigoIsvan === (censo.codigoIsvan ?? "") && codigoTralog === (censo.codigoTralog ?? "")
      : codigo === (censo.codigoCliente ?? ""));

  return (
    <TableRow className="align-top">
      <TableCell className="min-w-56 whitespace-normal">
        {esAdmin ? (
          <Link href={`/censo/${censo.id}`} className="font-medium underline-offset-4 hover:underline">
            {censo.nombre ?? "Sin nombre"}
          </Link>
        ) : (
          <span className="font-medium">{censo.nombre ?? "Sin nombre"}</span>
        )}
        <span className="block text-xs text-muted-foreground">
          {[censo.tipoCliente, censo.rif && `RIF ${censo.rif}`, censo.telefono].filter(Boolean).join(" · ")}
        </span>
        <span className="block text-xs text-muted-foreground">
          {[censo.ruta, censo.encuestador, censo.fecha, censo.origen === "SURVEY123" ? "Survey123" : null]
            .filter(Boolean)
            .join(" · ")}
        </span>
        {censo.direccion && <span className="block text-xs text-muted-foreground">{censo.direccion}</span>}
      </TableCell>
      <TableCell className="min-w-56 whitespace-normal text-xs">
        {censo.claves.length > 0 && (
          <p className="tabular-nums">
            Hoy: {censo.claves.map((k) => `${k.empresa} ${k.codigo}`).join(" · ")}
          </p>
        )}
        {motivo && <p className="text-muted-foreground">{motivo}</p>}
        {censo.sugerencias.length > 0 && (
          <div className="mt-1.5 space-y-1">
            <p className="flex items-center gap-1 text-muted-foreground">
              <SparklesIcon className="size-3.5" /> En la maestra se parece a:
            </p>
            {censo.sugerencias.map((s) => (
              <button
                key={`${s.empresa}-${s.codigo}`}
                type="button"
                onClick={() => usar(s)}
                className="block w-full rounded-md border border-border px-2 py-1 text-left hover:bg-muted"
              >
                <span className="font-medium tabular-nums">
                  {s.empresa} {s.codigo}
                </span>{" "}
                {s.razonSocial}
                <span className="block text-muted-foreground">
                  Ruta {s.ruta}
                  {s.enSuRuta ? "" : " (otra ruta)"}
                  {s.yaCensado ? " · ya tiene otro censo" : ""}
                </span>
              </button>
            ))}
          </div>
        )}
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap items-start gap-2">
          <label className="flex flex-col gap-0.5 text-xs text-muted-foreground">
            Empresa
            <select
              value={empresa}
              onChange={(e) => {
                setEmpresa(e.target.value);
                setErrores({});
              }}
              aria-invalid={!!errores.empresa}
              className="h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground"
            >
              <option value="">Elegir…</option>
              {EMPRESAS.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </select>
          </label>
          {empresa === "AMBAS" ? (
            <>
              <CampoCodigo etiqueta="Código ISVAN" valor={codigoIsvan} onCambio={setCodigoIsvan} error={errores.codigoIsvan} />
              <CampoCodigo etiqueta="Código TRALOG" valor={codigoTralog} onCambio={setCodigoTralog} error={errores.codigoTralog} />
            </>
          ) : (
            <CampoCodigo etiqueta="Código" valor={codigo} onCambio={setCodigo} error={errores.codigo} />
          )}
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button size="sm" onClick={() => guardar()} disabled={!listo || guardando || (sinCambios && censo.categoria !== "sin_codigo")}>
            {guardando ? <Loader2Icon className="animate-spin" /> : <SaveIcon />} Guardar
          </Button>
          {censo.categoria === "revisar" && sinCambios && (
            <Button size="sm" variant="outline" onClick={() => guardar(true)} disabled={guardando}>
              <CheckIcon /> El código es correcto
            </Button>
          )}
          {esAdmin && (
            <DevolverDialog
              titulo="Devolver el censo al vendedor"
              descripcion={`${censo.nombre ?? "Este censo"} sale de la lista y deja de contar; ${
                censo.encuestador ?? "el vendedor"
              } lo verá con el motivo para censarlo de nuevo.`}
              boton={{ texto: "Devolver", variante: "ghost" }}
              onDevolver={onDevolver}
            />
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

function mensajeResultado(r: ResultadoCorreccion): { ok: boolean; titulo: string; detalle?: string } {
  const revisar = r.clientes.find((c) => c.accion === "REVISAR");
  if (revisar) return { ok: false, titulo: "Sigue pendiente", detalle: revisar.motivo ?? undefined };
  if (r.duplicadoDe) return { ok: true, titulo: "Corregido: era un duplicado de otro censo del mismo cliente" };
  const creados = r.clientes.filter((c) => c.accion === "CREADO").length;
  const completados = r.clientes.filter((c) => c.accion === "COMPLETADO").length;
  const partes = [
    creados && `${creados} cliente(s) creado(s)`,
    completados && `${completados} completado(s)`,
    r.clientesEliminados && `${r.clientesEliminados} cliente(s) con el código anterior eliminado(s)`,
  ].filter(Boolean);
  const detalle = partes.length ? partes.join(" · ") : "El cliente ya existía en el sistema.";
  if (r.categoria === "no_encontrado")
    return { ok: true, titulo: "Corregido, pero el código todavía no está en ventas", detalle };
  return { ok: true, titulo: "Censo corregido", detalle };
}

/** Los censos que no pudieron crear o completar su cliente por la empresa o
 * el código, para corregirlos aquí mismo: cada fila se edita y se guarda, y
 * el censo se vuelve a procesar (ver backend/app/services/censo_correccion.py). */
export function CensosPorCorregir({
  conteoInicial,
  esAdmin,
  onConteo,
}: {
  conteoInicial: ConteoCorreccion;
  esAdmin: boolean;
  onConteo: (c: ConteoCorreccion) => void;
}) {
  const primera = CATEGORIAS_CORRECCION.find((c) => conteoInicial[c] > 0) ?? "revisar";
  const [categoria, setCategoria] = useState<CategoriaCorreccion>(primera);
  const [pagina, setPagina] = useState(1);
  const [busqueda, setBusqueda] = useState("");
  const [q, setQ] = useState("");
  // Subirla vuelve a pedir la página (después de corregir un censo).
  const [version, setVersion] = useState(0);
  const consulta = `categoria=${categoria}&pagina=${pagina}${q ? `&q=${encodeURIComponent(q)}` : ""}#${version}`;
  const [respuesta, setRespuesta] = useState<{ consulta: string; datos: CensosPorCorregir } | null>(null);
  const datos = respuesta?.datos ?? null;
  const cargando = respuesta?.consulta !== consulta;

  useEffect(() => {
    let vigente = true;
    apiGet<CensosPorCorregir>(`/clientes/censo-pendientes?${consulta.split("#")[0]}`)
      .then((r) => {
        if (!vigente) return;
        setRespuesta({ consulta, datos: r });
        onConteo(r.conteo);
      })
      .catch((e) => {
        if (vigente) toast.error(mensajeDeError(e, "No se pudieron cargar los censos"));
      });
    return () => {
      vigente = false;
    };
  }, [consulta, onConteo]);

  async function devolver(cuerpo: { ids?: string[]; todos?: boolean }, motivo: string) {
    const r = await apiPost<ResultadoDevolucion>("/clientes/censo-pendientes/devolver", {
      ...cuerpo,
      categoria,
      q: q || null,
      motivo,
    });
    setVersion((v) => v + 1);
    const plural = r.devueltos === 1 ? "" : "s";
    toast.success(`${formatNumero(r.devueltos)} censo${plural} devuelto${plural} al vendedor`, {
      description: r.clientesEliminados
        ? `${formatNumero(r.clientesEliminados)} cliente(s) que había creado se eliminaron.`
        : undefined,
      duration: 15000,
      action: {
        label: "Deshacer",
        onClick: async () => {
          try {
            await apiPost(`/clientes/censo-pendientes/devolver/${encodeURIComponent(r.lote)}/deshacer`);
            toast.success("Devolución deshecha: los censos volvieron a la lista");
          } catch (e) {
            toast.error(mensajeDeError(e, "No se pudo deshacer"));
          }
          setVersion((v) => v + 1);
        },
      },
    });
  }

  function corregido(r: ResultadoCorreccion) {
    const m = mensajeResultado(r);
    if (m.ok) toast.success(m.titulo, { description: m.detalle });
    else toast.warning(m.titulo, { description: m.detalle, duration: 10000 });
    setVersion((v) => v + 1);
  }

  const conteo = datos?.conteo ?? conteoInicial;
  const paginas = datos ? Math.max(1, Math.ceil(datos.total / datos.porPagina)) : 1;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {CATEGORIAS_CORRECCION.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => {
              setCategoria(c);
              setPagina(1);
            }}
            aria-pressed={categoria === c}
            className={cn(
              "rounded-full border px-3 py-1 text-sm",
              categoria === c ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:bg-muted"
            )}
          >
            {CATEGORIA[c].titulo} <span className="tabular-nums">({formatNumero(conteo[c])})</span>
          </button>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">{CATEGORIA[categoria].ayuda}</p>
      {datos && !datos.hayMaestra && (
        <p className="text-sm text-muted-foreground">
          Sin maestra de clientes cargada no hay sugerencias: se cargan desde el censo.
        </p>
      )}

      <Card>
        <CardContent className="space-y-3">
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setQ(busqueda.trim());
              setPagina(1);
            }}
          >
            <span className="relative min-w-56 flex-1">
              <SearchIcon className="absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
              <Input
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Comercio, RIF, código, ruta o vendedor"
                className="pl-8"
                aria-label="Buscar censos por corregir"
              />
            </span>
            <Button type="submit" variant="outline">
              <SearchIcon /> Buscar
            </Button>
            {cargando && <Loader2Icon className="mb-2.5 size-4 animate-spin text-muted-foreground" />}
            {esAdmin && datos && datos.total > 0 && !cargando && (
              <span className="ml-auto">
                <DevolverDialog
                  titulo={`Devolver ${formatNumero(datos.total)} censo${datos.total === 1 ? "" : "s"} a sus vendedores`}
                  descripcion={`Todos los de “${CATEGORIA[categoria].titulo}”${
                    q ? ` que coinciden con “${q}”` : ""
                  }, en todas las páginas. Salen de la lista y dejan de contar; cada vendedor los verá con este motivo para censarlos de nuevo.`}
                  boton={{ texto: `Devolver todos (${formatNumero(datos.total)})`, variante: "outline" }}
                  onDevolver={(motivo) => devolver({ todos: true }, motivo)}
                />
              </span>
            )}
          </form>

          {datos && datos.censos.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {q ? "Ningún censo coincide con la búsqueda." : "Nada por corregir en esta categoría."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Comercio censado</TableHead>
                    <TableHead>Problema</TableHead>
                    <TableHead>Corrección</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {datos?.censos.map((c) => (
                    <FilaCenso
                      key={`${c.id}-${c.categoria}`}
                      censo={c}
                      esAdmin={esAdmin}
                      onCorregido={corregido}
                      onDevolver={(motivo) => devolver({ ids: [c.id] }, motivo)}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {datos && paginas > 1 && (
            <div className="flex items-center justify-end gap-2 text-sm">
              <Button variant="outline" size="sm" disabled={pagina <= 1 || cargando} onClick={() => setPagina(pagina - 1)}>
                <ChevronLeftIcon /> Anterior
              </Button>
              <span className="tabular-nums text-muted-foreground">
                Página {pagina} de {paginas} · {formatNumero(datos.total)} censos
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={pagina >= paginas || cargando}
                onClick={() => setPagina(pagina + 1)}
              >
                Siguiente <ChevronRightIcon />
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
