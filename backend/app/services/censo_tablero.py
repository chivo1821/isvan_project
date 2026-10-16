"""Tablero del censo: los indicadores que el cliente tenia en Survey123
(principal y mapa, que une el de imagenes), el avance contra la maestra y las
alertas. Tambien lo que ve cada vendedor de sus rutas.

Reglas:
- Un duplicado (Censo.duplicadoDeId) no cuenta en ningun indicador; uno
  descartado (descartadoEn) no aparece en ningun lado.
- Censado = un censo no duplicado con esa clave (empresa, codigo) que no
  quedo en REVISAR: un codigo dudoso no da al cliente por censado.
- Por censar = clientes de la maestra vigente, fuera de la ruta 77, sin
  censar. El vendedor de un cliente sale de su ruta (VendedorRuta).
- Pendiente en ventas = censado con un codigo que no esta ni en la maestra
  ni en los clientes de ventas: hay que crearlo en el sistema de ventas.
- Las preguntas de competencia vienen en dos ramas segun el tipo de
  cliente (helados_competencia y helados_competencia1...): se unen.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from datetime import datetime, timedelta

from app.core.permisos import rutas_del_vendedor
from app.services import censo_clientes as cc
from app.services.indicadores_venta import ruta_comparable
from app.services.maestra_import import EMPRESAS, RUTA_DE_BAJA

_DESFASE_CARACAS = timedelta(hours=-4)
# Respuestas que usa el tablero, para no traer el JSON completo.
_RESPUESTAS = (
    "helados_competencia", "helados_competencia1", "marcas_competencia", "marcas_competencia1",
    "cual_otra_marca", "cual_otra_marca1", "posee_activo", "propiedad_activo", "posee_activo_competencia",
    "rif", "telefono", "desea_vender_tiorico", "codigo_cliente", "codigo_isvan", "codigo_tralog",
    "sector", "punto_referencia", "foto_fachada", "foto_activo", "foto_activo2", "foto_serial_activo",
)
PREGUNTAS_FOTO = ("foto_fachada", "foto_activo", "foto_activo2", "foto_serial_activo")
LIMITE_LISTA = 500


def dia_caracas(instante: datetime) -> str:
    return (instante + _DESFASE_CARACAS).date().isoformat()


def _conteo(valores) -> list[dict]:
    c = Counter(v if v not in (None, "") else "Sin dato" for v in valores)
    return [{"clave": k, "n": n} for k, n in c.most_common()]


def _orden_ruta(ruta: str) -> tuple:
    """"2" antes que "10"; lo que no es numero, al final."""
    return (not ruta.isdigit(), int(ruta) if ruta.isdigit() else 0, ruta)


def _de_rama(r: dict, nombre: str):
    return r.get(nombre) if r.get(nombre) not in (None, "", []) else r.get(f"{nombre}1")


# ---------- Datos ----------


def cargar(cur, where: str, params: dict) -> list[dict]:
    """Los censos del filtro (incluidos los duplicados, marcados), con sus
    claves y sus fotos."""
    campos = ", ".join(f"'{n}', c.\"respuestas\"->'{n}'" for n in _RESPUESTAS)
    cur.execute(
        f'SELECT c."id", c."terminadoEn", c."encuestador", c."nombreComercio", c."tipoCliente", c."empresa", '
        f'c."ruta", c."lat", c."lng", c."origen"::text AS "origen", c."duplicadoDeId", c."usuarioId", '
        f'jsonb_build_object({campos}) AS "r" FROM "Censo" c {where}',
        params,
    )
    censos = cur.fetchall()
    ids = [c["id"] for c in censos]
    claves, fotos = defaultdict(list), defaultdict(list)
    if ids:
        cur.execute(
            'SELECT "censoId", "empresa"::text AS "empresa", "codigo", "accion"::text AS "accion", "motivo", '
            '"enMaestra", "enVentas" FROM "CensoCliente" WHERE "censoId" = ANY(%s)',
            (ids,),
        )
        for f in cur.fetchall():
            claves[f["censoId"]].append(f)
        cur.execute('SELECT "id", "censoId", "pregunta" FROM "CensoFoto" WHERE "censoId" = ANY(%s)', (ids,))
        for f in cur.fetchall():
            fotos[f["censoId"]].append({"pregunta": f["pregunta"], "id": f["id"]})
    for c in censos:
        c["claves"] = claves[c["id"]]
        r = {k: v for k, v in c["r"].items() if v is not None}
        c["r"] = r
        # Importados de Survey123: la foto es un enlace a su servidor.
        c["fotos"] = fotos[c["id"]] or [
            {"pregunta": p, "url": r[p]} for p in PREGUNTAS_FOTO if str(r.get(p, "")).startswith("https://")
        ]
        c["posibleCliente"] = not c["claves"] and cc.es_posible_cliente({**r, "tipo_cliente": c["tipoCliente"]})
    return censos


def _maestra(cur, empresas: tuple[str, ...]) -> dict[str, list[dict]]:
    cur.execute(
        'SELECT mc."empresa"::text AS "empresa", mc."codigo", mc."razonSocial", mc."ruta", mc."diaVisita", '
        'mc."direccion", mc."zona" FROM "MaestraCliente" mc WHERE mc."cargaId" IN ('
        '  SELECT DISTINCT ON ("empresa") "id" FROM "MaestraCarga" WHERE "empresa"::text = ANY(%s) '
        '  ORDER BY "empresa", "subidaEn" DESC)',
        (list(empresas),),
    )
    por_empresa: dict[str, list[dict]] = defaultdict(list)
    for f in cur.fetchall():
        f["rutaNumero"] = ruta_comparable(f["ruta"])
        if f["rutaNumero"] != RUTA_DE_BAJA:
            por_empresa[f["empresa"]].append(f)
    return por_empresa


def _vendedores_por_ruta(cur) -> dict[tuple[str, str], list[dict]]:
    cur.execute(
        'SELECT vr."empresa"::text AS "empresa", vr."ruta", u."id", u."nombre" FROM "VendedorRuta" vr '
        'JOIN "Usuario" u ON u."id" = vr."usuarioId" WHERE u."activo"'
    )
    por_ruta: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for f in cur.fetchall():
        por_ruta[(f["empresa"], ruta_comparable(f["ruta"]))].append({"id": f["id"], "nombre": f["nombre"]})
    return por_ruta


def censadas(censos: list[dict]) -> set[tuple[str, str]]:
    """Las claves que cuentan como censadas: de censos no duplicados y que
    no quedaron en REVISAR."""
    return {
        (k["empresa"], k["codigo"])
        for c in censos
        if not c["duplicadoDeId"]
        for k in c["claves"]
        if k["accion"] != "REVISAR"
    }


def _cliente_por_censar(f: dict, vendedores: dict) -> dict:
    return {
        "empresa": f["empresa"], "codigo": f["codigo"], "razonSocial": f["razonSocial"], "ruta": f["rutaNumero"],
        "diaVisita": f["diaVisita"], "direccion": f["direccion"], "zona": f["zona"],
        "vendedores": [v["nombre"] for v in vendedores.get((f["empresa"], f["rutaNumero"]), [])],
    }


# ---------- Tablero (ADMIN) ----------


def avance(cur, censos: list[dict], empresas: tuple[str, ...], rutas: set[str] | None) -> dict:
    """Maestra contra lo censado, por empresa, ruta y vendedor."""
    maestra = _maestra(cur, empresas)
    vendedores = _vendedores_por_ruta(cur)
    hechas = censadas(censos)
    por_ruta: dict[tuple[str, str], Counter] = defaultdict(Counter)
    pendientes = []
    for empresa, filas in maestra.items():
        for f in filas:
            if rutas and f["rutaNumero"] not in rutas:
                continue
            clave = (empresa, f["rutaNumero"])
            por_ruta[clave]["maestra"] += 1
            if (empresa, f["codigo"]) in hechas:
                por_ruta[clave]["censados"] += 1
            else:
                pendientes.append(_cliente_por_censar(f, vendedores))

    def fila(etiqueta: dict, n: Counter) -> dict:
        por_censar = n["maestra"] - n["censados"]
        return {
            **etiqueta, "maestra": n["maestra"], "censados": n["censados"], "porCensar": por_censar,
            "avance": n["censados"] / n["maestra"] if n["maestra"] else None,
        }

    rutas_filas = [
        fila({"empresa": e, "ruta": r, "vendedores": [v["nombre"] for v in vendedores.get((e, r), [])]}, n)
        for (e, r), n in sorted(por_ruta.items(), key=lambda kv: (kv[0][0], _orden_ruta(kv[0][1])))
    ]
    por_empresa: dict[str, Counter] = defaultdict(Counter)
    por_vendedor: dict[str, Counter] = defaultdict(Counter)
    rutas_de: dict[str, list[str]] = defaultdict(list)
    for (e, r), n in por_ruta.items():
        por_empresa[e].update(n)
        for v in vendedores.get((e, r), []):
            por_vendedor[v["nombre"]].update(n)
            rutas_de[v["nombre"]].append(f"{e} {r}")
    pendientes.sort(key=lambda p: (p["empresa"], _orden_ruta(p["ruta"] or ""), p["razonSocial"]))
    return {
        "conMaestra": sorted(maestra),
        "porEmpresa": [fila({"empresa": e}, n) for e, n in sorted(por_empresa.items())],
        "porRuta": rutas_filas,
        "porVendedor": sorted(
            (fila({"vendedor": v, "rutas": sorted(rutas_de[v])}, n) for v, n in por_vendedor.items()),
            key=lambda x: -x["porCensar"],
        ),
        "porCensar": pendientes,
    }


def _resumen_censo(c: dict) -> dict:
    return {
        "id": c["id"], "nombre": c["nombreComercio"], "encuestador": c["encuestador"], "ruta": c["ruta"],
        "fecha": dia_caracas(c["terminadoEn"]), "origen": c["origen"],
    }


def alertas(censos: list[dict]) -> dict:
    por_id = {c["id"]: c for c in censos}
    duplicados = []
    for c in censos:
        if c["duplicadoDeId"]:
            original = por_id.get(c["duplicadoDeId"])
            duplicados.append({
                **_resumen_censo(c),
                "claves": [f'{k["empresa"]} {k["codigo"]}' for k in c["claves"]] or (
                    [f'RIF {c["r"].get("rif")}'] if c["r"].get("rif") else []
                ),
                "duplicadoDe": _resumen_censo(original) if original else {"id": c["duplicadoDeId"]},
            })

    # La misma clave en censos no duplicados (por lo tanto, a mas de 50 m).
    por_clave: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for c in censos:
        if not c["duplicadoDeId"]:
            for k in c["claves"]:
                por_clave[(k["empresa"], k["codigo"])].append(c)
    lejos = []
    for (empresa, codigo), grupo in por_clave.items():
        if len(grupo) < 2:
            continue
        con_punto = [g for g in grupo if g["lat"] is not None]
        distancia = max(
            (
                cc.metros(a["lat"], a["lng"], b["lat"], b["lng"])
                for i, a in enumerate(con_punto)
                for b in con_punto[i + 1:]
            ),
            default=None,
        )
        lejos.append({
            "empresa": empresa, "codigo": codigo, "metros": round(distancia) if distancia is not None else None,
            "censos": [_resumen_censo(g) for g in sorted(grupo, key=lambda g: g["terminadoEn"])],
        })
    lejos.sort(key=lambda x: -(x["metros"] or 0))

    revisar = [
        {**_resumen_censo(c), "empresa": k["empresa"], "codigo": k["codigo"], "motivo": k["motivo"]}
        for c in censos
        if not c["duplicadoDeId"]
        for k in c["claves"]
        if k["accion"] == "REVISAR"
    ]
    sin_codigo = [
        {**_resumen_censo(c), "tipoCliente": c["tipoCliente"]}
        for c in censos
        if not c["duplicadoDeId"] and not c["claves"] and not c["posibleCliente"]
    ]
    return {
        "duplicados": duplicados,
        "mismoCodigoLejos": lejos,
        "revisar": revisar,
        "sinCodigo": sin_codigo,
    }


def tablero(cur, where: str, params: dict, empresas_filtro: list[str], rutas_filtro: list[str]) -> dict:
    censos = cargar(cur, where, params)
    vigentes = [c for c in censos if not c["duplicadoDeId"]]

    def r(c, nombre):
        return c["r"].get(nombre)

    vende = [_de_rama(c["r"], "helados_competencia") for c in vigentes]
    marcas = Counter(m for c in vigentes for m in (_de_rama(c["r"], "marcas_competencia") or []))
    otras = Counter(
        " ".join(str(o).split()).capitalize() for c in vigentes if (o := _de_rama(c["r"], "cual_otra_marca"))
    )
    principal = {
        "visitas": len(vigentes),
        "duplicados": len(censos) - len(vigentes),
        "porDia": [
            {"clave": k, "n": n} for k, n in sorted(Counter(dia_caracas(c["terminadoEn"]) for c in vigentes).items())
        ],
        "porVendedor": _conteo(c["encuestador"] for c in vigentes),
        "porRuta": sorted(_conteo(c["ruta"] for c in vigentes), key=lambda x: _orden_ruta(ruta_comparable(x["clave"]))),
        "porTipoCliente": _conteo(c["tipoCliente"] for c in vigentes),
        "poseeActivos": _conteo(r(c, "posee_activo") for c in vigentes),
        "propiedadActivo": _conteo(r(c, "propiedad_activo") for c in vigentes if r(c, "posee_activo") == "Si"),
        "tablaVendedores": _tabla_vendedores(vigentes),
    }
    mapa = {
        "vendeCompetencia": _conteo(vende),
        "marcas": [{"clave": k, "n": n} for k, n in marcas.most_common()],
        "otrasMarcas": [{"clave": k, "n": n} for k, n in otras.most_common(30)],
        "activosCompetencia": _conteo(r(c, "posee_activo_competencia") for c in vigentes),
    }
    puntos = [
        {
            "id": c["id"], "lat": c["lat"], "lng": c["lng"], "nombre": c["nombreComercio"],
            "tipoCliente": c["tipoCliente"], "empresa": c["empresa"], "ruta": c["ruta"],
            "encuestador": c["encuestador"], "fecha": dia_caracas(c["terminadoEn"]),
            "vendeCompetencia": _de_rama(c["r"], "helados_competencia"),
            "marcas": _de_rama(c["r"], "marcas_competencia") or [],
            "poseeActivo": r(c, "posee_activo"), "activoCompetencia": r(c, "posee_activo_competencia"),
            "posibleCliente": c["posibleCliente"], "fotos": c["fotos"], "origen": c["origen"],
        }
        for c in vigentes
        if c["lat"] is not None
    ]

    empresas = tuple(e for e in EMPRESAS if not empresas_filtro or e in empresas_filtro or "AMBAS" in empresas_filtro)
    rutas = {ruta_comparable(x) for x in rutas_filtro} or None
    av = avance(cur, vigentes, empresas, rutas)
    claves_vigentes = [(c, k) for c in vigentes for k in c["claves"] if k["accion"] != "REVISAR"]
    pendientes_ventas = [
        {**_resumen_censo(c), "empresa": k["empresa"], "codigo": k["codigo"], "accion": k["accion"]}
        for c, k in claves_vigentes
        if not k["enMaestra"] and not k["enVentas"]
    ]
    posibles = [
        {**_resumen_censo(c), "rif": r(c, "rif"), "telefono": r(c, "telefono"), "lat": c["lat"], "lng": c["lng"]}
        for c in vigentes
        if c["posibleCliente"]
    ]
    al = alertas(censos)
    return {
        "principal": principal,
        "mapa": mapa,
        "puntos": puntos,
        "avance": {
            **{k: v for k, v in av.items() if k != "porCensar"},
            "porCensarTotal": len(av["porCensar"]),
            "porCensar": av["porCensar"][:LIMITE_LISTA],
            "creados": sum(1 for _, k in claves_vigentes if k["accion"] == "CREADO"),
            "completados": sum(1 for _, k in claves_vigentes if k["accion"] == "COMPLETADO"),
            "pendientesVentasTotal": len(pendientes_ventas),
            "pendientesVentas": pendientes_ventas[:LIMITE_LISTA],
            "posiblesClientesTotal": len(posibles),
            "posiblesClientes": posibles[:LIMITE_LISTA],
        },
        "alertas": {
            **{f"{k}Total": len(v) for k, v in al.items()},
            **{k: v[:LIMITE_LISTA] for k, v in al.items()},
        },
        # Para el Excel: las listas completas.
        "_completo": {
            "porCensar": av["porCensar"], "pendientesVentas": pendientes_ventas, "posiblesClientes": posibles, **al,
        },
    }


def _tabla_vendedores(vigentes: list[dict]) -> list[dict]:
    filas: dict[str, Counter] = defaultdict(Counter)
    for c in vigentes:
        n = filas[c["encuestador"] or "Sin dato"]
        n["visitas"] += 1
        n["existentes"] += c["tipoCliente"] == "Ya existente"
        n["nuevos"] += c["tipoCliente"] == "Nuevo"
        n["conActivo"] += c["r"].get("posee_activo") == "Si"
        n["conCompetencia"] += _de_rama(c["r"], "helados_competencia") == "Si"
    return sorted(({"vendedor": v, **n} for v, n in filas.items()), key=lambda x: -x["visitas"])


# ---------- Del vendedor ----------


def pendientes_de_vendedor(cur, usuario_id: str) -> dict:
    """Los clientes por censar de las rutas del vendedor y sus censos que
    todavia no estan en ventas o tienen un codigo para revisar."""
    rutas = {(str(e), ruta_comparable(r)) for e, r in rutas_del_vendedor(cur, usuario_id)}
    rutas = {(e, r) for e, r in rutas if r != RUTA_DE_BAJA}
    censos = cargar(cur, 'WHERE c."formulario" = %(f)s AND c."descartadoEn" IS NULL', {"f": cc.FORMULARIO})
    hechas = censadas(censos)
    maestra = _maestra(cur, tuple(sorted({e for e, _ in rutas}))) if rutas else {}
    por_censar = [
        _cliente_por_censar(f, {})
        for empresa, filas in maestra.items()
        for f in filas
        if (empresa, f["rutaNumero"]) in rutas and (empresa, f["codigo"]) not in hechas
    ]
    por_censar.sort(key=lambda p: (p["empresa"], _orden_ruta(p["ruta"] or ""), p["razonSocial"]))
    mios = [c for c in censos if c["usuarioId"] == usuario_id and not c["duplicadoDeId"]]
    en_ventas, revisar = [], []
    for c in mios:
        for k in c["claves"]:
            item = {**_resumen_censo(c), "empresa": k["empresa"], "codigo": k["codigo"]}
            if k["accion"] == "REVISAR":
                revisar.append({**item, "motivo": k["motivo"]})
            elif not k["enMaestra"] and not k["enVentas"]:
                en_ventas.append(item)
    return {
        "rutas": [{"empresa": e, "ruta": r} for e, r in sorted(rutas)],
        "conMaestra": sorted(maestra),
        "porCensar": por_censar,
        "pendientesVentas": en_ventas,
        "revisar": revisar,
    }
