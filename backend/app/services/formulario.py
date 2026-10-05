"""Validacion de un formulario lleno contra su definicion (ver xlsform.py).

El navegador ya muestra y valida el formulario con las mismas reglas, pero
el servidor vuelve a hacerlo todo al recibirlo: cualquiera con la sesion
abierta puede armar el envio a mano.

Reglas, como en Survey123:

- Una pregunta (o su grupo) con `relevant` falso no se muestra y su
  respuesta se descarta, aunque haya llegado.
- `required` solo aplica a las preguntas relevantes.
- `constraint` solo se evalua si la pregunta tiene valor; `.` es ese valor.
- Una opcion es valida si existe en su lista y pasa el `choice_filter`.
- `bind::esri:fieldLength` es el largo maximo del texto.
- Las preguntas `hidden`, `calculate` o con calculo no las llena la persona:
  las calcula la app (fecha y hora de inicio, hora de fin, duracion).
"""

from __future__ import annotations

import json
import math
import re
from datetime import date, datetime, time
from functools import lru_cache
from pathlib import Path

from app.services import xlsform as xf
from app.services import xlsform_expresiones as ex

CARPETA = Path(__file__).resolve().parents[1] / "formularios"

MENSAJE_REQUERIDO = "Este campo es obligatorio"
MENSAJE_RESTRICCION = "El valor no es válido"
_HORA = re.compile(r"^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$")


@lru_cache
def definicion(form_id: str) -> dict:
    ruta = CARPETA / f"{form_id}.json"
    if not ruta.exists():
        raise FileNotFoundError(f"No existe el formulario '{form_id}'")
    return json.loads(ruta.read_text(encoding="utf-8"))


def _vacio(valor: object) -> bool:
    return valor is None or valor == "" or valor == [] or (isinstance(valor, float) and math.isnan(valor))


def _normalizar(pregunta: dict, valor: object) -> object:
    """El valor con el tipo de la pregunta, o ValueError si no se puede."""
    if _vacio(valor):
        return None
    tipo = pregunta["type"]
    if tipo == "select_multiple":
        if not isinstance(valor, list):
            raise ValueError("se esperaba una lista de opciones")
        return [str(v) for v in valor if str(v) != ""] or None
    if tipo == "integer":
        if isinstance(valor, bool):
            raise ValueError("no es un número entero")
        if isinstance(valor, int):
            return valor
        texto = str(valor).strip()
        if not re.fullmatch(r"-?\d+", texto):
            raise ValueError("no es un número entero")
        return int(texto)
    if tipo == "decimal":
        try:
            return float(valor)
        except (TypeError, ValueError):
            raise ValueError("no es un número") from None
    if tipo == "date":
        try:
            return date.fromisoformat(str(valor)).isoformat()
        except ValueError:
            raise ValueError("no es una fecha (AAAA-MM-DD)") from None
    if tipo == "time":
        texto = str(valor).strip()
        if not _HORA.match(texto):
            raise ValueError("no es una hora (HH:MM)")
        return texto
    if tipo == "dateTime":
        try:
            return datetime.fromisoformat(str(valor)).isoformat()
        except ValueError:
            raise ValueError("no es una fecha y hora") from None
    if tipo == "geopoint":
        if not isinstance(valor, dict):
            raise ValueError("se esperaba una ubicación")
        try:
            lat, lng = float(valor["lat"]), float(valor["lng"])
        except (KeyError, TypeError, ValueError):
            raise ValueError("la ubicación no tiene latitud y longitud") from None
        if not (-90 <= lat <= 90 and -180 <= lng <= 180):
            raise ValueError("la ubicación está fuera de rango")
        punto = {"lat": lat, "lng": lng}
        if valor.get("precision") is not None:
            try:
                punto["precision"] = float(valor["precision"])
            except (TypeError, ValueError):
                pass
        return punto
    return str(valor).strip() or None


def _opciones_validas(defin: dict, pregunta: dict, respuestas: dict, ctx_base: ex.Contexto) -> set[str]:
    opciones = defin["choices"][pregunta["list"]]
    filtro = pregunta.get("choice_filter")
    if not filtro:
        return {o["name"] for o in opciones}
    nodo = ex.analizar(filtro)
    validas = set()
    for o in opciones:
        ctx = ex.Contexto(
            respuestas=respuestas,
            variables={"name": o["name"], "label": o["label"], **o["extra"]},
            hoy=ctx_base.hoy,
            ahora=ctx_base.ahora,
        )
        if ex.como_booleano(ex.evaluar(nodo, ctx)):
            validas.add(o["name"])
    return validas


def validar(
    defin: dict,
    respuestas: dict,
    *,
    hoy: str,
    ahora: str,
    variables: dict[str, object] | None = None,
) -> tuple[dict, dict[str, str]]:
    """Las respuestas limpias (solo las relevantes y con valor) y los errores
    por pregunta. `variables` son end_hour y end_hh_mm_ss."""
    preguntas = xf.preguntas_de(defin)
    por_nombre = {p["name"]: p for p in preguntas}
    errores: dict[str, str] = {}

    desconocidas = sorted(set(respuestas) - set(por_nombre))
    if desconocidas:
        errores["_"] = f"Preguntas que no son del formulario: {', '.join(desconocidas)}"

    valores: dict[str, object] = {}
    for p in preguntas:
        try:
            valores[p["name"]] = _normalizar(p, respuestas.get(p["name"]))
        except ValueError as e:
            errores[p["name"]] = f"{p.get('label') or p['name']}: {e}"
            valores[p["name"]] = None

    variables = variables or {}
    ctx = ex.Contexto(respuestas=valores, variables=variables, hoy=hoy, ahora=ahora)

    # Las calculadas no las escribe nadie: se calculan aca.
    for p in preguntas:
        if p.get("calculation"):
            valores[p["name"]] = _normalizar(p, ex.evaluar_texto(p["calculation"], ctx))

    # Relevancia hasta que no cambie nada: una respuesta que se descarta
    # puede apagar otra pregunta que dependia de ella.
    relevantes: dict[str, bool] = {}
    for _ in range(len(preguntas) + 1):
        cambio = False
        for p in preguntas:
            visible = all(ex.verdadero(g.get("relevant"), ctx) for g in p["_grupos"]) and ex.verdadero(
                p.get("relevant"), ctx
            )
            if relevantes.get(p["name"]) != visible:
                relevantes[p["name"]] = visible
                cambio = True
            if not visible and valores.get(p["name"]) is not None:
                valores[p["name"]] = None
                cambio = True
        if not cambio:
            break

    limpias: dict[str, object] = {}
    for p in preguntas:
        nombre = p["name"]
        if not relevantes[nombre]:
            # Se descarta igual: un formato invalido en algo que no se
            # muestra no puede trabar el envio.
            errores.pop(nombre, None)
            continue
        if nombre in errores:
            continue
        valor = valores[nombre]
        if valor is None:
            if p.get("required"):
                errores[nombre] = p.get("required_message") or MENSAJE_REQUERIDO
            continue
        if p.get("field_length") and isinstance(valor, str) and len(valor) > p["field_length"]:
            errores[nombre] = f"Máximo {p['field_length']} caracteres"
            continue
        if "list" in p:
            validas = _opciones_validas(defin, p, valores, ctx)
            elegidas = valor if isinstance(valor, list) else [valor]
            fuera = [v for v in elegidas if v not in validas]
            if fuera:
                errores[nombre] = f"Opción no válida: {', '.join(fuera)}"
                continue
        if p.get("constraint"):
            ctx_pregunta = ex.Contexto(respuestas=valores, actual=valor, variables=variables, hoy=hoy, ahora=ahora)
            if not ex.verdadero(p["constraint"], ctx_pregunta):
                errores[nombre] = p.get("constraint_message") or MENSAJE_RESTRICCION
                continue
        limpias[nombre] = valor
    return limpias, errores


def duracion_hh_mm_ss(segundos: float) -> str:
    segundos = max(int(segundos), 0)
    return f"{segundos // 3600:02d}:{segundos % 3600 // 60:02d}:{segundos % 60:02d}"


def hora_texto(momento: datetime | time) -> str:
    return momento.strftime("%H:%M:%S")
