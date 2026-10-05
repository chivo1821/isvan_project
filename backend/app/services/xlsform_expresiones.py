"""Expresiones de XLSForm (relevant, constraint, calculation, choice_filter,
default), con la semantica de ArcGIS Survey123.

Es el mismo lenguaje que evalua el navegador en
src/lib/formulario/expresiones.ts: los dos tienen que dar lo mismo, porque el
navegador decide que preguntas se ven y el servidor vuelve a validar todo al
recibir el censo (nadie puede saltarse un campo obligatorio armando el envio
a mano). Cualquier cambio aca va tambien alla.

Lo que soporta:

- Valores: `${pregunta}`, `.` (el valor de la pregunta que se valida),
  textos entre comillas simples o dobles, numeros.
- Operadores: `or`, `and`, `=` y `==` (Survey123 acepta los dos), `!=`,
  `<`, `<=`, `>`, `>=`, `+`, `-`, `*`, `div`, `mod`, parentesis.
- Funciones: selected, count-selected, string-length, not, if, concat,
  coalesce, number, int, today, now.
- Nombres sueltos: en un choice_filter son las columnas de la opcion
  (`estado=${estado}` = "la columna estado de la opcion es igual a la
  respuesta estado"); en una constraint, `string_length` es el largo de `.`
  (asi lo escribieron en la encuesta del censo); y `end_hour` /
  `end_hh_mm_ss` son la hora de fin y la duracion de la encuesta.

Una seleccion multiple vale, como texto, sus opciones separadas por coma
(como en Survey123): `${marcas} = "Otros"` solo es verdad si "Otros" es la
UNICA marcada. Para "esta marcada" se usa selected(${marcas}, "Otros").
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field

# ---------- Tokens ----------

_TOKEN = re.compile(
    r"""\s*(?:
        (?P<ref>\$\{\s*(?P<refname>[A-Za-z_][\w.-]*)\s*\})
      | (?P<num>\d+(?:\.\d+)?)
      | (?P<str>"[^"]*"|'[^']*')
      | (?P<op>==|!=|<=|>=|=|<|>|\(|\)|,|\+|-|\*)
      | (?P<punto>\.(?![\w]))
      | (?P<ident>[A-Za-z_][\w-]*)
    )""",
    re.VERBOSE,
)


class ErrorExpresion(ValueError):
    pass


@dataclass
class Token:
    tipo: str  # ref | num | str | op | punto | ident | fin
    valor: str


def tokenizar(texto: str) -> list[Token]:
    tokens: list[Token] = []
    pos = 0
    texto = texto or ""
    while pos < len(texto):
        if texto[pos:].strip() == "":
            break
        m = _TOKEN.match(texto, pos)
        if not m or m.end() == pos:
            raise ErrorExpresion(f"No se entiende la expresion cerca de: {texto[pos:pos + 20]!r}")
        pos = m.end()
        if m.group("ref"):
            tokens.append(Token("ref", m.group("refname")))
        elif m.group("num"):
            tokens.append(Token("num", m.group("num")))
        elif m.group("str"):
            tokens.append(Token("str", m.group("str")[1:-1]))
        elif m.group("op"):
            tokens.append(Token("op", m.group("op")))
        elif m.group("punto"):
            tokens.append(Token("punto", "."))
        else:
            palabra = m.group("ident")
            # Operadores con nombre de XPath.
            if palabra in ("and", "or", "div", "mod"):
                tokens.append(Token("op", palabra))
            else:
                tokens.append(Token("ident", palabra))
    tokens.append(Token("fin", ""))
    return tokens


# ---------- Arbol ----------

FUNCIONES = {
    "selected": (2, 2),
    "count-selected": (1, 1),
    "string-length": (0, 1),
    "not": (1, 1),
    "if": (3, 3),
    "concat": (0, None),
    "coalesce": (2, None),
    "number": (1, 1),
    "int": (1, 1),
    "today": (0, 0),
    "now": (0, 0),
}


@dataclass
class Nodo:
    tipo: str  # lit | ref | punto | nombre | op | neg | fn
    valor: object = None
    hijos: list["Nodo"] = field(default_factory=list)


class _Parser:
    def __init__(self, tokens: list[Token]):
        self.t = tokens
        self.i = 0

    def ver(self) -> Token:
        return self.t[self.i]

    def tomar(self) -> Token:
        tok = self.t[self.i]
        self.i += 1
        return tok

    def esperar(self, op: str) -> None:
        tok = self.tomar()
        if tok.tipo != "op" or tok.valor != op:
            raise ErrorExpresion(f"Se esperaba {op!r} y vino {tok.valor!r}")

    def es_op(self, *ops: str) -> bool:
        tok = self.ver()
        return tok.tipo == "op" and tok.valor in ops

    def expresion(self) -> Nodo:
        return self.o()

    def o(self) -> Nodo:
        nodo = self.y()
        while self.es_op("or"):
            self.tomar()
            nodo = Nodo("op", "or", [nodo, self.y()])
        return nodo

    def y(self) -> Nodo:
        nodo = self.comparacion()
        while self.es_op("and"):
            self.tomar()
            nodo = Nodo("op", "and", [nodo, self.comparacion()])
        return nodo

    def comparacion(self) -> Nodo:
        nodo = self.suma()
        while self.es_op("=", "==", "!=", "<", "<=", ">", ">="):
            op = self.tomar().valor
            nodo = Nodo("op", "=" if op == "==" else op, [nodo, self.suma()])
        return nodo

    def suma(self) -> Nodo:
        nodo = self.producto()
        while self.es_op("+", "-"):
            op = self.tomar().valor
            nodo = Nodo("op", op, [nodo, self.producto()])
        return nodo

    def producto(self) -> Nodo:
        nodo = self.unario()
        while self.es_op("*", "div", "mod"):
            op = self.tomar().valor
            nodo = Nodo("op", op, [nodo, self.unario()])
        return nodo

    def unario(self) -> Nodo:
        if self.es_op("-"):
            self.tomar()
            return Nodo("neg", None, [self.unario()])
        return self.primario()

    def primario(self) -> Nodo:
        tok = self.tomar()
        if tok.tipo == "num":
            return Nodo("lit", float(tok.valor) if "." in tok.valor else int(tok.valor))
        if tok.tipo == "str":
            return Nodo("lit", tok.valor)
        if tok.tipo == "ref":
            return Nodo("ref", tok.valor)
        if tok.tipo == "punto":
            return Nodo("punto")
        if tok.tipo == "op" and tok.valor == "(":
            nodo = self.expresion()
            self.esperar(")")
            return nodo
        if tok.tipo == "ident":
            if self.es_op("("):
                self.tomar()
                args: list[Nodo] = []
                if not self.es_op(")"):
                    args.append(self.expresion())
                    while self.es_op(","):
                        self.tomar()
                        args.append(self.expresion())
                self.esperar(")")
                if tok.valor not in FUNCIONES:
                    raise ErrorExpresion(f"Funcion no soportada: {tok.valor}()")
                minimo, maximo = FUNCIONES[tok.valor]
                if len(args) < minimo or (maximo is not None and len(args) > maximo):
                    raise ErrorExpresion(f"{tok.valor}() recibe una cantidad de argumentos invalida")
                return Nodo("fn", tok.valor, args)
            if tok.valor in ("true", "false"):
                return Nodo("lit", tok.valor == "true")
            return Nodo("nombre", tok.valor)
        raise ErrorExpresion(f"No se esperaba {tok.valor!r}")


def analizar(texto: str) -> Nodo:
    parser = _Parser(tokenizar(texto))
    nodo = parser.expresion()
    if parser.ver().tipo != "fin":
        raise ErrorExpresion(f"Sobra texto en la expresion: {parser.ver().valor!r}")
    return nodo


def referencias(nodo: Nodo) -> set[str]:
    """Las preguntas que nombra la expresion (`${x}`)."""
    refs = {nodo.valor} if nodo.tipo == "ref" else set()
    for hijo in nodo.hijos:
        refs |= referencias(hijo)
    return refs


def nombres(nodo: Nodo) -> set[str]:
    """Los nombres sueltos (columnas de opcion o variables especiales)."""
    sueltos = {nodo.valor} if nodo.tipo == "nombre" else set()
    for hijo in nodo.hijos:
        sueltos |= nombres(hijo)
    return sueltos


# ---------- Evaluacion ----------


@dataclass
class Contexto:
    """Con que se evalua: las respuestas, el valor de `.`, las variables
    sueltas (columnas de una opcion, end_hour...) y la fecha y hora de hoy."""

    respuestas: dict[str, object]
    actual: object = None
    variables: dict[str, object] = field(default_factory=dict)
    hoy: str = ""
    ahora: str = ""


def como_texto(valor: object) -> str:
    if valor is None:
        return ""
    if isinstance(valor, bool):
        return "true" if valor else "false"
    if isinstance(valor, list):
        return ",".join(como_texto(v) for v in valor)
    if isinstance(valor, dict) and "lat" in valor:
        return f"{valor['lat']} {valor['lng']}"
    if isinstance(valor, float) and valor.is_integer():
        return str(int(valor))
    return str(valor)


def como_numero(valor: object) -> float:
    if isinstance(valor, bool):
        return 1.0 if valor else 0.0
    if isinstance(valor, (int, float)):
        return float(valor)
    try:
        return float(como_texto(valor).strip())
    except ValueError:
        return math.nan


def como_booleano(valor: object) -> bool:
    if isinstance(valor, bool):
        return valor
    if isinstance(valor, (int, float)):
        return valor != 0 and not math.isnan(valor)
    if isinstance(valor, list):
        return len(valor) > 0
    return como_texto(valor) != ""


def _lista(valor: object) -> list[str]:
    if isinstance(valor, list):
        return [como_texto(v) for v in valor]
    texto = como_texto(valor)
    return [p for p in texto.split(",") if p] if texto else []


def _es_numero(valor: object) -> bool:
    if isinstance(valor, bool):
        return False
    if isinstance(valor, (int, float)):
        return True
    texto = como_texto(valor).strip()
    return bool(texto) and re.fullmatch(r"-?\d+(\.\d+)?", texto) is not None


def _comparar(op: str, a: object, b: object) -> bool:
    if _es_numero(a) and _es_numero(b):
        x, y = como_numero(a), como_numero(b)
    else:
        x, y = como_texto(a), como_texto(b)
    if op == "=":
        return x == y
    if op == "!=":
        return x != y
    if op == "<":
        return x < y
    if op == "<=":
        return x <= y
    if op == ">":
        return x > y
    return x >= y


def evaluar(nodo: Nodo, ctx: Contexto) -> object:
    t = nodo.tipo
    if t == "lit":
        return nodo.valor
    if t == "ref":
        return ctx.respuestas.get(nodo.valor)
    if t == "punto":
        return ctx.actual
    if t == "nombre":
        if nodo.valor == "string_length":
            return len(como_texto(ctx.actual))
        if nodo.valor in ctx.variables:
            return ctx.variables[nodo.valor]
        raise ErrorExpresion(f"Nombre desconocido: {nodo.valor}")
    if t == "neg":
        return -como_numero(evaluar(nodo.hijos[0], ctx))
    if t == "op":
        op = nodo.valor
        if op == "or":
            return como_booleano(evaluar(nodo.hijos[0], ctx)) or como_booleano(evaluar(nodo.hijos[1], ctx))
        if op == "and":
            return como_booleano(evaluar(nodo.hijos[0], ctx)) and como_booleano(evaluar(nodo.hijos[1], ctx))
        a, b = evaluar(nodo.hijos[0], ctx), evaluar(nodo.hijos[1], ctx)
        if op in ("=", "!=", "<", "<=", ">", ">="):
            return _comparar(op, a, b)
        x, y = como_numero(a), como_numero(b)
        if op == "+":
            return x + y
        if op == "-":
            return x - y
        if op == "*":
            return x * y
        if op == "div":
            return x / y if y else math.nan
        return math.fmod(x, y) if y else math.nan
    # Funciones
    nombre, args = nodo.valor, nodo.hijos
    if nombre == "selected":
        return como_texto(evaluar(args[1], ctx)) in _lista(evaluar(args[0], ctx))
    if nombre == "count-selected":
        return len(_lista(evaluar(args[0], ctx)))
    if nombre == "string-length":
        return len(como_texto(evaluar(args[0], ctx) if args else ctx.actual))
    if nombre == "not":
        return not como_booleano(evaluar(args[0], ctx))
    if nombre == "if":
        return evaluar(args[1], ctx) if como_booleano(evaluar(args[0], ctx)) else evaluar(args[2], ctx)
    if nombre == "concat":
        return "".join(como_texto(evaluar(a, ctx)) for a in args)
    if nombre == "coalesce":
        for a in args:
            valor = evaluar(a, ctx)
            if como_texto(valor) != "":
                return valor
        return ""
    if nombre == "number":
        return como_numero(evaluar(args[0], ctx))
    if nombre == "int":
        n = como_numero(evaluar(args[0], ctx))
        return n if math.isnan(n) else int(n)
    if nombre == "today":
        return ctx.hoy
    if nombre == "now":
        return ctx.ahora
    raise ErrorExpresion(f"Funcion no soportada: {nombre}()")


def evaluar_texto(texto: str, ctx: Contexto) -> object:
    return evaluar(analizar(texto), ctx)


def verdadero(texto: str | None, ctx: Contexto) -> bool:
    """Para relevant y constraint: sin expresion, siempre verdadero."""
    if not texto or not texto.strip():
        return True
    return como_booleano(evaluar_texto(texto, ctx))
