/**
 * El formulario en el navegador: qué preguntas se ven, qué opciones ofrece
 * cada lista y qué errores mostrar. Es el mismo algoritmo que valida el
 * servidor (backend/app/services/formulario.py) sobre el mismo lenguaje de
 * expresiones (./expresiones.ts).
 */

import { comoBooleano, evaluarTexto, verdadero, type Contexto, type Valor } from "./expresiones";

// ---------- La definición (backend/app/formularios/<id>.json) ----------

export type TipoPregunta =
  | "text"
  | "integer"
  | "decimal"
  | "date"
  | "time"
  | "dateTime"
  | "geopoint"
  | "image"
  | "note"
  | "calculate"
  | "hidden"
  | "select_one"
  | "select_multiple";

export type Pregunta = {
  type: TipoPregunta;
  name: string;
  list?: string;
  /** Las etiquetas y ayudas pueden traer un poco de HTML ya limpio (ver
   * limpiar_html en backend/app/services/xlsform.py). */
  label?: string;
  hint?: string;
  guidance_hint?: string;
  appearance?: string;
  required: boolean;
  required_message?: string;
  readonly: boolean;
  default?: string;
  /** today() o now(): se llena al abrir el formulario. */
  default_dinamico?: string;
  calculation?: string;
  constraint?: string;
  constraint_message?: string;
  relevant?: string;
  choice_filter?: string;
  field_length?: number;
  /** Todas las columnas de la fila del XLSForm, tal cual. */
  xlsform: Record<string, string>;
};

export type Grupo = {
  type: "group";
  name: string | null;
  label?: string;
  relevant?: string;
  appearance?: string;
  children: Nodo[];
};

export type Nodo = Pregunta | Grupo;

export type Opcion = { name: string; label: string; extra: Record<string, string> };

export type DefinicionFormulario = {
  id: string;
  title: string;
  version: string;
  settings: Record<string, string>;
  children: Nodo[];
  choices: Record<string, Opcion[]>;
};

export type Respuestas = Record<string, Valor>;

export const esGrupo = (n: Nodo): n is Grupo => n.type === "group";

/** Las preguntas en orden, cada una con los grupos que la contienen. */
export function preguntasDe(def: DefinicionFormulario): { pregunta: Pregunta; grupos: Grupo[] }[] {
  const salida: { pregunta: Pregunta; grupos: Grupo[] }[] = [];
  const recorrer = (nodos: Nodo[], grupos: Grupo[]) => {
    for (const n of nodos) {
      if (esGrupo(n)) recorrer(n.children, [...grupos, n]);
      else salida.push({ pregunta: n, grupos });
    }
  };
  recorrer(def.children, []);
  return salida;
}

/** Lo que la persona no llena: hidden, calculate, con cálculo o con un
 * default de hoy/ahora y solo lectura. */
export function esAutomatica(p: Pregunta): boolean {
  return (
    p.type === "calculate" ||
    p.type === "hidden" ||
    Boolean(p.calculation) ||
    (p.readonly && Boolean(p.default_dinamico)) ||
    p.appearance === "hidden"
  );
}

export function vacio(valor: Valor): boolean {
  return (
    valor === null ||
    valor === undefined ||
    valor === "" ||
    (Array.isArray(valor) && valor.length === 0) ||
    (typeof valor === "number" && Number.isNaN(valor))
  );
}

// ---------- Relevancia ----------

/** Qué preguntas son relevantes y las respuestas sin las que no lo son.
 * Se repite hasta que no cambie nada: descartar una respuesta puede apagar
 * otra pregunta que dependía de ella. */
export function aplicarRelevancia(
  def: DefinicionFormulario,
  respuestas: Respuestas,
  ctxBase: Omit<Contexto, "respuestas"> = {}
): { relevantes: Set<string>; valores: Respuestas; gruposVisibles: Set<Grupo> } {
  const preguntas = preguntasDe(def);
  const valores: Respuestas = { ...respuestas };
  const ctx: Contexto = { ...ctxBase, respuestas: valores };
  let relevantes = new Set<string>();
  for (let vuelta = 0; vuelta <= preguntas.length; vuelta++) {
    const nuevas = new Set<string>();
    let cambio = false;
    for (const { pregunta, grupos } of preguntas) {
      const visible = grupos.every((g) => verdadero(g.relevant, ctx)) && verdadero(pregunta.relevant, ctx);
      if (visible) nuevas.add(pregunta.name);
      if (visible !== relevantes.has(pregunta.name)) cambio = true;
      if (!visible && !vacio(valores[pregunta.name])) {
        valores[pregunta.name] = null;
        cambio = true;
      }
    }
    relevantes = nuevas;
    if (!cambio) break;
  }
  const gruposVisibles = new Set<Grupo>();
  const marcar = (nodos: Nodo[]): boolean => {
    let alguna = false;
    for (const n of nodos) {
      if (esGrupo(n)) {
        if (marcar(n.children)) {
          gruposVisibles.add(n);
          alguna = true;
        }
      } else if (relevantes.has(n.name) && !esAutomatica(n)) {
        alguna = true;
      }
    }
    return alguna;
  };
  marcar(def.children);
  return { relevantes, valores, gruposVisibles };
}

// ---------- Opciones ----------

export function opcionesDe(def: DefinicionFormulario, p: Pregunta, respuestas: Respuestas): Opcion[] {
  const opciones = p.list ? (def.choices[p.list] ?? []) : [];
  if (!p.choice_filter) return opciones;
  return opciones.filter((o) =>
    comoBooleano(
      evaluarTexto(p.choice_filter!, {
        respuestas,
        variables: { name: o.name, label: o.label, ...o.extra },
      })
    )
  );
}

// ---------- Validación ----------

export const MENSAJE_REQUERIDO = "Este campo es obligatorio";
export const MENSAJE_RESTRICCION = "El valor no es válido";

/** Los errores de las preguntas relevantes que llena la persona (las fotos
 * se cuentan aparte: su valor es el archivo elegido). */
export function validar(
  def: DefinicionFormulario,
  respuestas: Respuestas,
  ctxBase: Omit<Contexto, "respuestas"> = {}
): Record<string, string> {
  const { relevantes, valores } = aplicarRelevancia(def, respuestas, ctxBase);
  const errores: Record<string, string> = {};
  for (const { pregunta: p } of preguntasDe(def)) {
    if (!relevantes.has(p.name) || esAutomatica(p)) continue;
    const valor = valores[p.name];
    if (vacio(valor)) {
      if (p.required) errores[p.name] = p.required_message || MENSAJE_REQUERIDO;
      continue;
    }
    if (p.type === "integer" && !Number.isInteger(Number(valor))) {
      errores[p.name] = "Escribe un número entero";
      continue;
    }
    if (p.field_length && typeof valor === "string" && valor.length > p.field_length) {
      errores[p.name] = `Máximo ${p.field_length} caracteres`;
      continue;
    }
    if (p.list) {
      const validas = new Set(opcionesDe(def, p, valores).map((o) => o.name));
      const elegidas = Array.isArray(valor) ? valor : [String(valor)];
      if (elegidas.some((v) => !validas.has(v))) {
        errores[p.name] = "Elige una opción de la lista";
        continue;
      }
    }
    if (p.constraint && !verdadero(p.constraint, { ...ctxBase, respuestas: valores, actual: valor })) {
      errores[p.name] = p.constraint_message || MENSAJE_RESTRICCION;
    }
  }
  return errores;
}
