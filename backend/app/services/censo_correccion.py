"""Censos por corregir: los que no pudieron crear (o completar) su cliente
por un problema de empresa o codigo, para corregirlos desde Clientes.

Categorias (una por censo, en este orden):
- ambas: AMBAS con un solo codigo (historico de Survey123): faltan los dos.
- revisar: el codigo existe en la maestra o en ventas con otro nombre.
- sin_codigo: cliente existente (o nuevo que compra) censado sin codigo.
- no_encontrado: el codigo no esta en la maestra ni en ventas (el cliente
  se creo en Clientes, pero puede ser un codigo mal escrito).

Corregir reescribe empresa y codigos en las respuestas del censo, deshace
lo que el codigo viejo creo (el cliente, si nadie mas lo usa) y vuelve a
procesar el censo con las reglas de siempre (censo_clientes.procesar). Si
alguien confirma que un codigo con otro nombre es el correcto, se acepta.
Los duplicados, descartados y posibles clientes no entran.
"""

from __future__ import annotations

from collections import defaultdict

import psycopg
from fastapi import HTTPException
from psycopg.types.json import Jsonb

from app.services import censo_clientes as cc
from app.services import censo_tablero as tc
from app.services.indicadores_venta import ruta_comparable
from app.services.maestra_import import EMPRESAS, palabra_comun_mas_larga, palabras_distintivas

CATEGORIAS = ("ambas", "revisar", "sin_codigo", "no_encontrado")
POR_PAGINA = 50
MAXIMO_SUGERENCIAS = 3
# Una sugerencia necesita una palabra distintiva en comun (no basta
# "INVERSIONES"; en su ruta vale una sigla exacta como "HJ"); fuera de su
# ruta, una larga: con una corta ("DIA") salen
# comercios sin relacion.
PALABRA_EN_SU_RUTA = 2
PALABRA_FUERA_DE_RUTA = 5
MOTIVO_AMBAS = "AMBAS con un solo código"


def categoria_de(c: dict) -> str | None:
    """Que le falta a un censo (ya cargado con tc.cargar)."""
    if c["duplicadoDeId"] or c["posibleCliente"]:
        return None
    revisar = [k for k in c["claves"] if k["accion"] == "REVISAR"]
    if any((k["motivo"] or "").startswith(MOTIVO_AMBAS) for k in revisar):
        return "ambas"
    if revisar:
        return "revisar"
    if not c["claves"]:
        return "sin_codigo"
    if any(not k["enMaestra"] and not k["enVentas"] for k in c["claves"]):
        return "no_encontrado"
    return None


def _maestra_por_ruta(cur) -> dict[str, list[dict]]:
    cur.execute(
        'SELECT mc."empresa"::text AS "empresa", mc."codigo", mc."razonSocial", mc."ruta" FROM "MaestraCliente" mc '
        'WHERE mc."cargaId" IN (SELECT DISTINCT ON ("empresa") "id" FROM "MaestraCarga" '
        'ORDER BY "empresa", "subidaEn" DESC)'
    )
    por_ruta: dict[str, list[dict]] = defaultdict(list)
    for f in cur.fetchall():
        f["palabras"] = palabras_distintivas(f["razonSocial"])
        por_ruta[ruta_comparable(f["ruta"])].append(f)
    return por_ruta


def _sugerencias(c: dict, maestra: dict[str, list[dict]], censadas: set[tuple[str, str]]) -> list[dict]:
    """Clientes de la maestra con un nombre que se parece al del censo: los
    de su ruta (si no hay, de otra ruta con una palabra fuerte en comun), sin
    los codigos que ya tiene el censo."""
    nombre = c["nombreComercio"]
    if not nombre:
        return []
    empresa = (c["empresa"] or "").upper()
    empresas = [empresa] if empresa in EMPRESAS else list(EMPRESAS)
    propias = {(k["empresa"], k["codigo"]) for k in c["claves"]}
    ruta = ruta_comparable(c["ruta"])
    palabras = palabras_distintivas(nombre)

    def candidatos(filas: list[dict], en_su_ruta: bool) -> list[dict]:
        salida = []
        for f in filas:
            if f["empresa"] not in empresas or (f["empresa"], f["codigo"]) in propias:
                continue
            fuerza = palabra_comun_mas_larga(palabras, f["palabras"])
            if fuerza < (PALABRA_EN_SU_RUTA if en_su_ruta else PALABRA_FUERA_DE_RUTA):
                continue
            salida.append({
                "empresa": f["empresa"], "codigo": f["codigo"], "razonSocial": f["razonSocial"],
                "ruta": ruta_comparable(f["ruta"]), "enSuRuta": en_su_ruta,
                "yaCensado": (f["empresa"], f["codigo"]) in censadas, "_fuerza": fuerza,
            })
        return salida

    lista = candidatos(maestra.get(ruta, []), True)
    if not lista:
        otras = [f for r, filas in maestra.items() if r != ruta for f in filas]
        lista = candidatos(otras, False)
    lista.sort(key=lambda s: (s["yaCensado"], -s["_fuerza"]))
    return [{k: v for k, v in s.items() if k != "_fuerza"} for s in lista[:MAXIMO_SUGERENCIAS]]


def _fila(c: dict, categoria: str) -> dict:
    r = c["r"]
    return {
        "id": c["id"], "categoria": categoria, "nombre": c["nombreComercio"], "tipoCliente": c["tipoCliente"],
        "rif": r.get("rif"), "telefono": r.get("telefono"), "ruta": c["ruta"], "encuestador": c["encuestador"],
        "fecha": tc.dia_caracas(c["terminadoEn"]), "origen": c["origen"],
        "direccion": ", ".join(str(x) for x in (r.get("sector"), r.get("punto_referencia")) if x) or None,
        "empresa": c["empresa"], "codigoCliente": r.get("codigo_cliente"),
        "codigoIsvan": r.get("codigo_isvan"), "codigoTralog": r.get("codigo_tralog"),
        "claves": [
            {k: x[k] for k in ("empresa", "codigo", "accion", "motivo", "enMaestra", "enVentas")} for x in c["claves"]
        ],
    }


def pendientes(cur, categoria: str | None, q: str | None, pagina: int, solo_conteo: bool = False) -> dict:
    if categoria and categoria not in CATEGORIAS:
        raise HTTPException(400, f"Categoría desconocida: {categoria}")
    censos = tc.cargar(cur, 'WHERE c."formulario" = %(f)s AND c."descartadoEn" IS NULL', {"f": cc.FORMULARIO})
    con_categoria = [(c, k) for c in censos if (k := categoria_de(c))]
    conteo = {k: sum(1 for _, x in con_categoria if x == k) for k in CATEGORIAS}
    if solo_conteo:
        return {"conteo": conteo}
    filas = [(c, k) for c, k in con_categoria if not categoria or k == categoria]
    if q and q.strip():
        texto = q.strip().lower()
        filas = [
            (c, k) for c, k in filas
            if any(
                texto in str(v).lower()
                for v in (c["nombreComercio"], c["encuestador"], c["ruta"], c["r"].get("rif"),
                          c["r"].get("codigo_cliente"), *[x["codigo"] for x in c["claves"]])
                if v
            )
        ]
    filas.sort(key=lambda ck: (CATEGORIAS.index(ck[1]), ck[0]["ruta"] or "", ck[0]["nombreComercio"] or ""))
    total = len(filas)
    pagina_filas = filas[(pagina - 1) * POR_PAGINA: pagina * POR_PAGINA]
    maestra = _maestra_por_ruta(cur) if pagina_filas else {}
    censadas = tc.censadas(censos)
    return {
        "conteo": conteo,
        "total": total,
        "pagina": pagina,
        "porPagina": POR_PAGINA,
        "hayMaestra": bool(maestra) or not pagina_filas,
        "censos": [{**_fila(c, k), "sugerencias": _sugerencias(c, maestra, censadas)} for c, k in pagina_filas],
    }


# ---------- Corregir ----------


def _codigo(valor: str | None, campo: str) -> str:
    texto = (valor or "").strip()
    if not texto:
        raise HTTPException(422, {"mensaje": "Falta el código", "errores": {campo: "Este campo es obligatorio"}})
    if not cc.CODIGO_VALIDO.match(texto):
        raise HTTPException(
            422, {"mensaje": "Código inválido", "errores": {campo: "Solo letras, números o guiones (hasta 20)"}}
        )
    return texto


def _borrar_cliente_si_libre(cur, cliente_id: str, censo_id: str) -> bool:
    """El cliente que creo el codigo equivocado, si nada mas lo usa (otro
    censo, un despacho...). Si algo lo referencia, queda."""
    cur.execute(
        'SELECT 1 FROM "CensoCliente" WHERE "clienteId" = %s AND "censoId" <> %s '
        'UNION ALL SELECT 1 FROM "Despacho" WHERE "destinoClienteId" = %s LIMIT 1',
        (cliente_id, censo_id, cliente_id),
    )
    if cur.fetchone():
        return False
    try:
        with cur.connection.transaction():
            cur.execute('DELETE FROM "Cliente" WHERE "id" = %s', (cliente_id,))
    except psycopg.errors.ForeignKeyViolation:
        return False
    return cur.rowcount > 0


def corregir(
    cur, censo_id: str, empresa: str, codigo: str | None, codigo_isvan: str | None, codigo_tralog: str | None,
    confiar_en_codigo: bool, usuario_id: str,
) -> dict:
    cur.execute(
        'SELECT "id", "respuestas", "descartadoEn" FROM "Censo" WHERE "id" = %s AND "formulario" = %s FOR UPDATE',
        (censo_id, cc.FORMULARIO),
    )
    censo = cur.fetchone()
    if not censo or censo["descartadoEn"]:
        raise HTTPException(404, "Censo no encontrado")
    respuestas = dict(censo["respuestas"])
    if cc.es_posible_cliente(respuestas):
        raise HTTPException(422, "Es un posible cliente (no desea comprar): no lleva empresa ni código")

    empresa = (empresa or "").upper()
    for nombre in cc.PREGUNTAS_DE_CODIGO:
        respuestas.pop(nombre, None)
    if empresa in EMPRESAS:
        respuestas["codigo_cliente"] = _codigo(codigo, "codigo")
    elif empresa == "AMBAS":
        respuestas["codigo_isvan"] = _codigo(codigo_isvan, "codigoIsvan")
        respuestas["codigo_tralog"] = _codigo(codigo_tralog, "codigoTralog")
    else:
        raise HTTPException(422, {"mensaje": "Empresa inválida", "errores": {"empresa": "ISVAN, TRALOG o AMBAS"}})
    respuestas["empresa"] = empresa
    nuevas = {(k.empresa, k.codigo) for k in cc.claves_de(respuestas)}

    # Lo que el codigo viejo creo y ya no corresponde.
    cur.execute(
        'SELECT "empresa"::text AS "empresa", "codigo", "clienteId", "accion"::text AS "accion" '
        'FROM "CensoCliente" WHERE "censoId" = %s',
        (censo_id,),
    )
    eliminados = 0
    anteriores = cur.fetchall()
    cur.execute('DELETE FROM "CensoCliente" WHERE "censoId" = %s', (censo_id,))
    for a in anteriores:
        if a["accion"] == "CREADO" and a["clienteId"] and (a["empresa"], a["codigo"]) not in nuevas:
            eliminados += _borrar_cliente_si_libre(cur, a["clienteId"], censo_id)

    cur.execute(
        'UPDATE "Censo" SET "respuestas" = %s, "empresa" = %s, "duplicadoDeId" = NULL, '
        '"corregidoEn" = now(), "corregidoPorId" = %s WHERE "id" = %s',
        (Jsonb(respuestas), empresa, usuario_id, censo_id),
    )
    resultado = cc.procesar(cur, censo_id, confiar_en_codigo=confiar_en_codigo)

    revisar = [c for c in resultado["clientes"] if c["accion"] == "REVISAR"]
    if resultado["duplicadoDe"]:
        categoria = None
    elif revisar:
        categoria = "revisar"
    elif any(not c["enMaestra"] and not c["enVentas"] for c in resultado["clientes"]):
        categoria = "no_encontrado"
    else:
        categoria = None
    return {**resultado, "categoria": categoria, "clientesEliminados": eliminados}
