/**
 * Expresiones de XLSForm (relevant, constraint, calculation, choice_filter),
 * con la semántica de ArcGIS Survey123.
 *
 * Es el mismo lenguaje que valida el servidor en
 * backend/app/services/xlsform_expresiones.py: el navegador decide qué
 * preguntas se ven y el servidor lo vuelve a comprobar al recibir el censo.
 * Cualquier cambio aquí va también allá (las pruebas de paridad corren los
 * mismos casos en los dos).
 *
 * Una selección múltiple vale, como texto, sus opciones separadas por coma:
 * `${marcas} = "Otros"` solo es verdad si "Otros" es la única marcada; para
 * "está marcada" se usa selected(${marcas}, "Otros").
 */

export type Valor = string | number | boolean | string[] | { lat: number; lng: number; precision?: number } | null | undefined;

export type Contexto = {
  respuestas: Record<string, Valor>;
  /** El valor de `.` (la pregunta que se valida). */
  actual?: Valor;
  /** Nombres sueltos: columnas de una opción, end_hour, end_hh_mm_ss. */
  variables?: Record<string, Valor>;
  hoy?: string;
  ahora?: string;
};

export class ErrorExpresion extends Error {}

type Token = { tipo: "ref" | "num" | "str" | "op" | "punto" | "ident" | "fin"; valor: string };

const TOKEN =
  /\s*(?:(\$\{\s*([A-Za-z_][\w.-]*)\s*\})|(\d+(?:\.\d+)?)|("[^"]*"|'[^']*')|(==|!=|<=|>=|=|<|>|\(|\)|,|\+|-|\*)|(\.(?!\w))|([A-Za-z_][\w-]*))/y;

export function tokenizar(texto: string): Token[] {
  const tokens: Token[] = [];
  const fuente = texto ?? "";
  let pos = 0;
  while (pos < fuente.length) {
    if (fuente.slice(pos).trim() === "") break;
    TOKEN.lastIndex = pos;
    const m = TOKEN.exec(fuente);
    if (!m || TOKEN.lastIndex === pos) {
      throw new ErrorExpresion(`No se entiende la expresión cerca de: ${JSON.stringify(fuente.slice(pos, pos + 20))}`);
    }
    pos = TOKEN.lastIndex;
    if (m[1]) tokens.push({ tipo: "ref", valor: m[2] });
    else if (m[3]) tokens.push({ tipo: "num", valor: m[3] });
    else if (m[4]) tokens.push({ tipo: "str", valor: m[4].slice(1, -1) });
    else if (m[5]) tokens.push({ tipo: "op", valor: m[5] });
    else if (m[6]) tokens.push({ tipo: "punto", valor: "." });
    else {
      const palabra = m[7];
      tokens.push(["and", "or", "div", "mod"].includes(palabra) ? { tipo: "op", valor: palabra } : { tipo: "ident", valor: palabra });
    }
  }
  tokens.push({ tipo: "fin", valor: "" });
  return tokens;
}

const FUNCIONES: Record<string, [number, number | null]> = {
  selected: [2, 2],
  "count-selected": [1, 1],
  "string-length": [0, 1],
  not: [1, 1],
  if: [3, 3],
  concat: [0, null],
  coalesce: [2, null],
  number: [1, 1],
  int: [1, 1],
  today: [0, 0],
  now: [0, 0],
};

export type Nodo =
  | { tipo: "lit"; valor: string | number | boolean }
  | { tipo: "ref"; valor: string }
  | { tipo: "punto" }
  | { tipo: "nombre"; valor: string }
  | { tipo: "neg"; hijo: Nodo }
  | { tipo: "op"; op: string; a: Nodo; b: Nodo }
  | { tipo: "fn"; nombre: string; args: Nodo[] };

export function analizar(texto: string): Nodo {
  const t = tokenizar(texto);
  let i = 0;
  const ver = () => t[i];
  const tomar = () => t[i++];
  const esOp = (...ops: string[]) => ver().tipo === "op" && ops.includes(ver().valor);
  const esperar = (op: string) => {
    const tok = tomar();
    if (tok.tipo !== "op" || tok.valor !== op) throw new ErrorExpresion(`Se esperaba '${op}' y vino '${tok.valor}'`);
  };

  const expresion = (): Nodo => o();
  const o = (): Nodo => {
    let n = y();
    while (esOp("or")) {
      tomar();
      n = { tipo: "op", op: "or", a: n, b: y() };
    }
    return n;
  };
  const y = (): Nodo => {
    let n = comparacion();
    while (esOp("and")) {
      tomar();
      n = { tipo: "op", op: "and", a: n, b: comparacion() };
    }
    return n;
  };
  const comparacion = (): Nodo => {
    let n = suma();
    while (esOp("=", "==", "!=", "<", "<=", ">", ">=")) {
      const op = tomar().valor;
      n = { tipo: "op", op: op === "==" ? "=" : op, a: n, b: suma() };
    }
    return n;
  };
  const suma = (): Nodo => {
    let n = producto();
    while (esOp("+", "-")) {
      const op = tomar().valor;
      n = { tipo: "op", op, a: n, b: producto() };
    }
    return n;
  };
  const producto = (): Nodo => {
    let n = unario();
    while (esOp("*", "div", "mod")) {
      const op = tomar().valor;
      n = { tipo: "op", op, a: n, b: unario() };
    }
    return n;
  };
  const unario = (): Nodo => {
    if (esOp("-")) {
      tomar();
      return { tipo: "neg", hijo: unario() };
    }
    return primario();
  };
  const primario = (): Nodo => {
    const tok = tomar();
    if (tok.tipo === "num") return { tipo: "lit", valor: Number(tok.valor) };
    if (tok.tipo === "str") return { tipo: "lit", valor: tok.valor };
    if (tok.tipo === "ref") return { tipo: "ref", valor: tok.valor };
    if (tok.tipo === "punto") return { tipo: "punto" };
    if (tok.tipo === "op" && tok.valor === "(") {
      const n = expresion();
      esperar(")");
      return n;
    }
    if (tok.tipo === "ident") {
      if (esOp("(")) {
        tomar();
        const args: Nodo[] = [];
        if (!esOp(")")) {
          args.push(expresion());
          while (esOp(",")) {
            tomar();
            args.push(expresion());
          }
        }
        esperar(")");
        const aridad = FUNCIONES[tok.valor];
        if (!aridad) throw new ErrorExpresion(`Función no soportada: ${tok.valor}()`);
        const [minimo, maximo] = aridad;
        if (args.length < minimo || (maximo !== null && args.length > maximo)) {
          throw new ErrorExpresion(`${tok.valor}() recibe una cantidad de argumentos inválida`);
        }
        return { tipo: "fn", nombre: tok.valor, args };
      }
      if (tok.valor === "true" || tok.valor === "false") return { tipo: "lit", valor: tok.valor === "true" };
      return { tipo: "nombre", valor: tok.valor };
    }
    throw new ErrorExpresion(`No se esperaba '${tok.valor}'`);
  };

  const nodo = expresion();
  if (ver().tipo !== "fin") throw new ErrorExpresion(`Sobra texto en la expresión: '${ver().valor}'`);
  return nodo;
}

// ---------- Conversiones (las mismas del servidor) ----------

export function comoTexto(valor: Valor): string {
  if (valor === null || valor === undefined) return "";
  if (typeof valor === "boolean") return valor ? "true" : "false";
  if (Array.isArray(valor)) return valor.map((v) => comoTexto(v)).join(",");
  if (typeof valor === "object") return `${valor.lat} ${valor.lng}`;
  if (typeof valor === "number") return Number.isInteger(valor) ? String(valor) : String(valor);
  return valor;
}

export function comoNumero(valor: Valor): number {
  if (typeof valor === "boolean") return valor ? 1 : 0;
  if (typeof valor === "number") return valor;
  const texto = comoTexto(valor).trim();
  if (texto === "") return NaN;
  const n = Number(texto);
  return Number.isFinite(n) ? n : NaN;
}

export function comoBooleano(valor: Valor): boolean {
  if (typeof valor === "boolean") return valor;
  if (typeof valor === "number") return valor !== 0 && !Number.isNaN(valor);
  if (Array.isArray(valor)) return valor.length > 0;
  return comoTexto(valor) !== "";
}

function lista(valor: Valor): string[] {
  if (Array.isArray(valor)) return valor.map((v) => comoTexto(v));
  const texto = comoTexto(valor);
  return texto ? texto.split(",").filter(Boolean) : [];
}

function esNumero(valor: Valor): boolean {
  if (typeof valor === "boolean") return false;
  if (typeof valor === "number") return true;
  return /^-?\d+(\.\d+)?$/.test(comoTexto(valor).trim());
}

function comparar(op: string, a: Valor, b: Valor): boolean {
  const numerico = esNumero(a) && esNumero(b);
  const x = numerico ? comoNumero(a) : comoTexto(a);
  const y = numerico ? comoNumero(b) : comoTexto(b);
  switch (op) {
    case "=":
      return x === y;
    case "!=":
      return x !== y;
    case "<":
      return x < y;
    case "<=":
      return x <= y;
    case ">":
      return x > y;
    default:
      return x >= y;
  }
}

export function evaluar(nodo: Nodo, ctx: Contexto): Valor {
  switch (nodo.tipo) {
    case "lit":
      return nodo.valor;
    case "ref":
      return ctx.respuestas[nodo.valor];
    case "punto":
      return ctx.actual;
    case "nombre":
      if (nodo.valor === "string_length") return comoTexto(ctx.actual).length;
      if (ctx.variables && nodo.valor in ctx.variables) return ctx.variables[nodo.valor];
      throw new ErrorExpresion(`Nombre desconocido: ${nodo.valor}`);
    case "neg":
      return -comoNumero(evaluar(nodo.hijo, ctx));
    case "op": {
      if (nodo.op === "or") return comoBooleano(evaluar(nodo.a, ctx)) || comoBooleano(evaluar(nodo.b, ctx));
      if (nodo.op === "and") return comoBooleano(evaluar(nodo.a, ctx)) && comoBooleano(evaluar(nodo.b, ctx));
      const a = evaluar(nodo.a, ctx);
      const b = evaluar(nodo.b, ctx);
      if (["=", "!=", "<", "<=", ">", ">="].includes(nodo.op)) return comparar(nodo.op, a, b);
      const x = comoNumero(a);
      const y = comoNumero(b);
      if (nodo.op === "+") return x + y;
      if (nodo.op === "-") return x - y;
      if (nodo.op === "*") return x * y;
      if (nodo.op === "div") return y ? x / y : NaN;
      return y ? x % y : NaN;
    }
    case "fn": {
      const args = nodo.args;
      switch (nodo.nombre) {
        case "selected":
          return lista(evaluar(args[0], ctx)).includes(comoTexto(evaluar(args[1], ctx)));
        case "count-selected":
          return lista(evaluar(args[0], ctx)).length;
        case "string-length":
          return comoTexto(args.length ? evaluar(args[0], ctx) : ctx.actual).length;
        case "not":
          return !comoBooleano(evaluar(args[0], ctx));
        case "if":
          return comoBooleano(evaluar(args[0], ctx)) ? evaluar(args[1], ctx) : evaluar(args[2], ctx);
        case "concat":
          return args.map((a) => comoTexto(evaluar(a, ctx))).join("");
        case "coalesce":
          for (const a of args) {
            const v = evaluar(a, ctx);
            if (comoTexto(v) !== "") return v;
          }
          return "";
        case "number":
          return comoNumero(evaluar(args[0], ctx));
        case "int": {
          const n = comoNumero(evaluar(args[0], ctx));
          return Number.isNaN(n) ? n : Math.trunc(n);
        }
        case "today":
          return ctx.hoy ?? "";
        case "now":
          return ctx.ahora ?? "";
      }
      throw new ErrorExpresion(`Función no soportada: ${nodo.nombre}()`);
    }
  }
}

const CACHE = new Map<string, Nodo>();

/** Para relevant y constraint: sin expresión, siempre verdadero. Las
 * expresiones se analizan una sola vez (el formulario re-evalúa a cada tecla). */
export function verdadero(texto: string | undefined | null, ctx: Contexto): boolean {
  if (!texto || !texto.trim()) return true;
  return comoBooleano(evaluarTexto(texto, ctx));
}

export function evaluarTexto(texto: string, ctx: Contexto): Valor {
  let nodo = CACHE.get(texto);
  if (!nodo) {
    nodo = analizar(texto);
    CACHE.set(texto, nodo);
  }
  return evaluar(nodo, ctx);
}
