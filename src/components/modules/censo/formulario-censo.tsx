"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2Icon, SendIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ApiError, apiPost, mensajeDeError } from "@/lib/api-client";
import type { Valor } from "@/lib/formulario/expresiones";
import {
  aplicarRelevancia,
  esAutomatica,
  esGrupo,
  opcionesDe,
  preguntasDe,
  vacio,
  validar,
  type DefinicionFormulario,
  type Grupo,
  type Nodo,
  type Pregunta,
  type Respuestas,
} from "@/lib/formulario/motor";
import { Campo } from "./campos";
import { HtmlLimpio, textoPlano } from "./html-limpio";

const dos = (n: number) => String(n).padStart(2, "0");
const fechaLocal = (d: Date) => `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
const horaLocal = (d: Date) => `${dos(d.getHours())}:${dos(d.getMinutes())}:${dos(d.getSeconds())}`;
const normalizar = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

/** Lo que el formulario trae puesto al abrirse: los default de hoy/ahora
 * (fecha y hora de la encuesta), los default fijos, y el encuestador si el
 * usuario de la app figura con el mismo nombre en la lista de la encuesta. */
function iniciales(def: DefinicionFormulario, nombreUsuario: string, ahora: Date, previas: Respuestas = {}): Respuestas {
  const valores: Respuestas = {};
  for (const { pregunta: p } of preguntasDe(def)) {
    if (p.default_dinamico === "today()") valores[p.name] = fechaLocal(ahora);
    else if (p.default_dinamico === "now()") valores[p.name] = horaLocal(ahora);
    else if (p.default !== undefined) valores[p.name] = p.default;
    if (p.list === "encuestador") {
      const propia = def.choices.encuestador?.find((o) => normalizar(textoPlano(o.label)) === normalizar(nombreUsuario));
      valores[p.name] = previas[p.name] ?? propia?.name ?? valores[p.name] ?? null;
    }
  }
  return valores;
}

/** Si al cambiar una respuesta una opción deja de ser válida en otra lista
 * (cambió el estado y el municipio elegido ya no es de ese estado), se borra. */
function ajustarOpciones(def: DefinicionFormulario, respuestas: Respuestas): Respuestas {
  const salida = { ...respuestas };
  for (const { pregunta: p } of preguntasDe(def)) {
    if (!p.list || !p.choice_filter || vacio(salida[p.name])) continue;
    const validas = new Set(opcionesDe(def, p, salida).map((o) => o.name));
    const valor = salida[p.name];
    if (Array.isArray(valor)) {
      const quedan = valor.filter((v) => validas.has(v));
      if (quedan.length !== valor.length) salida[p.name] = quedan;
    } else if (!validas.has(String(valor))) {
      salida[p.name] = null;
    }
  }
  return salida;
}

function sin<T>(objeto: Record<string, T>, clave: string): Record<string, T> {
  const copia = { ...objeto };
  delete copia[clave];
  return copia;
}

/** Los nodos de un nivel, con las preguntas sueltas consecutivas juntas. */
function tramos(nodos: Nodo[]): (Grupo | Pregunta[])[] {
  return nodos.reduce<(Grupo | Pregunta[])[]>((salida, n) => {
    const ultimo = salida[salida.length - 1];
    if (esGrupo(n)) return [...salida, n];
    if (Array.isArray(ultimo)) return [...salida.slice(0, -1), [...ultimo, n]];
    return [...salida, [n]];
  }, []);
}

type EnlaceSubida = { clave: string; url: string; metodo: string; cabeceras: Record<string, string>; conSesion: boolean };

/** Sube una foto directo al almacenamiento con un enlace firmado por el
 * backend (que fija su tipo y su tamaño): así no pasa por Vercel, que corta
 * todo lo que supere los 4,5 MB. */
async function subirFoto(pregunta: string, foto: File): Promise<string> {
  const enlace = await apiPost<EnlaceSubida>("/censo/fotos/subida", { pregunta, tipo: foto.type, bytes: foto.size });
  const respuesta = await fetch(enlace.url, {
    method: enlace.metodo,
    headers: enlace.cabeceras,
    body: foto,
    credentials: enlace.conSesion ? "include" : "omit",
  });
  if (!respuesta.ok) throw new Error(`No se pudo subir la foto (error ${respuesta.status}). Revisa la conexión y vuelve a intentar.`);
  return enlace.clave;
}

export function FormularioCenso({ definicion, nombreUsuario }: { definicion: DefinicionFormulario; nombreUsuario: string }) {
  const router = useRouter();
  const [inicio, setInicio] = useState(() => new Date());
  const [respuestas, setRespuestas] = useState<Respuestas>(() => iniciales(definicion, nombreUsuario, new Date()));
  const [fotos, setFotos] = useState<Record<string, File>>({});
  const [tocadas, setTocadas] = useState<Set<string>>(new Set());
  const [intento, setIntento] = useState(false);
  const [erroresServidor, setErroresServidor] = useState<Record<string, string>>({});
  const [enviando, setEnviando] = useState(false);
  const [progreso, setProgreso] = useState<string | null>(null);
  // Las fotos ya subidas, con su clave: si el envío falla (un campo mal),
  // al reintentar no se vuelven a subir.
  const subidas = useRef(new WeakMap<File, string>());
  // Al limpiar el formulario se vuelven a montar los campos (vistas previas
  // de las fotos, avisos del GPS).
  const [vuelta, setVuelta] = useState(0);

  const { relevantes, valores, gruposVisibles } = useMemo(
    () => aplicarRelevancia(definicion, respuestas),
    [definicion, respuestas]
  );
  // Una foto es el archivo elegido, que no vive en las respuestas: para
  // validar cuenta como respondida (si no, una foto obligatoria nunca se
  // daría por llenada y el censo no se podría enviar).
  const errores = useMemo(
    () =>
      validar(definicion, {
        ...respuestas,
        ...Object.fromEntries(Object.entries(fotos).map(([nombre, archivo]) => [nombre, archivo.name])),
      }),
    [definicion, respuestas, fotos]
  );
  const sucio = tocadas.size > 0;

  // Un censo a medias no se pierde por cerrar la pestaña sin querer.
  useEffect(() => {
    if (!sucio) return;
    const avisar = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", avisar);
    return () => window.removeEventListener("beforeunload", avisar);
  }, [sucio]);

  function cambiar(nombre: string, valor: Valor) {
    setRespuestas((previas) => ajustarOpciones(definicion, { ...previas, [nombre]: valor }));
    setTocadas((previas) => (previas.has(nombre) ? previas : new Set(previas).add(nombre)));
    setErroresServidor((previos) => (nombre in previos ? sin(previos, nombre) : previos));
  }

  function errorDe(nombre: string): string | undefined {
    return erroresServidor[nombre] ?? ((intento || tocadas.has(nombre)) ? errores[nombre] : undefined);
  }

  function limpiar() {
    const ahora = new Date();
    setInicio(ahora);
    setRespuestas(iniciales(definicion, nombreUsuario, ahora, respuestas));
    setFotos({});
    subidas.current = new WeakMap();
    setTocadas(new Set());
    setIntento(false);
    setErroresServidor({});
    setVuelta((v) => v + 1);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function enviar() {
    setIntento(true);
    const pendientes = Object.keys(errores);
    if (pendientes.length) {
      toast.error(pendientes.length === 1 ? "Falta completar 1 campo" : `Faltan completar ${pendientes.length} campos`);
      document.querySelector(`[data-pregunta="${pendientes[0]}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    const preguntas = preguntasDe(definicion).map((x) => x.pregunta);
    const enviadas: Respuestas = {};
    for (const p of preguntas) {
      if (p.type === "image" || !relevantes.has(p.name) || vacio(valores[p.name])) continue;
      enviadas[p.name] = valores[p.name];
    }
    const porSubir = preguntas.filter((p) => p.type === "image" && fotos[p.name] && relevantes.has(p.name));
    setEnviando(true);
    try {
      // Las fotos van directo al almacenamiento (ver subirFoto); al censo
      // solo viaja la clave de cada una.
      const claves: Record<string, string> = {};
      for (const [i, p] of porSubir.entries()) {
        setProgreso(`Subiendo fotos (${i + 1} de ${porSubir.length})…`);
        const foto = fotos[p.name];
        claves[p.name] = subidas.current.get(foto) ?? (await subirFoto(p.name, foto));
        subidas.current.set(foto, claves[p.name]);
      }
      setProgreso("Enviando…");
      await apiPost("/censo", {
        respuestas: enviadas,
        fotos: claves,
        iniciadoEn: inicio.toISOString(),
        terminadoEn: new Date().toISOString(),
      });
      toast.success("Censo enviado");
      limpiar();
      router.refresh();
    } catch (e) {
      const detalle = e instanceof ApiError ? (e.datos as { errores?: Record<string, string> } | undefined) : undefined;
      if (detalle?.errores) {
        setErroresServidor(detalle.errores);
        const primero = Object.keys(detalle.errores)[0];
        document.querySelector(`[data-pregunta="${primero}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      toast.error(mensajeDeError(e, "No se pudo enviar el censo"));
    } finally {
      setEnviando(false);
      setProgreso(null);
    }
  }

  function campo(p: Pregunta) {
    if (!relevantes.has(p.name) || esAutomatica(p)) return null;
    return (
      <Campo
        key={`${p.name}-${vuelta}`}
        pregunta={p}
        opciones={p.list ? opcionesDe(definicion, p, valores) : []}
        valor={valores[p.name]}
        error={errorDe(p.name)}
        onCambio={(v) => cambiar(p.name, v)}
        archivo={fotos[p.name] ?? null}
        onArchivo={(f) => setFotos((previas) => (f ? { ...previas, [p.name]: f } : sin(previas, p.name)))}
      />
    );
  }

  // Las preguntas sueltas (fuera de grupo) van juntas en una tarjeta sin
  // título; cada grupo, en la suya.
  function bloques(nodos: Nodo[]) {
    return tramos(nodos).map((tramo, i) => {
      if (!Array.isArray(tramo)) return gruposVisibles.has(tramo) ? grupo(tramo) : null;
      const visibles = tramo.map(campo).filter(Boolean);
      return visibles.length ? (
        <Card key={`sueltas-${i}`}>
          <CardContent className="space-y-6 py-5">{visibles}</CardContent>
        </Card>
      ) : null;
    });
  }

  function grupo(g: Grupo) {
    const internos = g.children.map((n) => (esGrupo(n) ? (gruposVisibles.has(n) ? grupo(n) : null) : campo(n)));
    return (
      <Card key={g.name ?? g.label ?? "grupo"}>
        {g.label && (
          <CardHeader>
            <CardTitle>
              <HtmlLimpio html={g.label} />
            </CardTitle>
          </CardHeader>
        )}
        <CardContent className="space-y-6">{internos}</CardContent>
      </Card>
    );
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void enviar();
      }}
      noValidate
    >
      {bloques(definicion.children)}
      <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center justify-end gap-2 border-t bg-background/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-lg sm:border">
        {sucio && (
          <Button type="button" variant="ghost" onClick={limpiar} disabled={enviando}>
            Empezar de nuevo
          </Button>
        )}
        <Button type="submit" disabled={enviando}>
          {enviando ? <Loader2Icon className="animate-spin" /> : <SendIcon />}
          {enviando ? (progreso ?? "Enviando…") : "Enviar censo"}
        </Button>
      </div>
    </form>
  );
}
